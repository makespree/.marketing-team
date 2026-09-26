import fs from 'node:fs/promises';
import {cloudClient} from './cloud-client.mjs';
import {scheduleReadback} from './hermoso-readback.mjs';
import {recordScheduled} from './schedule-record.mjs';
try {
 const [path,brand]=process.argv.slice(2);
 if(!path||!brand)throw Error('Usage: node marketing/scripts/record-scheduled.mjs <schedule-receipts.json> <brand>');
 const rows=JSON.parse(await fs.readFile(path,'utf8')),client=await cloudClient();
 if(!Array.isArray(rows)||!rows.length)throw Error('Expected schedule receipts.');
 for(const row of rows){
  if(row.project!==client.config.cloud.projectId||row.workspace!==client.config.workspaceId)throw Error('Wrong schedule workspace.');
  const data=await scheduleReadback(row.jobId,brand);
  const live=data.scheduled?.find(q=>q.id===row.jobId);
  console.log(JSON.stringify(await recordScheduled(client,row.postId,row.jobId,live)));
 }
} catch(error){console.error(error.message);process.exitCode=1;}
