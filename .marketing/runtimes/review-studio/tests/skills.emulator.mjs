import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const config=JSON.parse(await readFile(new URL('../project.json',import.meta.url)));
Object.assign(process.env,{MARKETING_ENV:'local',GCLOUD_PROJECT:config.local.projectId,FIREBASE_AUTH_EMULATOR_HOST:`127.0.0.1:${config.local.ports.auth}`,FIRESTORE_EMULATOR_HOST:`127.0.0.1:${config.local.ports.firestore}`,FIREBASE_STORAGE_EMULATOR_HOST:`127.0.0.1:${config.local.ports.storage}`});
const {servicesForRequest}=await import('../lib/server/services.js');const {skillsApi,parseBundle,skillHash}=await import('../lib/server/skills.js');const {getStorage}=await import('firebase-admin/storage');
const services=servicesForRequest(),bucket=getStorage(services.app).bucket(services.bucket),id='test-'+randomUUID(),ref=services.db.collection('marketingWorkspaces').doc(config.workspaceId).collection('skills').doc(id),users=[];
const initial=parseBundle({files:[{path:'SKILL.md',content:'---\nname: test\ndescription: Emulator-only test.\n---\nOriginal instructions'}]});
async function account(workspace){const r=await fetch(`http://127.0.0.1:${config.local.ports.auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`${randomUUID()}@example.test`,password:randomUUID(),returnSecureToken:true})});const user=await r.json();assert.ok(user.idToken);users.push(user.localId);await services.auth.setCustomUserClaims(user.localId,{marketingWorkspaces:[workspace]});return user;}
async function call(user,method='GET',suffix='',body,query={}){let data;const req={method,body,query,get:name=>name==='Authorization'&&user?`Bearer ${user.idToken}`:undefined,is:()=>true};await skillsApi(req,{json:v=>{data=v;}},services,`/marketing/skills/${id}${suffix}`);return data;}
try{
 const owner=await account(config.workspaceId),other=await account('other-workspace');
 const bytes=Buffer.from(JSON.stringify(initial)),file=bucket.file(`marketing/${config.workspaceId}/skills/${id}/initial.json`);await file.save(bytes,{metadata:{contentType:'application/json'}});const [m]=await file.getMetadata();
 const record={id,management:'team',title:'Temporary skill test',category:'Production',description:'test',version:1,note:'Initial',sourceRoot:'test',fileCount:1,updatedAt:new Date().toISOString(),storagePath:file.name,generation:String(m.generation),sha256:skillHash(bytes)};
 await ref.set(record);await ref.collection('revisions').doc('1').set(record);
 await assert.rejects(call(null),e=>e.status===401);await assert.rejects(call(other),e=>e.status===403);assert.deepEqual((await call(owner)).bundle,initial);
 const changed={files:[{...initial.files[0],content:initial.files[0].content+'\nNew direction'}]},body={expectedVersion:1,bundle:changed,note:'Test change',requestId:randomUUID()};
 const saved=await call(owner,'POST','',body);assert.equal(saved.skill.version,2);assert.equal((await call(owner,'POST','',body)).skill.version,2);
 await assert.rejects(call(owner,'POST','',{...body,requestId:randomUUID()}),e=>e.status===409);
 const raced=await Promise.allSettled([call(owner,'POST','',{...body,expectedVersion:2,requestId:randomUUID()}),call(owner,'POST','',{...body,expectedVersion:2,requestId:randomUUID()})]);assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);assert.equal(raced.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
 assert.deepEqual((await call(owner,'GET','',undefined,{version:'1'})).bundle,initial);
 const restored=await call(owner,'POST','',{expectedVersion:3,bundle:initial,note:'Restore original',requestId:randomUUID()});assert.equal(restored.skill.version,4);
 const history=await call(owner,'GET','/history');assert.equal(history.revisions.length,4);assert.ok(history.revisions.every(r=>!('actor'in r)));
 await ref.update({management:'dependency'});
 await assert.rejects(call(owner,'POST','',{...body,expectedVersion:4,requestId:randomUUID()}),e=>e.status===403&&e.code==='skill-read-only');
 assert.equal((await ref.get()).data().version,4);
 await services.auth.setCustomUserClaims(owner.localId,{marketingWorkspaces:[]});await assert.rejects(call(owner),e=>e.status===403);
 console.log('PASS skills emulator: permissions, live revocation, private version reads, idempotency, concurrent saves, restore-as-new-revision, immutable history.');
}finally{await services.db.recursiveDelete(ref);await bucket.deleteFiles({prefix:`marketing/${config.workspaceId}/skills/${id}/`});await Promise.all(users.map(uid=>services.auth.deleteUser(uid)));await services.db.terminate();}
