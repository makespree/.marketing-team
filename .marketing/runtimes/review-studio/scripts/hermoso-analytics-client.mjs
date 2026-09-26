import fs from 'node:fs/promises';
// Deliberately limited to account identity and scoped performance reads.
export async function analyticsReader(brand) {
  const path=new URL('../.local/hermoso/api-key',import.meta.url),stat=await fs.lstat(path);
  if(!stat.isFile()||(stat.mode&0o077))throw Error('Hermoso key must be a private regular file (mode 600).');
  const key=(await fs.readFile(path,'utf8')).trim();if(!/^hmk_[^\s]+$/.test(key))throw Error('Invalid Hermoso key file.');
  let session,id=0;
  async function rpc(method,params,notify=false){
    const body={jsonrpc:'2.0',...(!notify?{id:++id}:{}),method,...(params?{params}:{})};
    const r=await fetch('https://app.hermoso.ai/mcp',{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(session?{'mcp-session-id':session}:{})},body:JSON.stringify(body)});
    if(!r.ok)throw Error(`Hermoso analytics HTTP ${r.status}. No ad settings changed.`);session=r.headers.get('mcp-session-id')||session;
    const raw=await r.text();if(!raw)return;let d;try{d=JSON.parse(raw);}catch{d=raw.split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5))).find(d=>d.id===body.id);}
    if(d?.error||d?.result?.isError)throw Error('Hermoso analytics read failed. No snapshot was saved.');return d?.result?.structuredContent??d?.result;
  }
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'marketing-analytics-reader',version:'1.0.0'}});await rpc('notifications/initialized',undefined,true);
  const read=(name,args)=>rpc('tools/call',{name:'call_tool',arguments:{name,args:{brand,...args}}});
  return {account:async(id)=>{const r=await read('list_meta_pages',{});const a=r.adAccounts?.find(a=>a.accountId===id);if(!a||!/^[A-Z]{3}$/.test(a.currency))throw Error('Ad account currency could not be verified.');return {id,currency:a.currency};},insights:async(accountId,objectId,level,date)=>{if(!/^\d+$/.test(accountId)||!/^\d+$/.test(objectId)||!['campaign','ad'].includes(level))throw Error('Explicit campaign or ad scope required.');return read('meta_insights',{adAccountId:accountId,objectId,level,since:date,until:date});}};
}
