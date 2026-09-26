import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const config = JSON.parse(await readFile(new URL('../project.json', import.meta.url), 'utf8'));
const ports = config.local.ports;
const health = await fetch(`http://127.0.0.1:${ports.api}/health`).then(r => r.json());
assert.equal(health.environment, 'local'); assert.equal(health.workspaceId, config.workspaceId); assert.ok(config.local.projectId.startsWith('demo-'));
Object.assign(process.env, { MARKETING_ENV: 'local', GCLOUD_PROJECT: config.local.projectId, FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${ports.auth}`, FIRESTORE_EMULATOR_HOST: `127.0.0.1:${ports.firestore}`, FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${ports.storage}` });
const { servicesForRequest } = await import('../lib/server/services.js');
const { contentBucket } = await import('../lib/server/content-review.js');
const services = servicesForRequest(), ids = [], postId = randomUUID(); let asset;
const base = `http://127.0.0.1:${ports.api}/api/marketing`;
async function account() { const result = await fetch(`http://127.0.0.1:${ports.auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `test-${randomUUID()}@example.test`, password: 'Local-emulator-only-2026!', returnSecureToken: true }) }).then(r => r.json()); assert.ok(result.idToken); ids.push(result.localId); return result; }
async function request(path, user, body, raw = false) { return fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(user ? { Authorization: `Bearer ${user.idToken}` } : {}), ...(body === undefined ? {} : { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' }) }, ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }) }); }
try {
 const [reviewer, other] = await Promise.all([account(), account()]);
 await services.auth.setCustomUserClaims(reviewer.localId, { marketingWorkspaces: [config.workspaceId] });
 await services.auth.setCustomUserClaims(other.localId, { marketingWorkspaces: ['different-project'] });
 assert.equal((await request('/posts')).status, 401); assert.equal((await request('/posts', other)).status, 403, 'Another workspace role must not grant access');
 const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZuoAAAAASUVORK5CYII=', 'base64');
 const upload = await request('/assets', reviewer, png, true); assert.equal(upload.status, 201, await upload.clone().text()); asset = await upload.json();
 const [meta] = await contentBucket(services).file(`marketing/${config.workspaceId}/${asset.id}`).getMetadata(); assert.equal(meta.metadata?.firebaseStorageDownloadTokens, undefined);
 const media = await request(`/assets/${asset.id}`, reviewer); assert.equal(media.status, 200); assert.deepEqual(Buffer.from(await media.arrayBuffer()), png);
 assert.equal((await request(`/assets/${asset.id}`, other)).status, 403);
 const direct = await fetch(`http://127.0.0.1:${ports.storage}/v0/b/${config.local.projectId}.appspot.com/o/${encodeURIComponent(`marketing/${config.workspaceId}/${asset.id}`)}?alt=media`); assert.ok([401,403].includes(direct.status));
 const input = { action: 'save', expectedVersion: 0, requestId: randomUUID(), content: { title: 'Independent portable test', caption: 'Private test', language: config.languages[0].code, placement: 'feed', assets: [asset.id] } };
 const created = await request(`/posts/${postId}`, reviewer, input); assert.equal(created.status, 200, await created.clone().text());
 assert.equal((await request(`/posts/${postId}`, reviewer, input)).status, 200);
 const decision = { action: 'review', expectedVersion: 1, requestId: randomUUID(), status: 'approved', feedback: '' };
 const raced = await Promise.all([request(`/posts/${postId}`, reviewer, decision), request(`/posts/${postId}`, reviewer, { ...decision, requestId: randomUUID(), status: 'rejected', feedback: 'Change design' })]); assert.deepEqual(raced.map(r => r.status).sort(), [200,409]);
 const edited = await request(`/posts/${postId}`, reviewer, { ...input, requestId: randomUUID(), expectedVersion: 2, content: { ...input.content, caption: 'Changed caption' } }); const saved = await edited.json(); assert.equal(saved.post.status, 'needs-review'); assert.equal(saved.post.revision, 2);
 const directPost = await fetch(`http://127.0.0.1:${ports.firestore}/v1/projects/${config.local.projectId}/databases/(default)/documents/marketingWorkspaces/${config.workspaceId}/posts/${postId}`, { headers: { Authorization: `Bearer ${reviewer.idToken}` } }); assert.equal(directPost.status, 403);
 const history = await (await request(`/posts/${postId}/history`, reviewer)).json(); assert.equal(history.history.length, 3);
 await services.auth.setCustomUserClaims(reviewer.localId, { marketingWorkspaces: [] }); assert.equal((await request('/posts', reviewer)).status, 403);
 console.log('PASS: independent Firebase upload, private preview, workspace isolation, direct-access denial, exact revision review, retries, history and role revocation.');
} finally {
 const workspace = services.db.collection('marketingWorkspaces').doc(config.workspaceId);
 await services.db.recursiveDelete(workspace.collection('posts').doc(postId));
 if (asset) { await workspace.collection('assets').doc(asset.id).delete(); await contentBucket(services).file(`marketing/${config.workspaceId}/${asset.id}`).delete({ ignoreNotFound: true }); }
 await Promise.all(ids.map(id => services.auth.deleteUser(id)));
 await services.db.terminate();
}
