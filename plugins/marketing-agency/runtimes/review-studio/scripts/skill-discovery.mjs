import { readdir, readFile, lstat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

// marketing/skills is for first-party guidance; installed tools live elsewhere.
export async function discoverTeamSkills(kit, registered = []) {
  const discovered = [];
  for (const folder of await readdir(join(kit, 'skills'), { withFileTypes: true })) {
    if (folder.name.startsWith('.')) continue;
    if (folder.isSymbolicLink()) throw Error('Skill directories cannot be symbolic links.');
    if (!folder.isDirectory()) continue;
    const root = join(kit, 'skills', folder.name);
    const sourceRoot = relative(resolve(kit, '..'), root).split('\\').join('/');
    const known = registered.find(s => s.id === folder.name);
    if (folder.name === 'marketing-workflow' || (known && known.management !== 'team')) continue;
    if (known && known.sourceRoot !== sourceRoot) throw Error(`Skill ID is registered at a different path: ${folder.name}`);
    let entry;
    try {
      if (!(await lstat(join(root, 'SKILL.md'))).isFile()) throw Error('SKILL.md must be a regular file.');
      entry = await readFile(join(root, 'SKILL.md'), 'utf8');
    } catch (e) { if (e.code === 'ENOENT') throw Error(`Skill folder is missing SKILL.md: ${folder.name}`); throw e; }
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(entry)?.[1];
    const unquote = s => s?.trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
    const id = unquote(/^name:\s*(.+)$/m.exec(front ?? '')?.[1]);
    const description = unquote(/^description:\s*(.+)$/m.exec(front ?? '')?.[1]);
    if (id !== folder.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id ?? '') || id.length > 64 || !description || /^[>|]/.test(description)) throw Error(`Use matching folder/name and a single-line description: ${folder.name}`);
    const title = /^#\s+(.+)$/m.exec(entry)?.[1]?.trim() ?? id;
    discovered.push(known ?? { id, title, description, category: 'Design', sourceRoot, management: 'team' });
  }
  return discovered.sort((a, b) => a.id.localeCompare(b.id));
}
