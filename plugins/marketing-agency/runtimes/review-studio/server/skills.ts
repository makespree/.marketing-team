import { createHash, randomUUID } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import type { Request, onRequest } from 'firebase-functions/v2/https';
import { config } from './config.js';
import { ApiError, requireWorkspaceAccess, type Services } from './services.js';
type Response = Parameters<Parameters<typeof onRequest>[0]>[1];
export type SkillBundle = { files: { path: string; content: string }[] };
export const skillHash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
export function parseBundle(value: unknown): SkillBundle {
  const v = value as SkillBundle;
  if (!v || Object.keys(v).some(k => k !== 'files') || !Array.isArray(v.files) || !v.files.length || v.files.length > 300) throw new ApiError(400, 'invalid-skill', 'Choose 1–300 Markdown files.');
  const seen = new Set<string>();
  for (const f of v.files) {
    if (!f || Object.keys(f).some(k => !['path','content'].includes(k)) || typeof f.path !== 'string' || !/^[a-zA-Z0-9_./ -]+\.md$/.test(f.path) || f.path.startsWith('/') || f.path.split('/').some(p => !p || p === '.' || p === '..') || seen.has(f.path) || typeof f.content !== 'string' || Buffer.byteLength(f.content) > 512 * 1024 || f.content.includes('\0')) throw new ApiError(400, 'invalid-skill-file', 'Invalid or duplicate Markdown file; maximum 512 KiB per file.');
    seen.add(f.path);
  }
  const entry = v.files.find(f => f.path === 'SKILL.md')?.content;
  if (!entry || !/^---\r?\n[\s\S]*?\r?\n---/.test(entry) || !/^name:\s*\S+/m.test(entry) || !/^description:\s*\S+/m.test(entry)) throw new ApiError(400, 'invalid-skill-entry', 'SKILL.md needs name and description frontmatter.');
  if (Buffer.byteLength(JSON.stringify(v)) > 3 * 1024 * 1024) throw new ApiError(413, 'skill-too-large', 'Skill instructions exceed 3 MiB.');
  return { files: v.files.map(f => ({ path: f.path, content: f.content })).sort((a,b) => a.path.localeCompare(b.path)) };
}
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export async function skillsApi(request: Request, response: Response, services: Services, route: string) {
  const uid = await requireWorkspaceAccess(request.get('Authorization'), services);
  const collection = services.db.collection('marketingWorkspaces').doc(config.workspaceId).collection('skills');
  const bucket = getStorage(services.app).bucket(services.bucket);
  if (route === '/marketing/skills' && request.method === 'GET') {
    const docs = await collection.orderBy('title').limit(100).get();
    response.json({ skills: docs.docs.map(d => d.data()) }); return;
  }
  const match = /^\/marketing\/skills\/([^/]+)(\/history)?$/.exec(route);
  if (!match || !idPattern.test(match[1]!) || match[1]!.length > 64) throw new ApiError(404, 'not-found', 'Skill not found.');
  const ref = collection.doc(match[1]!);
  if (match[2] && request.method === 'GET') {
    const docs = await ref.collection('revisions').orderBy('version','desc').limit(50).get();
    response.json({ revisions: docs.docs.map(d => { const { actor: _, ...record } = d.data(); return record; }) }); return;
  }
  if (request.method === 'GET' && !match[2]) {
    const version = request.query.version;
    if (Object.keys(request.query).some(k => k !== 'version') || (version !== undefined && (typeof version !== 'string' || !/^[1-9][0-9]{0,7}$/.test(version)))) throw new ApiError(400,'invalid-version','Invalid skill revision.');
    const doc = await (version ? ref.collection('revisions').doc(String(version)) : ref).get();
    if (!doc.exists) throw new ApiError(404,'not-found','Skill revision not found.');
    const { actor: _, ...record } = doc.data()!;
    const [bytes] = await bucket.file(record.storagePath, { generation: record.generation }).download();
    if (skillHash(bytes) !== record.sha256) throw new ApiError(409,'skill-integrity','Skill integrity check failed.');
    response.json({ skill: record, bundle: parseBundle(JSON.parse(bytes.toString())) }); return;
  }
  if (request.method !== 'POST' || match[2]) throw new ApiError(405,'method-not-allowed','Unsupported skill operation.');
  const editable = await ref.get();
  if (!editable.exists) throw new ApiError(404,'not-found','Skill not found.');
  if (editable.data()!.management !== 'team') throw new ApiError(403,'skill-read-only','Tools and dependencies are read-only. Customize your own production skill instead.');
  const input = request.body;
  if (!request.is('application/json') || !input || Object.keys(input).some(k => !['expectedVersion','bundle','note','requestId'].includes(k)) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || typeof input.note !== 'string' || input.note.trim().length < 1 || input.note.length > 500 || typeof input.requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(input.requestId)) throw new ApiError(400,'invalid-skill-update','Include the current version, request ID and a short change note.');
  const bundle = parseBundle(input.bundle), bytes = Buffer.from(JSON.stringify(bundle));
  const digest = skillHash(JSON.stringify(input));
  const operation = ref.collection('operations').doc(input.requestId);
  const previous = await operation.get();
  if (previous.exists) { if (previous.data()!.digest !== digest) throw new ApiError(409,'request-conflict','Request ID was already used.'); response.json({ skill: previous.data()!.skill }); return; }
  const file = bucket.file(`marketing/${config.workspaceId}/skills/${ref.id}/${randomUUID()}.json`);
  await file.save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/json',cacheControl:'private, no-store'}});
  const [metadata] = await file.getMetadata(); let committed = false;
  try {
    const record = await services.db.runTransaction(async tx => {
      const [current, op] = await Promise.all([tx.get(ref),tx.get(operation)]);
      if (current.data()?.management !== 'team') throw new ApiError(403,'skill-read-only','Tools and dependencies are read-only.');
      if (op.exists) { if (op.data()!.digest !== digest) throw new ApiError(409,'request-conflict','Request ID was already used.'); return op.data()!.skill; }
      if (!current.exists) throw new ApiError(404,'not-found','Skill not found.');
      if (current.data()!.version !== input.expectedVersion) throw new ApiError(409,'revision-conflict','Someone changed this skill. Your edits are kept; reload the latest revision before saving.');
      const next = { ...current.data(), version: input.expectedVersion + 1, storagePath: file.name, generation: String(metadata.generation), sha256: skillHash(bytes), fileCount: bundle.files.length, updatedAt: new Date().toISOString(), note: input.note.trim() };
      tx.set(ref,next); tx.create(ref.collection('revisions').doc(String(next.version)),{...next,actor:uid}); tx.create(operation,{digest,skill:next}); return next;
    });
    committed = record.storagePath === file.name;
    response.json({ skill: record });
  } finally { if (!committed) await file.delete({ignoreNotFound:true}); }
}
