// Private media archive. This does not create or approve review posts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { cloudClient } from './cloud-client.mjs';

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(kit, 'workspace');
const manifestPath = path.join(root, 'media-inventory.json');
const [command = 'sync', ...args] = process.argv.slice(2);
if (!['sync', 'restore'].includes(command) || (command === 'sync' && args.length)) throw Error('Usage: media-cloud.mjs sync | restore [workspace-relative paths...]');
const { config, api, request } = await cloudClient();
const bucket = config.cloud.storageBucket;
const prefix = `marketing/${config.workspaceId}/`;
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
let manifest;
try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; manifest = { projectId: config.cloud.projectId, bucket, workspaceId: config.workspaceId, files: {} }; }
if (manifest.projectId !== config.cloud.projectId || manifest.bucket !== bucket || manifest.workspaceId !== config.workspaceId) throw Error('Media inventory belongs to another workspace.');
const objectURL = name => `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}`;
function localPath(rel) {
  if (!rel || rel.split('/').some(x => !x || x === '..' || x === '.') || path.isAbsolute(rel) || rel.includes('\\')) throw Error('Invalid workspace-relative path.');
  return path.join(root, rel);
}
async function verify(entry) {
  if (!entry.storagePath.startsWith(prefix)) throw Error('Unexpected cloud object path.');
  const url = objectURL(entry.storagePath) + `?generation=${encodeURIComponent(entry.generation)}`;
  const meta = await api(url);
  if (meta.metadata?.firebaseStorageDownloadTokens) throw Error('Unexpected public download token.');
  const bytes = Buffer.from(await (await request(url + '&alt=media')).arrayBuffer());
  if (bytes.length !== entry.size || hash(bytes) !== entry.sha256) throw Error('Cloud media integrity mismatch.');
  return bytes;
}
if (command === 'restore') {
  const selected = args.length ? args : Object.keys(manifest.files);
  for (const rel of selected) {
    const target = localPath(rel), entry = manifest.files[rel];
    if (!entry) throw Error(`Not archived: ${rel}`);
    const bytes = await verify(entry);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Never overwrite local work, including symlinks.
    try { await fs.writeFile(target, bytes, { flag: 'wx' }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; if (!(await fs.lstat(target)).isFile() || hash(await fs.readFile(target)) !== entry.sha256) throw Error(`Local file differs: ${rel}`); }
  }
  console.log(`Verified/restored ${selected.length} media files. Nothing published.`);
} else {
  const media = [], caches = [];
  const extensions = /\.(png|jpe?g|webp|gif|mp4|mov|webm|wav|mp3|m4a|ogg)$/i;
  async function walk(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (item.name.startsWith('work-') && full.startsWith(path.join(root, 'production', 'videos') + path.sep)) { caches.push(full); continue; }
        await walk(full);
      } else if (item.isFile() && extensions.test(item.name)) media.push(path.relative(root, full));
    }
  }
  await walk(root);
  let uploaded = 0;
  for (const rel of media.sort()) {
    const bytes = await fs.readFile(localPath(rel)), sha256 = hash(bytes);
    let entry = manifest.files[rel];
    if (!entry || entry.sha256 !== sha256) {
      // Reuse the source assets already migrated to Firebase when byte-exact.
      const legacyPath = prefix + 'sources/' + rel;
      let meta;
      try { meta = await api(objectURL(legacyPath)); } catch (e) { if (e.status !== 404) throw e; }
      let storagePath = legacyPath;
      if (!meta || meta.md5Hash !== hash(bytes, 'md5', 'base64')) {
        storagePath = prefix + 'media-archive/' + sha256;
        try { meta = await api(objectURL(storagePath)); } catch (e) { if (e.status !== 404) throw e; meta = undefined; }
        if (!meta) {
          const boundary = 'marketing-' + randomUUID();
          const metadata = { name: storagePath, cacheControl: 'private, no-store', metadata: { sha256 } };
          const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
          meta = await (await request(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=multipart&ifGenerationMatch=0`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })).json();
          uploaded++;
        }
      }
      entry = { storagePath, generation: meta.generation, sha256, size: bytes.length };
    }
    await verify(entry);
    manifest.files[rel] = entry;
    console.log(`Verified ${rel}`);
  }
  manifest.verifiedAt = new Date().toISOString();
  const temp = manifestPath + '.tmp';
  await fs.writeFile(temp, JSON.stringify(manifest, null, 2) + '\n');
  await fs.rename(temp, manifestPath);
  console.log(JSON.stringify({ verified: media.length, uploaded, disposableRenderCaches: caches.length }));
}
