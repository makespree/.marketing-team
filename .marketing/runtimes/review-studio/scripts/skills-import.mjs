// Explicit, initial-only import. Never replaces an existing cloud skill revision.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { cloudClient, encodeFields, decodeFields } from './cloud-client.mjs';
import { parseBundle } from '../lib/server/skills.js';
const kit=dirname(dirname(fileURLToPath(import.meta.url)));
if(process.argv.length!==3)throw Error('Usage: node marketing/scripts/skills-import.mjs <source-list.json>');
const sources=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
const {config,api,request,docs}=await cloudClient();
let imported=0,skipped=0;
async function verify(record) {
  if(!record.storagePath.startsWith(`marketing/${config.workspaceId}/skills/${record.id}/`) || !/^\d+$/.test(record.generation))throw Error('Unexpected cloud skill object.');
  const url=`https://storage.googleapis.com/storage/v1/b/${config.cloud.storageBucket}/o/${encodeURIComponent(record.storagePath)}?generation=${record.generation}`;
  const meta=await api(url);if(meta.metadata?.firebaseStorageDownloadTokens)throw Error('Unexpected public skill download token');
  const bytes=Buffer.from(await(await request(url+'&alt=media')).arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw Error('Cloud skill hash mismatch');
  parseBundle(JSON.parse(bytes));
}
for(const source of sources){
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.id)||source.id.length>64||!['Design','Production','Video','Audio'].includes(source.category))throw Error('Invalid source descriptor');
  const root=resolve(kit,'..',source.sourceRoot);
  if(!root.startsWith(resolve(kit,'..')+'/'))throw Error('Skill source must be inside this project');
  const ref=`${docs}/marketingWorkspaces/${config.workspaceId}/skills/${source.id}`;
  let existing;try{existing=await api(ref);}catch(e){if(e.status!==404)throw e;}
  if(existing){const record=decodeFields(existing.fields);if(source.management==='team'&&record.management!=='team')throw Error(`Skill ID belongs to a read-only dependency: ${source.id}`);await verify(record);console.log('Verified existing',source.id,`v${record.version}`);skipped++;continue;}
  const files=[],supportFiles=[];
  async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.name.startsWith('.')||['node_modules','__pycache__'].includes(entry.name))continue;const full=resolve(dir,entry.name);if(entry.isSymbolicLink())throw Error('Symbolic links are not imported');if(entry.isDirectory())await walk(full);else if(entry.isFile()){const path=relative(root,full);if(path.endsWith('.md'))files.push({path,content:await readFile(full,'utf8')});else supportFiles.push(path);}}}
  await walk(root);const bundle=parseBundle({files});const bytes=Buffer.from(JSON.stringify(bundle));const sha256=createHash('sha256').update(bytes).digest('hex');
  const storagePath=`marketing/${config.workspaceId}/skills/${source.id}/initial-${sha256}.json`;
  let meta;const object=`https://storage.googleapis.com/storage/v1/b/${config.cloud.storageBucket}/o/${encodeURIComponent(storagePath)}`;
  try{meta=await api(object);}catch(e){if(e.status!==404)throw e;
    meta=await(await request(`https://storage.googleapis.com/upload/storage/v1/b/${config.cloud.storageBucket}/o?uploadType=media&name=${encodeURIComponent(storagePath)}&ifGenerationMatch=0`,{method:'POST',headers:{'Content-Type':'application/json'},body:bytes})).json();
  }
  if(meta.md5Hash!==createHash('md5').update(bytes).digest('base64'))throw Error('Uploaded skill integrity mismatch');
  meta=await api(object+'?ifGenerationMatch='+meta.generation,'PATCH',{cacheControl:'private, no-store'});
  const entry=files.find(f=>f.path==='SKILL.md').content;
  const record={id:source.id,title:source.title,category:source.category,management:source.management==='team'?'team':'dependency',description:source.description??(/^description:\s*(.+)$/m.exec(entry)?.[1]??source.title),sourceRoot:source.sourceRoot,version:1,updatedAt:new Date().toISOString(),note:'Initial import from repository',fileCount:files.length,supportFiles,storagePath,generation:String(meta.generation),sha256};
  const name=ref.replace('https://firestore.googleapis.com/v1/','');const fields=encodeFields(record);
  await api(`${docs}:commit`,'POST',{writes:[{update:{name,fields},currentDocument:{exists:false}},{update:{name:name+'/revisions/1',fields},currentDocument:{exists:false}}]});
  const saved=decodeFields((await api(ref)).fields);if(saved.sha256!==sha256)throw Error('Cloud skill registry changed during import');await verify(saved);
  console.log('Imported',source.id,files.length,'Markdown files');imported++;
}
console.log(`Imported ${imported}; kept ${skipped} existing cloud skills unchanged.`);process.exit(0);
