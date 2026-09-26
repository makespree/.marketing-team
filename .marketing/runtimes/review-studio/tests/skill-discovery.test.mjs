import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverTeamSkills } from '../scripts/skill-discovery.mjs';

test('discovers new team guidance without enrolling installed/shared dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marketing-skills-')), kit = join(root, 'marketing');
  async function skill(id, content = `---\nname: ${id}\ndescription: "A design guide."\n---\n# ${id}\n`) {
    await mkdir(join(kit, 'skills', id), { recursive: true }); await writeFile(join(kit, 'skills', id, 'SKILL.md'), content);
  }
  try {
    await skill('new-design'); await skill('existing'); await skill('marketing-workflow'); await skill('vendor-tool');
    const existing = { id: 'existing', title: 'Keep title', sourceRoot: 'marketing/skills/existing', management: 'team', category: 'Production' };
    const list = await discoverTeamSkills(kit, [existing, { id: 'vendor-tool', management: 'dependency' }]);
    assert.deepEqual(list.map(s => s.id), ['existing', 'new-design']); assert.deepEqual(list[0], existing);
    assert.equal(list[1].management, 'team'); assert.equal(list[1].description, 'A design guide.');
    await assert.rejects(discoverTeamSkills(kit, [{ ...existing, sourceRoot: '.agents/skills/existing' }]), /different path/);
    await skill('wrong', '---\nname: another\ndescription: Invalid\n---\n');
    await assert.rejects(discoverTeamSkills(kit), /matching folder/);
    await rm(join(kit, 'skills', 'wrong'), { recursive: true });
    await symlink(join(kit, 'skills', 'new-design'), join(kit, 'skills', 'linked'));
    await assert.rejects(discoverTeamSkills(kit), /symbolic links/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
