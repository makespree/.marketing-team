import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudClient } from './cloud-client.mjs';
import { submitCloud } from './cloud-submission.mjs';
import { fingerprint } from './project.mjs';
const kit = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const [filename, ...flags] = process.argv.slice(2);
  if (!filename) throw Error('Pass a manifest filename.');
  let postId, expectedVersion, verifyOnly = false;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--post-id') { postId = flags[++i]; if (!postId || postId.startsWith('--')) throw Error('Pass a post ID after --post-id.'); }
    else if (flags[i] === '--expected-version') { const value = flags[++i]; if (!/^\d+$/.test(value ?? '')) throw Error('Expected version must be an integer.'); expectedVersion = Number(value); }
    else if (flags[i] === '--verify-only') verifyOnly = true;
    else throw Error('Unknown submission option.');
  }
  const workspace = await realpath(resolve(kit, 'workspace'));
  async function inside(name) { const full = await realpath(name), rel = relative(workspace, full); if (rel === '..' || rel.startsWith('..' + sep) || rel.startsWith(sep)) throw Error('Manifest/media must be inside workspace/.'); return full; }
  const full = await inside(resolve(filename)), manifest = JSON.parse(await readFile(full, 'utf8'));
  if (!Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 10 || manifest.files.some(f => typeof f !== 'string')) throw Error('Manifest needs 1–10 workspace-relative files.');
  const files = [];
  for (const name of manifest.files) files.push(await readFile(await inside(resolve(workspace, name))));
  const client = await cloudClient();
  if (client.config.sourceBinding !== fingerprint(resolve(kit, '..'))) throw Error('Run adapt before submitting from a copied project.');
  console.log(`Cloud destination: ${client.config.cloud.projectId} / ${client.config.workspaceId}`);
  const validators = await import('../lib/server/content-review.js');
  const result = await submitCloud({ client, manifest, files, identity: relative(workspace, full).split(sep).join('/'), postId, expectedVersion, verifyOnly, validators });
  const receipt = { environment: 'cloud', projectId: client.config.cloud.projectId, workspaceId: client.config.workspaceId, ...result, verifiedAt: new Date().toISOString() };
  const dir = resolve(kit, '.local', client.config.workspaceId, 'cloud-submissions');
  await mkdir(dir, { recursive: true }); await writeFile(resolve(dir, result.id + '.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
  console.log('Verified cloud Storage media and hosted review post. Nothing published.');
} catch (e) { console.error(`CLOUD SUBMISSION FAILED: ${e.message}\nNo local fallback. Firebase developer credentials and project access are required; studio Google login alone does not grant them.`); process.exitCode = 1; }
