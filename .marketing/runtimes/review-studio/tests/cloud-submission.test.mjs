import test from 'node:test';
import assert from 'node:assert/strict';
import { submitCloud, fields, values } from '../scripts/cloud-submission.mjs';
import * as validators from '../server/content-review.ts';
const png = Buffer.from('89504e470d0a1a0a010203', 'hex');
function fixture() {
  const documents = new Map(), objects = new Map(); let clock = 0, failUpload = false, race = false;
  const docs = 'https://firestore.googleapis.com/v1/projects/test/databases/test/documents';
  const error = status => Object.assign(Error(`HTTP ${status}`), { status });
  const client = { config: { workspaceId: 'test-workspace', cloud: { storageBucket: 'test-bucket' } }, docs,
    async api(raw, method = 'GET', body) {
      const url = new URL(raw), key = raw.split('?')[0];
      if (raw === docs + ':commit') {
        if (race) throw error(409);
        for (const w of body.writes) {
          const previous = documents.get('https://firestore.googleapis.com/v1/' + w.update.name);
          if ((w.currentDocument.exists === false && previous) || (w.currentDocument.updateTime && previous?.updateTime !== w.currentDocument.updateTime)) throw error(409);
        }
        for (const w of body.writes) documents.set('https://firestore.googleapis.com/v1/' + w.update.name, { ...w.update, updateTime: String(++clock) });
        return {};
      }
      if (url.hostname === 'storage.googleapis.com') {
        const obj = objects.get(decodeURIComponent(url.pathname.split('/o/')[1])); if (!obj) throw error(404); return obj.meta;
      }
      if (method === 'PATCH') {
        if (documents.has(key)) throw error(409);
        const doc = { ...body, updateTime: String(++clock) }; documents.set(key, doc); return doc;
      }
      if (!documents.has(key)) throw error(404); return structuredClone(documents.get(key));
    },
    async request(raw, options) {
      if (options?.method === 'POST') {
        if (failUpload) throw error(503);
        const b = options.body, boundary = options.headers['Content-Type'].split('boundary=')[1];
        const start = b.indexOf('\r\n\r\n') + 4, end = b.indexOf(`\r\n--${boundary}`, start);
        const meta = { ...JSON.parse(b.subarray(start, end).toString()), generation: '1' };
        const dataStart = b.indexOf('\r\n\r\n', end + 2) + 4;
        const bytes = b.subarray(dataStart, b.indexOf(`\r\n--${boundary}--`, dataStart));
        objects.set(meta.name, { bytes, meta }); return { json: async () => meta };
      }
      const name = decodeURIComponent(new URL(raw).pathname.split('/o/')[1]);
      if (!objects.has(name)) throw error(404);
      return { arrayBuffer: async () => objects.get(name).bytes };
    },
  };
  const input = { client, validators, manifest: { title: 'Draft', caption: 'Caption', language: 'en', placement: 'feed', files: ['assets/example.png'] }, files: [png], identity: 'production/example.json' };
  return { input, documents, objects, failUpload: value => { failUpload = value; }, race: value => { race = value; } };
}
test('cloud delivery reads back media/post, retries without duplication or resetting review, and requires version for edits', async () => {
  const f = fixture();
  const first = await submitCloud(f.input); assert.equal(first.status, 'needs-review'); assert.equal(first.verified, true);
  const postKey = [...f.documents.keys()].find(k => k.endsWith('/posts/' + first.id));
  const post = f.documents.get(postKey); post.fields.status = { stringValue: 'approved' };
  const retry = await submitCloud(f.input); assert.equal(retry.status, 'approved'); assert.equal(retry.created, false); assert.equal(f.objects.size, 1);
  assert.equal(f.documents.size, 4); // asset + post + history + operation
  const changed = { ...f.input, manifest: { ...f.input.manifest, caption: 'Changed' } };
  await assert.rejects(submitCloud(changed), /expected-version 1/);
  const revised = await submitCloud({ ...changed, expectedVersion: 1 }); assert.equal(revised.version, 2); assert.equal(revised.status, 'needs-review');
  assert.equal(values(f.documents.get(postKey).fields).caption, 'Changed');
});
test('cloud delivery fails on upload errors, changed remote bytes and concurrent commits; invalid reels write nothing', async () => {
  const f = fixture(); f.failUpload(true);
  await assert.rejects(submitCloud(f.input), /503/); assert.equal(f.documents.size, 0);
  f.failUpload(false); await submitCloud(f.input);
  f.objects.values().next().value.bytes = Buffer.from('corrupt');
  await assert.rejects(submitCloud(f.input), /verification failed/);
  const invalid = fixture(); await assert.rejects(submitCloud({ ...invalid.input, manifest: { ...invalid.input.manifest, placement: 'reel' } }), /requires MP4/); assert.equal(invalid.documents.size, 0);
  const concurrent = fixture(); concurrent.race(true); await assert.rejects(submitCloud(concurrent.input), /409/);
  assert.ok(![...concurrent.documents.keys()].some(k => k.includes('/posts/')));
});
test('verification-only requires the cloud card and never writes', async () => {
  const f = fixture(); await assert.rejects(submitCloud({ ...f.input, verifyOnly: true }), /No cloud review/); assert.equal(f.objects.size, 0);
  const created = await submitCloud(f.input), before = JSON.stringify([...f.documents]);
  assert.equal((await submitCloud({ ...f.input, postId: created.id, verifyOnly: true })).verified, true);
  assert.equal(JSON.stringify([...f.documents]), before);
  assert.deepEqual(values(fields({ a: ['text'], nested: { v: 2 } })), { a: ['text'], nested: { v: 2 } });
});
