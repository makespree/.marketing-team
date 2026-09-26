import { createHash, randomUUID } from 'node:crypto';
import { accountEmail } from './cloud-client.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = seed => { const h = sha(seed); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
export function fields(object) { return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, encode(value)])); }
function encode(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (value && typeof value === 'object') return { mapValue: { fields: fields(value) } };
  throw Error('Unsupported submission value.');
}
export function values(input) { return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, decode(v)])); }
function decode(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decode);
  if ('mapValue' in v) return values(v.mapValue.fields ?? {});
  throw Error('Unsupported submission field.');
}

// Developer-authorized importer; browser access continues through the protected API.
// No Firebase user is created or impersonated, and no approval/publishing is performed.
export async function submitCloud({ client, manifest, files, identity, postId, expectedVersion, verifyOnly = false, validators }) {
  const { config, api, request, docs } = client;
  const { parseContent, mediaType, contentId, nextPost } = validators;
  if (!Array.isArray(manifest.files) || files.length !== manifest.files.length) throw Error('Invalid manifest files.');
  const fileHashes = files.map(sha), types = files.map(mediaType);
  const assets = fileHashes.map(h => uuid(`${config.workspaceId}:asset:${h}`));
  const { title, caption, language, placement } = manifest;
  const content = parseContent({ title, caption, language, placement, assets });
  if (placement !== 'feed' && files.length !== 1) throw Error('Reels and stories require one file.');
  if (placement === 'reel' && types[0] !== 'video/mp4') throw Error('A reel requires MP4.');
  const id = contentId(postId ?? uuid(`${config.workspaceId}:post:${identity}`));
  const base = `${docs}/marketingWorkspaces/${config.workspaceId}`;
  const postURL = `${base}/posts/${id}`;
  const optional = async url => { try { return await api(url); } catch (e) { if (e.status === 404) return null; throw e; } };
  const objectURL = asset => `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(config.cloud.storageBucket)}/o/${encodeURIComponent(`marketing/${config.workspaceId}/${asset}`)}`;
  async function verifyAsset(assetId, index) {
    const doc = await api(`${base}/assets/${assetId}`), asset = values(doc.fields);
    if (asset.sha256 !== fileHashes[index] || asset.size !== files[index].length || asset.type !== types[index]) throw Error('Cloud asset record differs from local export.');
    const url = objectURL(assetId) + `?generation=${encodeURIComponent(asset.generation)}`;
    const metadata = await api(url);
    if (metadata.metadata?.firebaseStorageDownloadTokens) throw Error('Unexpected public media token.');
    const bytes = Buffer.from(await (await request(url + '&alt=media')).arrayBuffer());
    if (sha(bytes) !== fileHashes[index]) throw Error('Cloud media verification failed.');
  }
  async function verifyPost(doc) {
    const post = values(doc.fields);
    for (const key of ['title', 'caption', 'language', 'placement']) if (post[key] !== content[key]) throw Error(`Cloud post ${key} differs from the manifest.`);
    if (post.assets.length !== files.length) throw Error('Cloud media count differs.');
    for (let i = 0; i < files.length; i++) await verifyAsset(post.assets[i], i);
    return post;
  }
  const current = await optional(postURL);
  if (verifyOnly) {
    if (!current) throw Error('No cloud review post exists.');
    const post = await verifyPost(current);
    return { id, version: post.version, status: post.status, verified: true, created: false };
  }
  const contentHash = sha(JSON.stringify({ ...content, files: fileHashes }));
  const old = current ? values(current.fields) : undefined;
  if (old?.contentHash === contentHash) {
    await verifyPost(current);
    return { id, version: old.version, status: old.status, verified: true, created: false };
  }
  if (old && expectedVersion !== old.version) throw Error(`Post exists at version ${old.version}. Inspect it, then pass --expected-version ${old.version} to submit a revision.`);
  if (!old && expectedVersion !== undefined && expectedVersion !== 0) throw Error('Cannot revise a missing post.');
  // Validate the full transition before writing any remote media.
  const author = typeof manifest.author === 'string' && manifest.author.trim() ? manifest.author.trim().slice(0, 80) : (accountEmail() || 'developer-cli');
  const post = nextPost(old, { action: 'save', expectedVersion: old?.version ?? 0, content }, id, contentHash, new Date().toISOString(), author);
  for (let i = 0; i < files.length; i++) {
    const assetId = assets[i], assetURL = `${base}/assets/${assetId}`;
    if (!await optional(assetURL)) {
      let meta = await optional(objectURL(assetId));
      if (!meta) {
        const boundary = `marketing-${randomUUID()}`;
        const metadata = { name: `marketing/${config.workspaceId}/${assetId}`, contentType: types[i], cacheControl: 'private, no-store' };
        const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${types[i]}\r\n\r\n`), files[i], Buffer.from(`\r\n--${boundary}--\r\n`)]);
        try {
          meta = await (await request(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(config.cloud.storageBucket)}/o?uploadType=multipart&ifGenerationMatch=0`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })).json();
        } catch (e) { if (e.status !== 412) throw e; meta = await api(objectURL(assetId)); }
      }
      const asset = { id: assetId, type: types[i], size: files[i].length, sha256: fileHashes[i], generation: String(meta.generation), createdAt: new Date().toISOString() };
      try { await api(assetURL + '?currentDocument.exists=false', 'PATCH', { fields: fields(asset) }); }
      catch (e) { if (![409, 412].includes(e.status)) throw e; }
    }
    await verifyAsset(assetId, i);
  }
  const operation = uuid(`${id}:${post.version}:${contentHash}`);
  const documentName = url => url.slice(url.indexOf('/projects/') + 1);
  const write = (url, value, condition = { exists: false }) => ({ update: { name: documentName(url), fields: fields(value) }, currentDocument: condition });
  // Atomic commit: concurrent reviewers/edits cannot be overwritten by the CLI.
  await api(docs + ':commit', 'POST', { writes: [
    write(postURL, post, current ? { updateTime: current.updateTime } : { exists: false }),
    write(`${postURL}/history/${post.version}`, { ...post, actor: 'developer-cli' }),
    write(`${postURL}/operations/${operation}`, { digest: contentHash, actor: 'developer-cli', result: post }),
  ] });
  const confirmed = await verifyPost(await api(postURL));
  if (confirmed.contentHash !== contentHash) throw Error('Cloud post changed during verification. Reload before retrying.');
  return { id, version: confirmed.version, status: confirmed.status, verified: true, created: !old };
}
