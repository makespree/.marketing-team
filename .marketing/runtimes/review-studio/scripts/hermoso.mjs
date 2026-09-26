import fs from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { HermosoClient, approvedExportPlan } from './hermoso-client.mjs';
const kit = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(kit, '.local', 'hermoso');
async function write(name, data) { await fs.mkdir(directory, { recursive: true, mode: 0o700 }); await fs.writeFile(join(directory, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); }
try {
  const [command, arg] = process.argv.slice(2);
  if (command === 'inspect') {
    let token = process.env.HERMOSO_TOKEN;
    if (!token) {
      const file = join(directory, 'api-key');
      try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077))) throw Error('Hermoso key must be a regular file with permissions 600.');
        token = (await fs.readFile(file, 'utf8')).trim();
      } catch (e) { if (e.code !== 'ENOENT') throw e; throw Error('Create a Terminal & API key in Hermoso, then save it to ignored marketing/.local/hermoso/api-key with permissions 600. Do not paste it in chat.'); }
    }
    const client = new HermosoClient(token);
    if (!arg) {
      const list = await client.brands();
      console.log(JSON.stringify({ brands: list.data?.map(({ id, name, shared, role }) => ({ id, name, shared, role })), next: 'Run inspect <exact-project-brand-id> to check that workspace.' }, null, 2));
    } else {
      const brand = await client.selectBrand(arg), channels = await client.channels();
      const tools = {};
      for (const name of ['list_connector_accounts', 'list_meta_pages', 'post_to_instagram', 'post_to_meta', 'schedule_post', 'create_meta_ad', 'set_meta_campaign_status']) {
        try { tools[name] = await client.schema(name); } catch (e) { tools[name] = { unavailable: true, reason: e.message }; }
      }
      const accounts = {};
      for (const [name, args] of [['list_connector_accounts', { provider: 'meta' }], ['list_connector_accounts', { provider: 'instagram' }], ['list_meta_pages', {}]]) {
        const key = args.provider ? `${name}:${args.provider}` : name;
        try { accounts[key] = await client.readTool(name, args); } catch (e) { accounts[key] = { unavailable: true, reason: e.message }; }
      }
      const report = { checkedAt: new Date().toISOString(), brand, channels, tools, accounts, writesEnabled: false };
      await write('connection-report.json', report);
      console.log(JSON.stringify({ brand, channels: channels.data, accounts, report: join(directory, 'connection-report.json'), writesEnabled: false }, null, 2));
    }
  } else if (command === 'prepare') {
    if (!/^[a-f0-9-]{36}$/.test(arg ?? '')) throw Error('Pass a studio post UUID.');
    const { cloudClient } = await import('./cloud-client.mjs');
    const { values } = await import('./cloud-submission.mjs');
    const { config, api, request, docs } = await cloudClient();
    const base = `${docs}/marketingWorkspaces/${config.workspaceId}`;
    const readPost = async () => values((await api(`${base}/posts/${arg}`)).fields);
    const post = await readPost();
    if (post.status !== 'approved') throw Error('This post needs approval in the studio. No media was transferred.');
    const assets = [];
    for (const id of post.assets) assets.push(values((await api(`${base}/assets/${id}`)).fields));
    const plan = approvedExportPlan(post, assets);
    for (const asset of plan.assets) {
      const url = `https://storage.googleapis.com/storage/v1/b/${config.cloud.storageBucket}/o/${encodeURIComponent(`marketing/${config.workspaceId}/${asset.id}`)}?alt=media&generation=${asset.generation}`;
      const bytes = Buffer.from(await (await request(url)).arrayBuffer());
      if (bytes.length !== asset.size || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw Error('Firebase media hash mismatch.');
    }
    const latest = await readPost();
    if (latest.status !== 'approved' || latest.version !== post.version || latest.contentHash !== post.contentHash) throw Error('Post changed while preparing. Refresh and retry.');
    await write(`post-${arg}-v${post.version}.json`, { workspaceId: config.workspaceId, ...plan });
    console.log(`Prepared and verified ${plan.assets.length} approved assets, revision ${post.revision}. Preview: ${join(directory, `post-${arg}-v${post.version}.json`)}. Nothing sent to Hermoso.`);
  } else throw Error('Usage: node marketing/scripts/hermoso.mjs inspect [brand-id] | prepare <studio-post-id>');
} catch (e) { console.error(e.message); process.exitCode = 1; }
