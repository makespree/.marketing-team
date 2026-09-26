import {fields,values} from './cloud-submission.mjs';

// Posted is the owner's handoff state. This never creates a live publication.
export function scheduledTransition(post, schedule, live, now) {
  if (!schedule || schedule.verification !== 'verified' || schedule.postId !== post.id || schedule.contentHash !== post.contentHash || schedule.caption !== post.caption) throw Error('Schedule does not match the approved content.');
  if (!live || live.id !== schedule.jobId || live.status !== 'queued' || live.contentLost || live.message !== post.caption || Date.parse(live.at) !== Date.parse(schedule.at) || live.pageId !== schedule.pageId || live.visibility !== 'public' || live.optimizeCopy !== false || JSON.stringify(live.channels) !== JSON.stringify(schedule.channels) || JSON.stringify(live.imageUrls?.length ? live.imageUrls : [live.imageUrl || live.videoUrl]) !== JSON.stringify(schedule.mediaUrls)) throw Error('Hermoso queue verification failed.');
  const existing = post.handoffs?.find(h => h.jobId === schedule.jobId);
  if (existing) {
    if (existing.contentHash !== schedule.contentHash || existing.at !== schedule.at) throw Error('Conflicting handoff.');
    return post;
  }
  if (post.status !== 'approved' || post.version !== schedule.version) throw Error('Approved revision changed.');
  const handoff = {provider:'hermoso',jobId:schedule.jobId,status:'queued',at:schedule.at,channels:schedule.channels,pageId:schedule.pageId,instagramAccountId:schedule.instagramAccountId,revision:post.revision,contentHash:post.contentHash,approvedVersion:schedule.version,checkedAt:now};
  return {...post,status:'posted',version:post.version+1,updatedAt:now,handoffs:[...(post.handoffs??[]),handoff]};
}

export async function recordScheduled(client, postId, jobId, live) {
  if (!/^[a-f0-9-]{36}$/.test(postId) || !/^job_[a-zA-Z0-9]+$/.test(jobId)) throw Error('Invalid schedule identity.');
  const {config,api,docs}=client, url=`${docs}/marketingWorkspaces/${config.workspaceId}/posts/${postId}`;
  const current=await api(url), scheduleDoc=await api(`${url}/schedules/${jobId}`), schedule=values(scheduleDoc.fields), old=values(current.fields);
  const post=scheduledTransition(old,schedule,live,new Date().toISOString());
  if(post!==old){
    const name=u=>u.slice(u.indexOf('/projects/')+1);
    await api(docs+':commit','POST',{writes:[
      {update:{name:name(url),fields:fields(post)},currentDocument:{updateTime:current.updateTime}},
      {update:{name:name(`${url}/history/${post.version}`),fields:fields({...post,actor:'hermoso-scheduler'})},currentDocument:{exists:false}},
      {verify:name(`${url}/schedules/${jobId}`),currentDocument:{updateTime:scheduleDoc.updateTime}}
    ]});
  }
  const saved=values((await api(url)).fields);
  if(!saved.handoffs?.some(h=>h.jobId===jobId&&h.contentHash===schedule.contentHash))throw Error('Cloud handoff verification failed.');
  return {project:config.cloud.projectId,workspace:config.workspaceId,postId,version:saved.version,status:saved.status,scheduleStatus:'queued',jobId,at:schedule.at,verified:true};
}
