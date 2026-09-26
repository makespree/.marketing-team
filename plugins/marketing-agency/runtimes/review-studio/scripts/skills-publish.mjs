import { readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { discoverTeamSkills } from './skill-discovery.mjs';
const kit = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = join(kit, 'skill-sources.json');
async function registry() { try { return JSON.parse(await readFile(registryPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; return []; } }
const sources = await discoverTeamSkills(kit, await registry());
await mkdir(join(kit, '.local'), { recursive: true });
const temporary = join(kit, '.local', `skill-import-${randomUUID()}.json`);
try {
  await writeFile(temporary, JSON.stringify(sources, null, 2));
  await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [join(kit, 'scripts/skills-import.mjs'), temporary], { cwd: kit, stdio: 'inherit' });
    child.on('error', reject); child.on('exit', code => code === 0 ? accept() : reject(Error(`Skill cloud registration failed (${code}). Keep local skills and resolve the error; do not claim cloud delivery.`)));
  });
  const current = await registry(), additions = sources.filter(s => !current.some(c => c.id === s.id));
  if (additions.length) {
    const temp = registryPath + '.' + randomUUID() + '.tmp';
    await writeFile(temp, JSON.stringify([...current, ...additions], null, 2) + '\n'); await rename(temp, registryPath);
  }
  console.log(`Team skill registration verified: ${sources.length} local skills checked; ${additions.length} registry entries added. Existing cloud revisions were not replaced.`);
} finally { await rm(temporary, { force: true }); }
