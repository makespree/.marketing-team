import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {adapt} from '../scripts/project.mjs';

test('selected delivery invokes verified submission without a whole-workspace archive', async()=>{
 const root=await mkdtemp(join(tmpdir(),'agency-delivery-')),kit=join(root,'marketing');
 try{
  await mkdir(join(kit,'scripts'),{recursive:true});await mkdir(join(kit,'node_modules/typescript/bin'),{recursive:true});
  await writeFile(join(kit,'package.json'),'{"type":"module"}');
  await copyFile(new URL('../cli.mjs',import.meta.url),join(kit,'cli.mjs'));
  await copyFile(new URL('../scripts/project.mjs',import.meta.url),join(kit,'scripts/project.mjs'));
  const {config}=await adapt(kit,{name:'Test product'});
  config.cloud={projectId:'test-review-project',storageBucket:'test-review-project.firebasestorage.app',authDomain:'test-review-project.firebaseapp.com',apiKey:'public-test',appId:'public-test',appCheckSiteKey:'public-test',allowedOrigins:['https://example.test']};
  await writeFile(join(kit,'project.json'),JSON.stringify(config));
  // Child scripts cannot contact any service: this fixture includes only trace stubs.
  for(const[path,label]of [['node_modules/typescript/bin/tsc','compile'],['scripts/skills-publish.mjs','skills'],['scripts/media-cloud.mjs','archive'],['scripts/submit-cloud.mjs','submit']]){
   await writeFile(join(kit,path),`import {appendFileSync} from 'node:fs';appendFileSync('trace',JSON.stringify({step:${JSON.stringify(label)},args:process.argv.slice(2)})+'\\n');`);
  }
  const manifest=join(kit,'workspace/post.json');await writeFile(manifest,'{}');
  for(const[command,steps]of [['deliver-selected',['compile','submit']],['deliver',['compile','skills','archive','submit']]]){
   await writeFile(join(kit,'trace'),'');
   const run=spawnSync(process.execPath,[join(kit,'cli.mjs'),command,manifest,'--post-id','example-id','--expected-version','2'],{cwd:root,encoding:'utf8'});
   assert.equal(run.status,0,run.stderr);
   const trace=(await readFile(join(kit,'trace'),'utf8')).trim().split('\n').map(JSON.parse);
   assert.deepEqual(trace.map(x=>x.step),steps);
   assert.deepEqual(trace.at(-1).args,[manifest,'--post-id','example-id','--expected-version','2']);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
