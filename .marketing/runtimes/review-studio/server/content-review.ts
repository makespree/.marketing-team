import { createHash, randomUUID } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import { FieldPath } from 'firebase-admin/firestore';
import type { Request, onRequest } from 'firebase-functions/v2/https';
type Response = Parameters<Parameters<typeof onRequest>[0]>[1];
import { ApiError, requireWorkspaceAccess, type Services } from './services.js';
import { config } from './config.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail = (message = 'Invalid content review input.'): never => { throw new ApiError(400, 'invalid-input', message); };
export const contentId = (value: unknown): string => typeof value === 'string' && uuid.test(value) ? value : fail('Invalid identifier.');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const MAX_CONTENT_BYTES = 20 * 1024 * 1024;
export function mediaType(bytes: Buffer): string {
  if (!bytes.length || bytes.length > MAX_CONTENT_BYTES) throw new ApiError(413, 'invalid-media-size', 'Each file must be between 1 byte and 20 MB.');
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp' && /^(isom|iso2|mp41|mp42|avc1|M4V )$/.test(bytes.toString('ascii', 8, 12))) return 'video/mp4';
  throw new ApiError(415, 'unsupported-media', 'Use PNG, JPEG, WebP or MP4 files.');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function string(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) return fail();
  return value.trim();
}
export function parseContent(value: unknown) {
  const input = object(value);
  if (Object.keys(input).some(k => !['title', 'caption', 'language', 'placement', 'assets'].includes(k))) return fail();
  const title = string(input.title, 120, true), caption = string(input.caption, 2200);
  if (!config.languages.some(item => item.code === input.language)) return fail('Choose a configured content language.');
  if (!['feed', 'reel', 'story'].includes(input.placement as string)) return fail();
  if (!Array.isArray(input.assets) || !input.assets.length || input.assets.length > 10) return fail('Choose 1–10 media files.');
  const assets = input.assets.map(contentId);
  if (new Set(assets).size !== assets.length) return fail('A media file cannot appear twice.');
  return { title, caption, language: input.language as string, placement: input.placement as string, assets };
}
export type ContentInput = ReturnType<typeof parseContent>;
export type ContentPost = ContentInput & { createdBy?: string; updatedBy?: string; reviewedBy?: string; id: string; version: number; revision: number; status: 'needs-review' | 'approved' | 'posted' | 'changes-requested' | 'rejected'; handoffs?: { provider: string; jobId: string; status: string; at: string; channels: string[]; revision: number; contentHash: string; approvedVersion: number; checkedAt: string }[]; publications?: { provider: string; channel: string; account: string; platformPostId: string; url: string; postedAt: string; revision: number; contentHash: string }[]; feedback: string; contentHash: string; createdAt: string; updatedAt: string };
// `actor` is the display label of whoever is acting: a reviewer's name or email,
// or the delivery origin for the command line. It is stored, never trusted for access.
export function nextPost(current: ContentPost | undefined, input: Record<string, unknown>, id: string, contentHash: string, now: string, actor = ''): ContentPost {
  if (input.expectedVersion !== (current?.version ?? 0)) throw new ApiError(409, 'revision-conflict', 'This post changed. Refresh it before reviewing or saving; your text has been kept.');
  if (input.action === 'save') {
    const content = parseContent(input.content);
    const who = actor ? { createdBy: current?.createdBy ?? actor, updatedBy: actor } : (current?.createdBy ? { createdBy: current.createdBy } : {});
    return { ...content, ...who, ...(current?.handoffs ? { handoffs: current.handoffs } : {}), ...(current?.publications ? { publications: current.publications } : {}), id, version: (current?.version ?? 0) + 1, revision: (current?.revision ?? 0) + 1, status: 'needs-review', feedback: '', contentHash, createdAt: current?.createdAt ?? now, updatedAt: now };
  }
  if (input.action !== 'review' || !current) return fail();
  if (current.status === 'posted') throw new ApiError(409, 'already-posted', 'This revision is already posted. Save a new revision before reviewing changes.');
  if (!['approved', 'changes-requested', 'rejected'].includes(input.status as string)) return fail();
  const feedback = string(input.feedback, 4000, input.status !== 'approved');
  return { ...current, version: current.version + 1, status: input.status as ContentPost['status'], feedback, updatedAt: now, ...(actor ? { reviewedBy: actor, updatedBy: actor } : {}) };
}

export function contentBucket(services: Services) { return getStorage(services.app).bucket(services.bucket); }

