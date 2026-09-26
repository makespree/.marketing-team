import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
const kit = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(resolve(kit, 'project.json'), 'utf8'));
if (config.cloud && !process.argv.includes('--local')) throw Error('This workspace is cloud-configured. Use node marketing/cli.mjs deliver <manifest.json> for Firebase Storage + hosted review. For intentional emulator testing only, pass --local.');
const { fingerprint, validateConfig } = await import('./project.mjs'); validateConfig(config);
if (config.sourceBinding !== fingerprint(resolve(kit, '..'))) throw Error('Run adapt in this project before submitting.');
if (!process.argv[2]) throw Error('Pass a content manifest filename.');
const filename = await realpath(resolve(process.argv[2])), workspace = await realpath(resolve(kit, 'workspace'));
function inside(path) { const r = relative(workspace, path); if (r === '..' || r.startsWith('..' + sep) || resolve(workspace, r) !== path) throw Error('Content must be inside workspace/.'); }
inside(filename);
const manifest = JSON.parse(await readFile(filename, 'utf8'));
if (!Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 10) throw Error('Manifest needs 1–10 files.');
const files = [];
for (const name of manifest.files) { const path = await realpath(resolve(workspace, name)); inside(path); files.push(await readFile(path)); }
const digest = createHash('sha256').update(JSON.stringify(manifest)); for (const file of files) digest.update(file);
const key = digest.digest('hex'), base = `http://127.0.0.1:${config.local.ports.api}`;
const health = await fetch(base + '/health').then(r => r.json());
if (health.workspaceId !== config.workspaceId || health.projectId !== config.local.projectId || health.environment !== 'local') throw Error('Wrong local workspace.');
const auth = await fetch(`http://127.0.0.1:${config.local.ports.auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'reviewer@marketing.test', password: 'Local-review-only-2026!', returnSecureToken: true }) }).then(r => r.json());
if (!auth.idToken) throw Error('Local reviewer is unavailable. Start the studio first.');
const directory = resolve(kit, '.local', config.workspaceId, 'submissions'); await mkdir(directory, { recursive: true });
const receiptPath = resolve(directory, `${key}.json`);
let receipt; try { receipt = JSON.parse(await readFile(receiptPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; receipt = { id: randomUUID(), requestId: randomUUID(), assets: [] }; }
const persist = () => writeFile(receiptPath, JSON.stringify(receipt, null, 2)); await persist();
async function post(path, body, raw = false) { const r = await fetch(base + '/api/marketing' + path, { method: 'POST', headers: { Authorization: `Bearer ${auth.idToken}`, 'Content-Type': raw ? 'application/octet-stream' : 'application/json' }, body: raw ? body : JSON.stringify(body) }); const data = await r.json(); if (!r.ok) throw Error(data.error?.message ?? `Request failed: ${r.status}`); return data; }
for (let i = receipt.assets.length; i < files.length; i++) { const asset = await post('/assets', files[i], true); receipt.assets.push(asset.id); await persist(); }
const { title, caption, language, placement } = manifest;
await post(`/posts/${receipt.id}`, { action: 'save', requestId: receipt.requestId, expectedVersion: 0, content: { title, caption, language, placement, assets: receipt.assets } });
console.log(`Draft submitted for review: ${receipt.id}. Nothing published.`);
