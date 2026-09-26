import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mediaType, nextPost, parseContent } from '../server/content-review.js';
import { config } from '../server/config.js';
const content = { title: 'Product feature', caption: 'Ready to try it?', language: config.languages[0]!.code, placement: 'feed', assets: [randomUUID()] };
test('review decisions bind to a revision, edits clear approval and stale decisions fail', () => {
  const id = randomUUID();
  const draft = nextPost(undefined, { action: 'save', expectedVersion: 0, content }, id, 'first-hash', '2026-09-23');
  const approved = nextPost(draft, { action: 'review', expectedVersion: 1, status: 'approved', feedback: '' }, id, '', '2026-09-24');
  assert.equal(approved.contentHash, 'first-hash'); assert.equal(approved.revision, 1);
  assert.throws(() => nextPost(approved, { action: 'review', expectedVersion: 1, status: 'rejected', feedback: 'No' }, id, '', 'today'), /changed/);
  const changed = nextPost(approved, { action: 'save', expectedVersion: 2, content: { ...content, caption: 'New caption' } }, id, 'next-hash', '2026-09-25');
  assert.equal(changed.status, 'needs-review'); assert.equal(changed.revision, 2); assert.equal(changed.contentHash, 'next-hash'); assert.equal(changed.feedback, '');
});
test('reject empty feedback, injected status, other languages and duplicate files', () => {
  assert.throws(() => parseContent({ ...content, status: 'approved' }));
  assert.throws(() => parseContent({ ...content, language: 'unsupported-language' }));
  assert.throws(() => parseContent({ ...content, assets: [content.assets[0], content.assets[0]] }));
  const draft = nextPost(undefined, { action: 'save', expectedVersion: 0, content }, randomUUID(), 'hash', 'now');
  assert.throws(() => nextPost(draft, { action: 'review', expectedVersion: 1, status: 'rejected', feedback: ' ' }, draft.id, '', 'now'));
});
test('media sniffing excludes active HTML/SVG and empty files', () => {
  assert.throws(() => mediaType(Buffer.from('<svg onload="alert(1)"></svg>')));
  assert.throws(() => mediaType(Buffer.alloc(0)));
  assert.equal(mediaType(Buffer.from('89504e470d0a1a0a', 'hex')), 'image/png');
  assert.equal(mediaType(Buffer.from('000000186674797069736f6d00000000', 'hex')), 'video/mp4');
});
test('posted revisions cannot be reviewed back to approved; edits preserve publication history', () => {
 const draft = nextPost(undefined,{action:'save',expectedVersion:0,content},randomUUID(),'hash','now');
 const posted = {...draft,status:'posted' as const,handoffs:[{provider:'hermoso',jobId:'job_1',status:'queued',at:'later',channels:['instagram'],revision:1,contentHash:'hash',approvedVersion:1,checkedAt:'now'}],publications:[{provider:'hermoso',channel:'instagram',account:'@brand',platformPostId:'123',url:'https://www.instagram.com/p/abc/',postedAt:'now',revision:1,contentHash:'hash'}]};
 assert.throws(()=>nextPost(posted,{action:'review',expectedVersion:1,status:'approved',feedback:''},posted.id,'','now'),/already posted/);
 assert.throws(()=>nextPost(draft,{action:'review',expectedVersion:1,status:'posted',feedback:''},draft.id,'','now'));
 const revised=nextPost(posted,{action:'save',expectedVersion:1,content:{...content,caption:'Updated'}},posted.id,'new-hash','later');
 assert.equal(revised.status,'needs-review');assert.equal(revised.revision,2);assert.deepEqual(revised.publications,posted.publications);assert.deepEqual(revised.handoffs,posted.handoffs);
});
test('linked post lookup requires auth, stays in this workspace and handles missing posts', async () => {
 const {contentReview}=await import('../server/content-review.js');
 const id=randomUUID(),paths:string[]=[];let exists=true,output:any;
 const services={environment:'local',auth:{verifyIdToken:async()=>({uid:'u'}),getUser:async()=>({customClaims:{marketingWorkspaces:[config.workspaceId]}})},db:{collection:(name:string)=>{paths.push(name);return{doc:(workspace:string)=>{paths.push(workspace);return{collection:(collection:string)=>({doc:(postId:string)=>{paths.push(collection,postId);return{get:async()=>({exists,data:()=>({id:postId,...content})})};}})};}};}}};
 const req=(token?:string,query={})=>({method:'GET',query,get:()=>token});const res={json:(data:unknown)=>{output=data;}};
 await assert.rejects(contentReview(req() as never,res as never,services as never,`/marketing/posts/${id}`),{status:401});assert.equal(paths.length,0);
 await contentReview(req('Bearer test') as never,res as never,services as never,`/marketing/posts/${id}`);assert.equal(output.post.id,id);assert.deepEqual(paths,['marketingWorkspaces',config.workspaceId,'posts',id]);
 await assert.rejects(contentReview(req('Bearer test',{workspace:'other'}) as never,res as never,services as never,`/marketing/posts/${id}`),{status:400});
 exists=false;await assert.rejects(contentReview(req('Bearer test') as never,res as never,services as never,`/marketing/posts/${id}`),{status:404});
});

test('who saved, reviewed and last changed a post is stamped; the creator never changes', () => {
  const content = { title: 'Who', caption: 'c', language: config.languages[0]!.code, placement: 'feed', assets: [randomUUID()] };
  const draft = nextPost(undefined, { action: 'save', expectedVersion: 0, content }, randomUUID(), 'h1', 'now', 'Asha');
  assert.equal(draft.createdBy, 'Asha'); assert.equal(draft.updatedBy, 'Asha'); assert.equal(draft.reviewedBy, undefined);
  const reviewed = nextPost(draft, { action: 'review', expectedVersion: 1, status: 'approved', feedback: '' }, draft.id, '', 'later', 'Bhavin');
  assert.equal(reviewed.createdBy, 'Asha'); assert.equal(reviewed.reviewedBy, 'Bhavin'); assert.equal(reviewed.updatedBy, 'Bhavin');
  const edited = nextPost(reviewed, { action: 'save', expectedVersion: 2, content: { ...content, caption: 'd' } }, draft.id, 'h2', 'latest', 'Chirag');
  assert.equal(edited.createdBy, 'Asha'); assert.equal(edited.updatedBy, 'Chirag');
  const legacy = nextPost(undefined, { action: 'save', expectedVersion: 0, content }, randomUUID(), 'h3', 'now');
  assert.equal(legacy.createdBy, undefined);
});
