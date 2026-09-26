import test from 'node:test';import assert from 'node:assert/strict';
import {publicationTransition,recordPublication} from '../scripts/publication-record.mjs';
import {fields} from '../scripts/cloud-submission.mjs';
const url='https://www.instagram.com/p/abc/';
const post={id:'bafc082c-ef26-4db9-ae28-82f2b07b6768',version:2,revision:1,status:'approved',contentHash:'hash',caption:'Caption'};
const plan={postId:post.id,expectedVersion:2,contentHash:'hash',caption:'Caption',workspaceId:'workspace'};
const receipt={postId:post.id,version:2,args:{account:'123',target:'instagram',message:'Caption'},result:{structuredContent:{ok:true,target:'instagram',account:'@brand',postId:'456',url}}};
const readback={instagramId:'123',account:'@brand',media:[{id:'456',caption:'Caption',permalink:url,timestamp:'2026-09-24T04:25:54Z'}]};
test('posted requires exact successful receipt, account, caption, approved version and safe URL',()=>{
 const p=publicationTransition(post,plan,receipt,readback,'now');assert.equal(p.status,'posted');assert.equal(p.version,3);assert.equal(p.revision,1);assert.equal(p.publications[0].url,url);
 for(const changed of [{...post,status:'needs-review'},{...post,version:3},{...post,contentHash:'other'}])assert.throws(()=>publicationTransition(changed,plan,receipt,readback,'now'));
 assert.throws(()=>publicationTransition(post,plan,{...receipt,result:{isError:true}},readback,'now'));
 assert.throws(()=>publicationTransition(post,plan,receipt,{...readback,instagramId:'wrong'},'now'));
 assert.throws(()=>publicationTransition(post,plan,receipt,{...readback,media:[{...readback.media[0],caption:'Wrong'}]},'now'));
 assert.throws(()=>publicationTransition(post,plan,receipt,{...readback,media:[{...readback.media[0],permalink:'javascript:alert(1)'}]},'now'));
 const newer={...p,status:'needs-review',version:4};assert.equal(publicationTransition(newer,plan,receipt,readback,'later'),newer);
});
test('recording publication atomically guards current version and preserves immutable history; retry is read-only',async()=>{
 let current=post;const commits=[];const client={config:{workspaceId:'workspace',cloud:{projectId:'demo'}},docs:'https://firestore.googleapis.com/v1/projects/demo/databases/test/documents',api:async(u,method,body)=>{if(method==='POST'){commits.push(body);current=publicationTransition(post,plan,receipt,readback,'now');return{};}return{fields:fields(current),updateTime:'server-update-time'};}};
 assert.equal((await recordPublication(client,plan,receipt,readback)).status,'posted');assert.equal(commits.length,1);assert.equal(commits[0].writes.length,3);assert.deepEqual(commits[0].writes[0].currentDocument,{updateTime:'server-update-time'});assert.deepEqual(commits[0].writes[1].currentDocument,{exists:false});
 await recordPublication(client,plan,receipt,readback);assert.equal(commits.length,1);
});
test('Facebook requires verified Page, post, caption and matching safe permalink',()=>{
 const fbReceipt={postId:post.id,version:2,args:{pageId:'123',target:'facebook',message:'Caption'},result:{structuredContent:{ok:true,target:'facebook',pageId:'123',page:'Brand',postId:'123_456',url:'https://facebook.com/123_456'}}};
 const fbReadback={target:'facebook',pageId:'123',account:'Brand',posts:[{id:'123_456',caption:'Caption',url:'https://www.facebook.com/999/posts/456',publishedAt:'2026-09-24T11:21:34+0000'}]};
 const next=publicationTransition(post,plan,fbReceipt,fbReadback,'now');assert.equal(next.status,'posted');assert.equal(next.publications[0].channel,'facebook');
 for(const bad of [{...fbReadback,pageId:'999'},{...fbReadback,posts:[]},{...fbReadback,posts:[{...fbReadback.posts[0],caption:'wrong'}]},{...fbReadback,posts:[{...fbReadback.posts[0],url:'https://evil.example/999/posts/456'}]},{...fbReadback,posts:[{...fbReadback.posts[0],url:'https://www.facebook.com/999/posts/789'}]}])assert.throws(()=>publicationTransition(post,plan,fbReceipt,bad,'now'));
 assert.throws(()=>publicationTransition({...post,version:3},plan,fbReceipt,fbReadback,'now'));
 assert.equal(publicationTransition({...next,status:'needs-review'},plan,fbReceipt,fbReadback,'later').status,'needs-review');
});
test('async Facebook Reel is tied to completed job, explicit brand and live Page feed',()=>{
 const r={postId:post.id,version:2,args:{brand:'default',pageId:'123',target:'facebook',message:'Caption'},result:{structuredContent:{queued:true,target:'facebook',jobId:'job1'}},jobResult:{structuredContent:{id:'job1',profileId:'default',type:'socialpost',status:'done',result:{data:{results:[{ok:true,channel:'facebook',visibility:'public',id:'789',url:'https://facebook.com/reel/789'}]}}}}};
 const b={target:'facebook',pageId:'123',account:'Brand',posts:[{id:'123_456',caption:'Caption',url:'https://www.facebook.com/reel/789/',mediaKind:'video',publishedAt:'2026-09-24T11:21:34Z'}]};
 assert.equal(publicationTransition(post,plan,r,b,'now').publications[0].platformPostId,'123_456');
 for(const change of [{id:'wrong'},{status:'running'},{profileId:'other'}])assert.throws(()=>publicationTransition(post,plan,{...r,jobResult:{structuredContent:{...r.jobResult.structuredContent,...change}}},b,'now'));
 assert.throws(()=>publicationTransition(post,plan,r,{...b,pageId:'999'},'now'));
 assert.throws(()=>publicationTransition(post,plan,r,{...b,posts:[{...b.posts[0],url:'https://facebook.com/reel/999/'}]},'now'));
});
test('second channel requires immutable original approval and unchanged content, and cannot duplicate a channel',()=>{
 const fbReceipt={postId:post.id,version:2,args:{pageId:'123',target:'facebook',message:'Caption'},result:{structuredContent:{ok:true,target:'facebook',pageId:'123',page:'Brand',postId:'123_456',url:'https://facebook.com/123_456'}}};
 const fbReadback={target:'facebook',pageId:'123',account:'Brand',posts:[{id:'123_456',caption:'Caption',url:'https://facebook.com/123_456',publishedAt:'2026-09-24T11:21:34Z'}]};
 const first=publicationTransition(post,plan,fbReceipt,fbReadback,'now');
 const both=publicationTransition(first,plan,receipt,readback,'later',post);
 assert.equal(both.version,4);assert.deepEqual(both.publications.map(p=>p.channel),['facebook','instagram']);
 assert.equal(publicationTransition(both,plan,receipt,readback,'later'),both);
 assert.throws(()=>publicationTransition(first,plan,receipt,readback,'later'));
 for(const change of [{status:'needs-review'},{caption:'changed'},{contentHash:'changed'},{revision:2},{assets:['new']}]) assert.throws(()=>publicationTransition({...first,...change},plan,receipt,readback,'later',post));
 assert.throws(()=>publicationTransition(first,plan,receipt,readback,'later',{...post,status:'needs-review'}));
 const duplicate={...receipt,result:{structuredContent:{...receipt.result.structuredContent,postId:'457'}}};
 assert.throws(()=>publicationTransition(both,plan,duplicate,{...readback,media:[{...readback.media[0],id:'457'}]},'later',post));
 const igFirst=publicationTransition(post,plan,receipt,readback,'now');
 assert.equal(publicationTransition(igFirst,plan,fbReceipt,fbReadback,'later',post).publications.length,2);
});
test('second-channel cloud recording loads original approval and retains CAS history',async()=>{
 const prior={...post,status:'posted',version:3,publications:[{channel:'facebook',platformPostId:'123_456',revision:1,contentHash:'hash'}]};
 let current=prior;const reads=[],commits=[];
 const {values}=await import('../scripts/cloud-submission.mjs');
 const client={config:{workspaceId:'workspace',cloud:{projectId:'demo'}},docs:'https://firestore.googleapis.com/v1/projects/demo/databases/test/documents',api:async(u,method,body)=>{if(method==='POST'){commits.push(body);current=values(body.writes[0].update.fields);return{};}reads.push(u);return{fields:fields(u.endsWith('/history/2')?post:current),updateTime:'cas-time'};}};
 const result=await recordPublication(client,plan,receipt,readback);assert.equal(result.version,4);assert.equal(current.publications.length,2);assert.ok(reads.some(u=>u.endsWith('/history/2')));assert.deepEqual(commits[0].writes[0].currentDocument,{updateTime:'cas-time'});
 await recordPublication(client,plan,receipt,readback);assert.equal(commits.length,1);
});
test('a scheduled Posted card can receive a verified live publication using its original approval',()=>{
 const scheduled={...post,status:'posted',version:3,handoffs:[{revision:1,contentHash:'hash',approvedVersion:2,channels:['instagram']}]};
 const next=publicationTransition(scheduled,plan,receipt,readback,'now',post);assert.equal(next.publications.length,1);assert.equal(next.version,4);
 assert.throws(()=>publicationTransition({...scheduled,handoffs:[]},plan,receipt,readback,'now',post));
 assert.throws(()=>publicationTransition({...scheduled,contentHash:'changed'},plan,receipt,readback,'now',post));
});
