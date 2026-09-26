import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export async function cloudClient() {
  const config = JSON.parse(await readFile(new URL('../project.json',import.meta.url),'utf8'));
  if (!config.cloud || config.cloud.projectId.startsWith('demo-')) throw Error('Configure this workspace cloud project first.');
  const { validateConfig } = await import('./project.mjs'); validateConfig(config);
  if (Object.keys(process.env).some(k => k.endsWith('EMULATOR_HOST') && process.env[k])) throw Error('Cloud commands cannot use emulator overrides.');
  const { requireAuth } = require('firebase-tools/lib/requireAuth');
  const { getAccessToken } = require('firebase-tools/lib/apiv2');
  await requireAuth({project:config.cloud.projectId,nonInteractive:true});
  async function request(url,options={}) {
    const r = await fetch(url,{...options,headers:{...options.headers,Authorization:`Bearer ${await getAccessToken()}`,'x-goog-user-project':config.cloud.projectId}});
    if (!r.ok) { const d=await r.json().catch(()=>null); const e=new Error(`Cloud request failed (${r.status}): ${d?.error?.message??r.statusText}`);e.status=r.status;throw e; } return r;
  }
  const api = async (url,method='GET',body) => (await request(url,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})})).json();
  const docs=`https://firestore.googleapis.com/v1/projects/${config.cloud.projectId}/databases/${config.cloud.databaseId??'(default)'}/documents`;
  return {config,request,api,docs};
}
export const encodeFields = object => Object.fromEntries(Object.entries(object).map(([k,v])=>[k,encode(v)]));
function encode(v){if(typeof v==='string')return {stringValue:v};if(typeof v==='number')return {integerValue:String(v)};if(Array.isArray(v))return {arrayValue:{values:v.map(encode)}};throw Error('Unsupported registry value');}
export const decodeFields = fields => Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,decode(v)]));
function decode(v){if('stringValue'in v)return v.stringValue;if('integerValue'in v)return Number(v.integerValue);if('arrayValue'in v)return (v.arrayValue.values??[]).map(decode);throw Error('Unsupported registry field');}
// The developer signed in to firebase-tools, used to label command-line deliveries.
export function accountEmail() { try { const a = require('firebase-tools/lib/auth'); const acct = a.getGlobalDefaultAccount?.(); return acct?.user?.email || ''; } catch { return ''; } }
