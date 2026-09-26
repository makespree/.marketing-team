import test from 'node:test';
import assert from 'node:assert/strict';
import { HermosoClient, approvedExportPlan } from '../scripts/hermoso-client.mjs';

test('Hermoso inspection pins exact shared brand and executes only schema-verified account reads', async () => {
  const calls = [];
  let readOnly = true;
  const client = new HermosoClient('hmk_test_secret', async (url, options) => {
    calls.push({ url, options });
    let result;
    if (url.endsWith('/brands')) result = { data: [{ id: 'brand', shared: true, owner_account_id: 'owner', headers: { 'X-Hermoso-User': 'brand', 'X-Hermoso-Owner': 'owner', Authorization: 'must-not-use' } }] };
    else if (url.endsWith('/channels')) result = { data: [{ id: 'facebook', available: true, connected: false }] };
    else if (options.method === 'GET') result = { read_only: readOnly, connector_connected: true };
    else result = { data: { pages: [] } };
    return { ok: true, json: async () => result };
  });
  await assert.rejects(client.channels(), /Select the brand/);
  await assert.rejects(client.selectBrand('wrong'), /not found/);
  await client.selectBrand('brand');
  const channels = await client.channels(); assert.equal(channels.data[0].connected, false);
  const headers = calls.at(-1).options.headers;
  assert.equal(headers['X-Hermoso-User'], 'brand'); assert.equal(headers['X-Hermoso-Owner'], 'owner'); assert.equal(headers.Authorization, 'Bearer hmk_test_secret');
  await client.readTool('list_meta_pages');
  await assert.rejects(client.readTool('create_meta_ad'), /account discovery only/);
  readOnly = false; await assert.rejects(client.readTool('list_meta_pages'), /read-only/);
  assert.deepEqual(calls.filter(c => c.options.method === 'POST').map(c => c.url), ['https://app.hermoso.ai/v1/tools/list_meta_pages']);
  assert.ok(calls.every(c => c.options.redirect === 'error'));
});

test('Hermoso errors do not echo secrets, and export preparation requires exact approval', async () => {
  const client = new HermosoClient('hmk_private', async () => ({ ok: false, status: 401, json: async () => ({ error: { code: 'invalid_key', message: 'hmk_private' } }) }));
  await assert.rejects(client.brands(), e => !e.message.includes('hmk_private') && e.status === 401);
  const asset = { id: 'asset', type: 'image/png', size: 10, sha256: 'a'.repeat(64), generation: '123' };
  const post = { id: 'post', status: 'approved', version: 2, contentHash: 'digest', assets: ['asset'], title: 'Title', caption: 'Caption', placement: 'feed' };
  const plan = approvedExportPlan(post, [asset]); assert.equal(plan.transferPerformed, false); assert.equal(plan.expectedVersion, 2);
  await assert.rejects(async () => approvedExportPlan({ ...post, status: 'needs-review' }, [asset]), /Approve/);
  await assert.rejects(async () => approvedExportPlan(post, [{ ...asset, id: 'another' }]), /unordered/);
});
