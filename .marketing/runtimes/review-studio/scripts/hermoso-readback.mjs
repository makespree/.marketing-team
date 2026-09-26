import fs from 'node:fs/promises';
// Read-only MCP verification. No publishing or general-purpose tool proxy.
export async function instagramReadback(account, brand) { return readback(account, brand, 'instagram'); }
export async function facebookReadback(pageId, brand) { return readback(pageId, brand, 'facebook'); }
export async function scheduleReadback(jobId, brand) {
  if (!/^job_[a-zA-Z0-9]+$/.test(jobId)) throw Error('Invalid job ID.');
  return readback(jobId, brand, 'schedule');
}
async function readback(account, brand, target) {
  const file = new URL('../.local/hermoso/api-key', import.meta.url);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || (stat.mode & 0o077)) throw Error('Hermoso key file must have private permissions.');
  const token = (await fs.readFile(file, 'utf8')).trim();
  if (!/^hmk_[^\s]+$/.test(token)) throw Error('Invalid Hermoso key file.');
  let session, id = 0;
  async function rpc(method, params, notify = false) {
    const body = {jsonrpc:'2.0', ...(!notify ? {id:++id} : {}), method, ...(params ? {params}: {})};
    const r = await fetch('https://app.hermoso.ai/mcp', {method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(session?{'mcp-session-id':session}:{})},body:JSON.stringify(body)});
    if (!r.ok) throw Error(`Hermoso MCP HTTP ${r.status}`);
    session = r.headers.get('mcp-session-id') || session;
    const raw = await r.text(); if (!raw) return;
    let result; try { result = JSON.parse(raw); } catch { result = raw.split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5))).find(d=>d.id===body.id); }
    if (result?.error || result?.result?.isError) throw Error('Hermoso read-back failed. No publication state changed.');
    return result?.result;
  }
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'marketing-publication-verifier',version:'1.0.0'}});
  await rpc('notifications/initialized',undefined,true);
  const tool = target === 'schedule' ? {name:'list_scheduled',args:{brand,id:account}} : target === 'facebook' ? {name:'list_meta_posts',args:{brand,pageId:account,target,limit:100}} : {name:'list_instagram_media',args:{brand,account,limit:50}};
  return (await rpc('tools/call',{name:'call_tool',arguments:tool})).structuredContent;
}
