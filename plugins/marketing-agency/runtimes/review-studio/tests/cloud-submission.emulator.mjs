// Real Firestore commit + Storage integration, isolated to the configured demo.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { submitCloud } from '../scripts/cloud-submission.mjs';
const config = JSON.parse(await readFile(new URL('../project.json', import.meta.url)));
Object.assign(process.env, { MARKETING_ENV: 'local', GCLOUD_PROJECT: config.local.projectId, FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${config.local.ports.auth}`, FIRESTORE_EMULATOR_HOST: `127.0.0.1:${config.local.ports.firestore}`, FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${config.local.ports.storage}` });
const { servicesForRequest } = await import('../lib/server/services.js');
const validators = await import('../lib/server/content-review.js');
const { getStorage } = await import('firebase-admin/storage');
const services = servicesForRequest(), bucket = getStorage(services.app).bucket(services.bucket);
const workspaceId = 'submission-test-' + randomUUID(), prefix = `marketing/${workspaceId}/`;
const docs = `http://127.0.0.1:${config.local.ports.firestore}/v1/projects/${config.local.projectId}/databases/(default)/documents`;
const client = { config: { workspaceId, cloud: { storageBucket: services.bucket } }, docs,
  async api(url, method = 'GET', body) {
    if (url.startsWith('https://storage.googleapis.com/')) {
      try { return (await bucket.file(decodeURIComponent(new URL(url).pathname.split('/o/')[1])).getMetadata())[0]; }
      catch (e) { e.status = Number(e.code); throw e; }
    }
    const response = await fetch(url, { method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw Object.assign(Error(await response.text()), { status: response.status }); return response.json();
  },
  async request(url, options) {
    if (options?.method === 'POST') {
      const bytes = options.body, boundary = options.headers['Content-Type'].split('boundary=')[1];
      const start = bytes.indexOf('\r\n\r\n') + 4, end = bytes.indexOf(`\r\n--${boundary}`, start);
      const metadata = JSON.parse(bytes.subarray(start, end).toString());
      const dataStart = bytes.indexOf('\r\n\r\n', end + 2) + 4;
      const data = bytes.subarray(dataStart, bytes.indexOf(`\r\n--${boundary}--`, dataStart));
      await bucket.file(metadata.name).save(data, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata });
      return { json: async () => (await bucket.file(metadata.name).getMetadata())[0] };
    }
    const name = decodeURIComponent(new URL(url).pathname.split('/o/')[1]);
    return { arrayBuffer: async () => (await bucket.file(name).download())[0] };
  },
};
try {
  const input = { client, validators, identity: 'emulator-post.json', manifest: { title: 'Emulator only', caption: 'Never published', language: 'en', placement: 'feed', files: ['test.png'] }, files: [Buffer.from('89504e470d0a1a0a112233', 'hex')] };
  const result = await submitCloud(input); assert.equal(result.verified, true); assert.equal(result.status, 'needs-review');
  assert.equal((await submitCloud(input)).id, result.id);
  const changed = { ...input, manifest: { ...input.manifest, caption: 'Revised' } };
  await assert.rejects(submitCloud(changed), /expected-version/);
  assert.equal((await submitCloud({ ...changed, expectedVersion: 1 })).version, 2);
  assert.equal((await services.db.collection('marketingWorkspaces').doc(workspaceId).collection('posts').doc(result.id).collection('history').get()).size, 2);
  console.log('PASS cloud-submission emulator: actual atomic commits, Storage read-back, retry, revision guard and history.');
} finally {
  await services.db.recursiveDelete(services.db.collection('marketingWorkspaces').doc(workspaceId));
  await bucket.deleteFiles({ prefix });
}