export async function contentReview(request: Request, response: Response, services: Services, path: string): Promise<void> {
  if (services.environment !== 'local' && process.env.MARKETING_REVIEW_ENABLED !== '1') throw new ApiError(503, 'content-review-disabled', 'Content review has not been enabled on this server.');
  const uid = await requireWorkspaceAccess(request.get('Authorization'), services);
  const names = new Map<string, string>();
  const actorLabel = async (actor: string) => {
    if (!actor || !/^[A-Za-z0-9]{20,}$/.test(actor)) return actor || '';
    if (!names.has(actor)) { try { const u = await services.auth.getUser(actor); names.set(actor, u.displayName || u.email || actor); } catch { names.set(actor, actor); } }
    return names.get(actor)!;
  };
  const db = services.db;
  const workspace = db.collection('marketingWorkspaces').doc(config.workspaceId);
  const posts = workspace.collection('posts'), assets = workspace.collection('assets');
  const bucket = () => contentBucket(services);
  if (path === '/marketing/assets' && request.method === 'POST') {
    if (Object.keys(request.query).length) return fail();
    const bytes = request.rawBody, type = mediaType(bytes), id = randomUUID();
    const file = bucket().file(`marketing/${config.workspaceId}/${id}`);
    // Admin upload deliberately creates no Firebase download token. Drafts are
    // reachable only through the authenticated API, never a public asset URL.
    await file.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: type, cacheControl: 'private, no-store' } });
    const [metadata] = await file.getMetadata();
    const asset = { id, type, size: bytes.length, sha256: hash(bytes), generation: String(metadata.generation), createdAt: new Date().toISOString() };
    try { await assets.doc(id).create(asset); } catch (error) { await file.delete({ ignoreNotFound: true }); throw error; }
    response.status(201).json(asset); return;
  }
  const media = path.match(/^\/marketing\/assets\/([^/]+)$/);
  if (media && request.method === 'GET') {
    if (Object.keys(request.query).length) return fail();
    const id = contentId(media[1]), record = await assets.doc(id).get();
    if (!record.exists) throw new ApiError(404, 'not-found', 'Media not found.');
    const asset = record.data()!;
    const [bytes] = await bucket().file(`marketing/${config.workspaceId}/${id}`, { generation: asset.generation }).download();
    if (hash(bytes) !== asset.sha256) throw new ApiError(409, 'media-changed', 'Media integrity check failed.');
    response.set('Content-Type', asset.type).set('X-Content-Type-Options', 'nosniff').set('Content-Disposition', 'inline').send(bytes); return;
  }
  if (path === '/marketing/posts' && request.method === 'GET') {
    if (Object.keys(request.query).some(k => k !== 'after')) return fail();
    let query = posts.orderBy(FieldPath.documentId()).limit(51);
    if (request.query.after !== undefined) query = query.startAfter(contentId(request.query.after));
    const result = await query.get(), page = result.docs.slice(0, 50);
    response.json({ posts: page.map(doc => doc.data()), next: result.size > 50 ? page.at(-1)!.id : null }); return;
  }
  const history = path.match(/^\/marketing\/posts\/([^/]+)\/history$/);
  if (history && request.method === 'GET') {
    if (Object.keys(request.query).length) return fail();
    const result = await posts.doc(contentId(history[1])).collection('history').orderBy('version', 'desc').limit(100).get();
    const entries = [];
    for (const doc of result.docs) { const { actor, ...snapshot } = doc.data(); entries.push({ ...snapshot, actorName: await actorLabel(String(actor ?? '')) }); }
    response.json({ history: entries, limit: 100 }); return;
  }
  const match = path.match(/^\/marketing\/posts\/([^/]+)$/);
  if (match && request.method === 'GET') {
    if (Object.keys(request.query).length) return fail();
    const record = await posts.doc(contentId(match[1])).get();
    if (!record.exists) throw new ApiError(404, 'not-found', 'This studio post is no longer available.');
    response.json({ post: record.data() }); return;
  }
  if (!match || request.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'This content review operation is unavailable.');
  if (Object.keys(request.query).length || !request.is('application/json') || request.rawBody.length > 16000) return fail();
  const id = contentId(match[1]), input = object(request.body);
  const allowed = input.action === 'save' ? ['action', 'requestId', 'expectedVersion', 'content'] : ['action', 'requestId', 'expectedVersion', 'status', 'feedback'];
  if (Object.keys(input).some(k => !allowed.includes(k))) return fail();
  const operation = contentId(input.requestId), digest = hash(JSON.stringify(input));
  let contentHash = '';
  if (input.action === 'save') {
    const content = parseContent(input.content);
    const records = await db.getAll(...content.assets.map(asset => assets.doc(asset)));
    if (records.some(record => !record.exists)) return fail('Upload every media file before saving.');
    if (content.placement !== 'feed' && content.assets.length !== 1) return fail('Reels and stories use one media file per post.');
    if (content.placement === 'reel' && records[0]!.data()!.type !== 'video/mp4') return fail('A Reel requires an MP4 video.');
    contentHash = hash(JSON.stringify({ ...content, files: records.map(record => record.data()!.sha256) }));
  }
  const who = await actorLabel(uid);
  const result = await db.runTransaction(async tx => {
    const ref = posts.doc(id), op = ref.collection('operations').doc(operation);
    const [old, previous] = await Promise.all([tx.get(ref), tx.get(op)]);
    if (previous.exists) {
      if (previous.data()!.digest !== digest || previous.data()!.actor !== uid) throw new ApiError(409, 'request-conflict', 'This request identifier was already used.');
      return previous.data()!.result;
    }
    const post = nextPost(old.exists ? old.data() as ContentPost : undefined, input, id, contentHash, new Date().toISOString(), who);
    tx.set(ref, post);
    tx.create(ref.collection('history').doc(String(post.version)), { ...post, actor: uid });
    tx.create(op, { digest, actor: uid, result: post });
    return post;
  });
  response.json({ post: result });
}
