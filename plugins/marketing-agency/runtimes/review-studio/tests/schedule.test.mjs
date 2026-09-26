import test from 'node:test';import assert from 'node:assert/strict';
import {scheduledTransition} from '../scripts/schedule-record.mjs';
const post={id:'id',version:2,revision:1,status:'approved',contentHash:'hash',caption:'Caption'};
const schedule={verification:'verified',postId:'id',contentHash:'hash',caption:'Caption',version:2,jobId:'job_1',at:'2026-09-27T04:30:00Z',pageId:'123',instagramAccountId:'456',channels:['facebook','instagram'],mediaUrls:['https://example.com/a.png']};
const live={id:'job_1',status:'queued',at:schedule.at,pageId:'123',channels:schedule.channels,message:'Caption',visibility:'public',optimizeCopy:false,imageUrl:schedule.mediaUrls[0]};
test('confirmed schedule marks handoff posted, preserves approval and never fabricates publication',()=>{
 const next=scheduledTransition(post,schedule,live,'now');assert.equal(next.status,'posted');assert.equal(next.version,3);assert.equal(next.revision,1);assert.equal(next.publications,undefined);assert.equal(next.handoffs[0].approvedVersion,2);assert.equal(scheduledTransition(next,schedule,live,'later'),next);
});
test('schedule handoff rejects stale approval, wrong page, changed media and failed queue',()=>{
 for(const changed of [{...post,status:'rejected'},{...post,version:3},{...post,contentHash:'changed'}])assert.throws(()=>scheduledTransition(changed,schedule,live,'now'));
 for(const changed of [{...live,status:'failed'},{...live,pageId:'other'},{...live,imageUrl:'https://example.com/changed.png'},{...live,message:'Different'}])assert.throws(()=>scheduledTransition(post,schedule,changed,'now'));
});
test('video queue responses may contain empty image arrays and empty image URL',()=>{
 const videoSchedule={...schedule,mediaUrls:['https://example.com/a.mp4']};
 const video={...live,imageUrls:[],imageUrl:'',videoUrl:videoSchedule.mediaUrls[0]};
 assert.equal(scheduledTransition(post,videoSchedule,video,'now').status,'posted');
});
test('cloud handoff commit guards post and schedule, saves history, and verifies the result',async()=>{
 const {recordScheduled}=await import('../scripts/schedule-record.mjs');const {fields,values}=await import('../scripts/cloud-submission.mjs');
 const id='bafc082c-ef26-4db9-ae28-82f2b07b6768';let current={...post,id};const record={...schedule,postId:id};const commits=[];
 const client={config:{workspaceId:'workspace',cloud:{projectId:'project'}},docs:'https://firestore.googleapis.com/v1/projects/project/databases/db/documents',api:async(url,method,body)=>{
  if(method==='POST'){commits.push(body);current=values(body.writes[0].update.fields);return{};}
  return{fields:fields(url.endsWith('/schedules/job_1')?record:current),updateTime:url.endsWith('/schedules/job_1')?'schedule-time':'post-time'};
 }};
 assert.equal((await recordScheduled(client,id,'job_1',live)).verified,true);assert.equal(commits.length,1);assert.equal(commits[0].writes.length,3);assert.deepEqual(commits[0].writes[0].currentDocument,{updateTime:'post-time'});assert.deepEqual(commits[0].writes[2].currentDocument,{updateTime:'schedule-time'});
 await recordScheduled(client,id,'job_1',live);assert.equal(commits.length,1);
});
