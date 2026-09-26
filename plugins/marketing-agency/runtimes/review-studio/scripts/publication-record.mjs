import { createHash } from 'node:crypto';
import { fields, values } from './cloud-submission.mjs';

export function publicationTransition(post, plan, receipt, readback, now, approvedSource) {
  receipt = normalizeFacebookJobReceipt(receipt, readback);
  const published = receipt.result?.structuredContent;
  if (published?.target === 'facebook') return facebookTransition(post, plan, receipt, readback, now, approvedSource);
  const media = readback?.media?.find(item => item.id === published?.postId);
  if (receipt.result?.isError || published?.ok !== true || published.target !== 'instagram' || !media) throw Error('Publication has not been verified.');
  if (receipt.postId !== plan.postId || post.id !== plan.postId || receipt.version !== plan.expectedVersion || receipt.args?.target !== 'instagram' || receipt.args?.message !== plan.caption || receipt.args?.account !== readback.instagramId || published.account !== readback.account || media.caption !== plan.caption) throw Error('Publication identity or caption mismatch.');
  const url = new URL(media.permalink);
  if (url.protocol !== 'https:' || url.hostname !== 'www.instagram.com' || !/^\/(p|reel)\/[\w-]+\/$/.test(url.pathname) || url.search || url.hash || published.url !== url.href) throw Error('Invalid publication link.');
  if (!/^\d+$/.test(media.id) || !Number.isFinite(Date.parse(media.timestamp))) throw Error('Invalid publication receipt.');
  const existing = post.publications?.find(p => p.channel === 'instagram' && p.platformPostId === media.id);
  if (existing) {
    if (existing.contentHash !== plan.contentHash || existing.url !== url.href) throw Error('Conflicting publication receipt.');
    return post; // A retry must not reset a newer draft or create duplicate history.
  }
  assertApprovedRevision(post, plan, approvedSource, published.target);
  const publication = { provider: 'hermoso', channel: 'instagram', account: readback.account, platformPostId: media.id, url: url.href, postedAt: new Date(media.timestamp).toISOString(), revision: post.revision, contentHash: post.contentHash };
  return { ...post, status: 'posted', version: post.version + 1, updatedAt: now, publications: [...(post.publications ?? []), publication] };
}

// Async Facebook Reels return a video ID; the Page feed has a separate post ID.
// Bind the finished job to its original request and exact live Page permalink.
export function normalizeFacebookJobReceipt(receipt, readback) {
  const queued = receipt.result?.structuredContent;
  if (!queued?.queued || queued.target !== 'facebook') return receipt;
  const job = receipt.jobResult?.structuredContent;
  const results = job?.result?.data?.results;
  if (receipt.result.isError || receipt.jobResult?.isError || job?.id !== queued.jobId || job.status !== 'done' || job.type !== 'socialpost' || job.profileId !== receipt.args?.brand || results?.length !== 1) throw Error('Facebook publishing job has not been verified.');
  const result = results[0];
  const safeReel = value => { const u = new URL(value); if (u.protocol !== 'https:' || !['facebook.com','www.facebook.com'].includes(u.hostname) || u.username || u.password || u.search || u.hash || !/^\/reel\/\d+\/?$/.test(u.pathname)) throw Error('Invalid Reel link.'); return u.pathname.replace(/\/$/, ''); };
  if (!result.ok || result.channel !== 'facebook' || result.visibility !== 'public' || !/^\d+$/.test(result.id) || safeReel(result.url) !== `/reel/${result.id}`) throw Error('Facebook Reel has not published.');
  const media = readback?.posts?.find(p => p.mediaKind === 'video' && safeReelCandidate(p.url, result.id));
  function safeReelCandidate(url, id) { try { return safeReel(url) === `/reel/${id}`; } catch { return false; } }
  if (!media || readback.pageId !== receipt.args.pageId || readback.target !== 'facebook') throw Error('Facebook Reel is not on the expected Page.');
  return {...receipt, result:{structuredContent:{ok:true,target:'facebook',pageId:readback.pageId,page:readback.account,postId:media.id,url:result.url,reelId:result.id}}};
}

