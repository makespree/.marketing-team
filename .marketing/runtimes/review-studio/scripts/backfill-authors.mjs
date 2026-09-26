// One-time: give existing cloud posts a createdBy and updatedBy from their
// history, which has always recorded the acting user id (or 'developer-cli').
// Reads history, resolves user ids to a display name or email through the
// project's Auth, and patches only posts that lack the fields. Safe to re-run.
//
//   node marketing/scripts/backfill-authors.mjs            dry run: prints what it would set
//   node marketing/scripts/backfill-authors.mjs --write    patch the posts
import { cloudClient, encodeFields } from './cloud-client.mjs';
// Posts carry nested publication records the shared decoder does not handle; only a few flat fields matter here.
const field = (fields, key) => { const v = fields?.[key]; return v ? (v.stringValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : undefined)) : undefined; };
const pick = (fields, keys) => Object.fromEntries(keys.map(k => [k, field(fields, k)]));
const docURL = name => `https://firestore.googleapis.com/v1/${name}`;

const write = process.argv.includes('--write');
const { config, api, request, docs } = await cloudClient();
// The bucket keeps each object's uploader as its owner (per-object ACLs), which
// is the only durable record of who delivered the early posts.
const uploaders = new Map(); { let t = ''; do {
  const r = await (await request(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(config.cloud.storageBucket)}/o?prefix=${encodeURIComponent(`marketing/${config.workspaceId}/`)}&projection=full&maxResults=1000${t ? `&pageToken=${t}` : ''}`)).json();
  for (const o of r.items ?? []) { const e = o.owner?.entity ?? o.acl?.find(a => a.role === 'OWNER')?.entity ?? ''; if (e.startsWith('user-')) uploaders.set(o.name.slice(`marketing/${config.workspaceId}/`.length), e.slice(5)); }
  t = r.nextPageToken ?? ''; } while (t); }
const assetsOf = fields => (fields?.assets?.arrayValue?.values ?? []).map(v => v.stringValue);
const anonymous = v => !v || v === 'developer-cli' || /^[A-Za-z0-9]{20,}$/.test(v);
const postsURL = `${docs}/marketingWorkspaces/${config.workspaceId}/posts`;
const names = new Map();
async function label(actor) {
  if (!actor || !/^[A-Za-z0-9]{20,}$/.test(actor)) return actor || '';
  if (!names.has(actor)) {
    try {
      const r = await (await request(`https://identitytoolkit.googleapis.com/v1/projects/${config.cloud.projectId}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: [actor] }) })).json();
      const u = r.users?.[0]; names.set(actor, u?.displayName || u?.email || actor);
    } catch { names.set(actor, actor); }
  }
  return names.get(actor);
}
let seen = 0, patched = 0;
let pageToken = '';
do {
  const page = await api(`${postsURL}?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`);
  for (const doc of page.documents ?? []) {
    seen++;
    const post = pick(doc.fields, ['id', 'title', 'createdBy', 'updatedBy', 'reviewedBy']);
    const uploader = [...new Set(assetsOf(doc.fields).map(a => uploaders.get(a)).filter(Boolean))];
    if (uploader.length === 1 && (anonymous(post.createdBy) || anonymous(post.updatedBy))) {
      const patch = {};
      if (anonymous(post.createdBy)) patch.createdBy = uploader[0];
      if (anonymous(post.updatedBy)) patch.updatedBy = uploader[0];
      console.log(`${write ? 'patch' : 'would set'} ${post.id} "${String(post.title).slice(0, 40)}" from uploader ->`, patch);
      if (write) { const mask = Object.keys(patch).map(k => `updateMask.fieldPaths=${k}`).join('&'); await api(`${docURL(doc.name)}?${mask}`, 'PATCH', { fields: encodeFields(patch) }); patched++; }
      continue;
    }
    if (post.createdBy && post.updatedBy) continue;
    const history = await api(`${docURL(doc.name)}/history?pageSize=300`);
    const entries = (history.documents ?? []).map(d => pick(d.fields, ['version', 'actor', 'status'])).sort((a, b) => a.version - b.version);
    if (!entries.length) { console.log(`skip ${post.id}: no history`); continue; }
    const first = entries[0], last = entries[entries.length - 1];
    const patch = {};
    if (!post.createdBy) patch.createdBy = await label(first.actor);
    if (!post.updatedBy) patch.updatedBy = await label(last.actor);
    const lastReview = [...entries].reverse().find(e => e.status !== 'needs-review');
    if (!post.reviewedBy && lastReview && lastReview.status !== 'posted') patch.reviewedBy = await label(lastReview.actor);
    console.log(`${write ? 'patch' : 'would set'} ${post.id} "${String(post.title).slice(0, 40)}" ->`, patch);
    if (write) {
      const mask = Object.keys(patch).map(k => `updateMask.fieldPaths=${k}`).join('&');
      await api(`${docURL(doc.name)}?${mask}`, 'PATCH', { fields: encodeFields(patch) });
      patched++;
    }
  }
  pageToken = page.nextPageToken ?? '';
} while (pageToken);
console.log(`${seen} posts seen, ${patched} patched${write ? '' : ' (dry run)'}`);
