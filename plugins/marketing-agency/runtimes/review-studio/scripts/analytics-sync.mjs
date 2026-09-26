import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {analyticsReader} from './hermoso-analytics-client.mjs';
import {cloudClient} from './cloud-client.mjs';
import {analyticsProjection,metricsFromMeta,dateKey} from '../lib/server/analytics-model.js';

export function validateScope(input){
 if(!input||typeof input.brand!=='string'||!input.brand.trim()||!/^\d+$/.test(input.adAccountId))throw Error('Explicit brand and account required.');dateKey(input.date);
 if(!Array.isArray(input.campaigns)||!input.campaigns.length||input.campaigns.length>20||!Array.isArray(input.ads)||input.ads.length>100)throw Error('Specify campaign and ad scope.');
 for(const rows of [input.campaigns,input.ads]){if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('Duplicate scope IDs.');for(const r of rows)if(!/^\d+$/.test(r.id)||typeof r.name!=='string'||!r.name.trim()||r.name.length>300)throw Error('Invalid campaign or ad.');}
 for(const a of input.ads)if(!input.campaigns.some(c=>c.id===a.campaignId))throw Error('Ad must belong to the explicit selected campaigns.');return input;
}
export function firestoreFields(value){const encode=v=>v===null?{nullValue:null}:typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:{mapValue:{fields:firestoreFields(v)}};return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]));}
export function decodeFields(fields){const decode=v=>'nullValue'in v?null:'stringValue'in v?v.stringValue:'booleanValue'in v?v.booleanValue:'integerValue'in v?Number(v.integerValue):'arrayValue'in v?(v.arrayValue.values??[]).map(decode):decodeFields(v.mapValue.fields??{});return Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,decode(v)]));}
export async function syncAnalytics(scope,{reader,client}){
 validateScope(scope);const account=await reader.account(scope.adAccountId);const digits=new Intl.NumberFormat('en',{style:'currency',currency:account.currency}).resolvedOptions().maximumFractionDigits;
 const campaigns=[],ads=[];
 for(const [level,list,out]of [['campaign',scope.campaigns,campaigns],['ad',scope.ads,ads]])for(const obj of list){const r=await reader.insights(scope.adAccountId,obj.id,level,scope.date);if(r.objectId!==obj.id||r.breakdowns?.length||r.breakdownStatus==='partial')throw Error('Unexpected insight scope.');out.push({id:obj.id,name:obj.name,campaignId:level==='campaign'?obj.id:obj.campaignId,postId:obj.postId??null,hasData:r.rows?.length===1,metrics:metricsFromMeta(r.rows,scope.date,digits)});}
 const report=analyticsProjection({schemaVersion:1,id:`${scope.adAccountId}-${scope.date}`,reportDate:scope.date,fetchedAt:new Date().toISOString(),source:'Hermoso / Meta Insights',reportingTimezone:'Meta ad account reporting day',currency:account.currency,currencyDigits:digits,adAccountId:scope.adAccountId,campaigns,ads});
 const digest=createHash('sha256').update(JSON.stringify(report)).digest('hex'),url=`${client.docs}/marketingWorkspaces/${client.config.workspaceId}/adAnalytics/${report.id}`;
 const name=url.slice(url.indexOf('/projects/')+1);await client.api(client.docs+':commit','POST',{writes:[{update:{name,fields:firestoreFields(report)}},{update:{name:`${name}/snapshots/${digest}`,fields:firestoreFields(report)},currentDocument:{exists:false}}]});
 const saved=analyticsProjection(decodeFields((await client.api(url)).fields));if(JSON.stringify(saved)!==JSON.stringify(report))throw Error('Cloud analytics verification failed.');return{project:client.config.cloud.projectId,workspace:client.config.workspaceId,reportId:report.id,snapshotHash:digest,reportDate:report.reportDate,campaignCount:campaigns.length,adCount:ads.length,verified:true,report:saved};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
 try{const path=process.argv[2];if(!path)throw Error('Usage: node marketing/scripts/analytics-sync.mjs <explicit-scope.json>');const scope=validateScope(JSON.parse(await fs.readFile(path,'utf8')));const result=await syncAnalytics(scope,{reader:await analyticsReader(scope.brand),client:await cloudClient()});const {report,...receipt}=result;console.log(JSON.stringify(receipt,null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
