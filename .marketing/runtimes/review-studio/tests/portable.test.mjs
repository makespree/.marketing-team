import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adapt, validateConfig } from '../scripts/project.mjs';
test('copy adapts from a new product, resets cloud and branding, archives old content and remains idempotent', async () => {
 const parent = await mkdtemp(join(tmpdir(), 'marketing-portable-')); const kit = join(parent, 'marketing');
 try {
  await mkdir(kit); await writeFile(join(parent, 'package.json'), JSON.stringify({ name: 'invoice-helper', description: 'Prepare invoices' }));
  await writeFile(join(parent, 'README.md'), '# Invoice Helper\nEvidence, not a Garba event.');
  const old = { sourceBinding: 'different-repository', workspaceId: 'old-brand', cloud: { projectId: 'old-live-project' } };
  await writeFile(join(kit, 'project.json'), JSON.stringify(old)); await mkdir(join(kit, 'workspace')); await writeFile(join(kit, 'workspace/old.txt'), 'Preserve old content');
  const result = await adapt(kit);
  assert.equal(result.config.name, 'invoice-helper'); assert.equal(result.config.cloud, null); assert.equal(result.config.socialHandle, '');
  assert.deepEqual(result.config.languages, [{ code: 'en', label: 'English' }]); assert.notEqual(result.config.workspaceId, old.workspaceId);
  const brief = await readFile(join(kit, 'workspace/PROJECT_BRIEF.md'), 'utf8'); assert.match(brief, /Prepare invoices/);
  const archive = (await readdir(join(kit, '.local/archives')))[0]; assert.equal(await readFile(join(kit, '.local/archives', archive, 'workspace/old.txt'), 'utf8'), 'Preserve old content');
  await writeFile(join(kit, 'workspace/BRAND.md'), 'Owner-approved new design');
  assert.equal((await adapt(kit)).changed, false); assert.equal(await readFile(join(kit, 'workspace/BRAND.md'), 'utf8'), 'Owner-approved new design');
  assert.throws(() => validateConfig({ ...result.config, local: { ...result.config.local, projectId: 'real-cloud' } }), /demo/);
  assert.throws(() => validateConfig({ ...result.config, local: { ...result.config.local, ports: { ...result.config.local.ports, api: result.config.local.ports.web } } }), /distinct/);
 } finally { await rm(parent, { recursive: true, force: true }); }
});