function facebookTransition(post, plan, receipt, readback, now, approvedSource) {
  const published = receipt.result?.structuredContent;
  const media = readback?.posts?.find(item => item.id === published?.postId);
  const pageId = receipt.args?.pageId;
  if (receipt.result?.isError || published?.ok !== true || !media || readback.target !== 'facebook') throw Error('Publication has not been verified.');
  if (receipt.postId !== plan.postId || post.id !== plan.postId || receipt.version !== plan.expectedVersion || receipt.args?.target !== 'facebook' || receipt.args?.message !== plan.caption || media.caption !== plan.caption || !/^\d+$/.test(pageId ?? '') || published.pageId !== pageId || readback.pageId !== pageId || published.page !== readback.account) throw Error('Publication identity or caption mismatch.');
  const parts = media.id.split('_');
  if (parts.length !== 2 || parts[0] !== pageId || !/^\d+$/.test(parts[1]) || !Number.isFinite(Date.parse(media.publishedAt))) throw Error('Invalid publication receipt.');
  const url = new URL(media.url), receiptUrl = new URL(published.url);
  const safe = u => u.protocol === 'https:' && ['facebook.com', 'www.facebook.com'].includes(u.hostname) && !u.search && !u.hash && !u.username && !u.password;
  const canonical = new RegExp(`^/\\d+/posts/${parts[1]}/?$`);
  const reel = published.reelId && /^\d+$/.test(published.reelId) && media.mediaKind === 'video' && url.pathname.replace(/\/$/, '') === `/reel/${published.reelId}` && receiptUrl.pathname.replace(/\/$/, '') === `/reel/${published.reelId}`;
  if (!safe(url) || !safe(receiptUrl) || (!reel && (receiptUrl.pathname !== `/${media.id}` || !(url.pathname === `/${media.id}` || canonical.test(url.pathname))))) throw Error('Invalid publication link.');
  const existing = post.publications?.find(p => p.channel === 'facebook' && p.platformPostId === media.id);
  if (existing) {
    if (existing.contentHash !== plan.contentHash || existing.url !== url.href) throw Error('Conflicting publication receipt.');
    return post;
  }
  assertApprovedRevision(post, plan, approvedSource, published.target);
  const publication = {provider:'hermoso',channel:'facebook',account:readback.account,platformPostId:media.id,url:url.href,postedAt:new Date(media.publishedAt).toISOString(),revision:post.revision,contentHash:post.contentHash};
  return {...post,status:'posted',version:post.version+1,updatedAt:now,publications:[...(post.publications ?? []),publication]};
}

function assertApprovedRevision(post, plan, approvedSource, channel) {
  if (post.status === 'approved' && post.version === plan.expectedVersion && post.contentHash === plan.contentHash && post.caption === plan.caption) return;
  const source = approvedSource;
  const same = source && ['id', 'revision', 'contentHash', 'caption', 'placement', 'language', 'title'].every(key => post[key] === source[key]) && JSON.stringify(post.assets) === JSON.stringify(source.assets);
  const publications = post.publications ?? [];
  if (post.status !== 'posted' || post.version <= plan.expectedVersion || !same || source.status !== 'approved' || source.version !== plan.expectedVersion || source.id !== plan.postId || source.contentHash !== plan.contentHash || source.caption !== plan.caption || !(publications.some(p => p.contentHash === plan.contentHash && p.revision === post.revision) || post.handoffs?.some(h => h.contentHash === plan.contentHash && h.revision === post.revision && h.approvedVersion === plan.expectedVersion && h.channels.includes(channel))) || publications.some(p => p.channel === channel && p.contentHash === plan.contentHash && p.revision === post.revision)) throw Error('Approved revision changed; reconcile the publication before recording it.');
}

export async function recordPublication(client, plan, receipt, readback) {
  receipt = normalizeFacebookJobReceipt(receipt, readback);
  const {config, api, docs} = client;
  if (plan.workspaceId !== config.workspaceId) throw Error('Wrong workspace.');
  if (!/^[a-f0-9-]{36}$/.test(plan.postId)) throw Error('Invalid post ID.');
  const url = `${docs}/marketingWorkspaces/${config.workspaceId}/posts/${plan.postId}`;
  const current = await api(url), old = values(current.fields);
  const published = receipt.result?.structuredContent;
  const alreadyRecorded = old.publications?.some(p => p.channel === published?.target && p.platformPostId === published?.postId);
  const approvedSource = old.status === 'posted' && !alreadyRecorded ? values((await api(`${url}/history/${plan.expectedVersion}`)).fields) : undefined;
  const post = publicationTransition(old, plan, receipt, readback, new Date().toISOString(), approvedSource);
  if (post !== old) {
    const name = u => u.slice(u.indexOf('/projects/') + 1);
    const write = (u, data, condition) => ({ update: { name: name(u), fields: fields(data) }, currentDocument: condition });
    const digest = createHash('sha256').update(JSON.stringify(post.publications.at(-1))).digest('hex');
    await api(docs + ':commit', 'POST', {writes: [
      write(url, post, {updateTime: current.updateTime}),
      write(`${url}/history/${post.version}`, {...post, actor: 'hermoso-publisher'}, {exists: false}),
      write(`${url}/operations/publication-${digest}`, {digest, actor: 'hermoso-publisher', result: post}, {exists: false}),
    ]});
  }
  const confirmed = values((await api(url)).fields);
  if (!confirmed.publications?.some(p => p.platformPostId === receipt.result.structuredContent.postId)) throw Error('Cloud publication record verification failed.');
  return {project:config.cloud.projectId,workspace:config.workspaceId,postId:confirmed.id,version:confirmed.version,status:confirmed.status,verified:true};
}
