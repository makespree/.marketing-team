import { useEffect, useRef, useState } from 'react';
type Skill = { management?: 'team' | 'dependency'; id: string; title: string; category: string; description: string; version: number; updatedAt: string; note: string; sourceRoot: string; fileCount: number; supportFiles?: string[] };
type Bundle = { files: { path: string; content: string }[] };
export function Skills({ api }: { api: (path: string, init?: RequestInit) => Promise<Response> }) {
  const [section,setSection] = useState<'team'|'dependency'>('team');
  const [skills,setSkills] = useState<Skill[]>([]), [selected,setSelected] = useState<Skill>();
  const [bundle,setBundle] = useState<Bundle>(), [saved,setSaved] = useState(''), [path,setPath] = useState('SKILL.md');
  const [query,setQuery] = useState(''), [category,setCategory] = useState('all'), [note,setNote] = useState('');
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [history,setHistory] = useState<Skill[]>([]), [historical,setHistorical] = useState<number>();
  const retry = useRef<{key:string;id:string} | undefined>(undefined);
  const dirty = !!bundle && JSON.stringify(bundle) !== saved;
  async function run(task:()=>Promise<void>) { setBusy(true);setError('');setNotice('');try{await task();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);} }
  useEffect(()=>{void run(async()=>{setSkills((await(await api('/skills')).json()).skills);});},[]);
  async function choose(id:string) {
    if(dirty && !window.confirm('Discard your unsaved skill edits?'))return;
    await run(async()=>{const data=await(await api(`/skills/${id}`)).json();setSelected(data.skill);setBundle(data.bundle);setSaved(JSON.stringify(data.bundle));setPath('SKILL.md');setNote('');setHistory([]);setHistorical(undefined);retry.current=undefined;});
  }
  async function save() {
    if(!selected||!bundle||selected.management!=='team')return;
    await run(async()=>{const payload={expectedVersion:selected.version,bundle,note};const key=JSON.stringify(payload);if(retry.current?.key!==key)retry.current={key,id:crypto.randomUUID()};
      const data=await(await api(`/skills/${selected.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId:retry.current.id})})).json();
      setSelected(data.skill);setSkills(old=>old.map(s=>s.id===data.skill.id?data.skill:s));setSaved(JSON.stringify(bundle));setHistorical(undefined);setHistory([]);setNote('');retry.current=undefined;setNotice(`Revision ${data.skill.version} saved. Future production syncs will use it. Existing content is unchanged.`);
    });
  }
  const visibleSkills=skills.filter(s=>section==='team'?s.management==='team':s.management!=='team');
  const readOnly=selected?.management!=='team';
  function switchSection(next:'team'|'dependency'){if(next===section)return;if(dirty&&!window.confirm('Discard your unsaved skill edits?'))return;setSection(next);setSelected(undefined);setBundle(undefined);setSaved('');setHistory([]);setCategory('all');setQuery('');setError('');setNotice('');}
  const file=bundle?.files.find(f=>f.path===path);
  return <section className="skills-page">
    <div className="skills-intro"><div><h2>{section==='team'?'Our design & production skills':'Tools & dependencies'}</h2><p>{section==='team'?'Edit our design guides and production direction. Saved revisions are synced before the next content run.':'Installed tools and shared workflows are read-only. Customize pacing, branding, audio and creative direction in our own production skill.'}</p></div><span className="pill">Private team library</span></div>
    <nav className="studio-tabs" aria-label="Skill sections"><button aria-pressed={section==='team'} onClick={()=>switchSection('team')}>Our skills ({skills.filter(s=>s.management==='team').length})</button><button aria-pressed={section==='dependency'} onClick={()=>switchSection('dependency')}>Tools & dependencies ({skills.filter(s=>s.management!=='team').length})</button></nav>
    {error&&<div role="alert" className="error">{error}</div>}{notice&&<div role="status" className="notice">{notice}</div>}
    <div className="skills-layout"><aside>
      <label>Find a skill<input value={query} onChange={e=>setQuery(e.target.value)} placeholder={section==='team'?'Find a design or production skill…':'Find a tool…'}/></label>
      <label>Category<select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">{section==='team'?'Our skills':'Tools'} ({visibleSkills.length})</option>{[...new Set(visibleSkills.map(s=>s.category))].sort().map(c=><option key={c}>{c}</option>)}</select></label>
      <nav aria-label="Skills">{visibleSkills.filter(s=>(category==='all'||s.category===category)&&`${s.title} ${s.id} ${s.description}`.toLowerCase().includes(query.toLowerCase())).map(s=><button className={`post ${selected?.id===s.id?'active':''}`} key={s.id} disabled={busy} onClick={()=>void choose(s.id)}><strong>{s.title}</strong><span>{s.category} · {s.management==='team'?`v${s.version}`:'Read-only'}</span><small>{s.description.slice(0,150)}</small></button>)}</nav>
      {!visibleSkills.length&&!busy&&<p>No skills have been imported for this workspace.</p>}
    </aside><section className="editor">
      {selected&&bundle?<><div className="queue-title"><h2>{selected.title}</h2><span className="pill">{readOnly?'Read-only reference':`Current v${selected.version}`}</span></div><p>{selected.description}</p>
      <p className="muted">{bundle.files.length} instruction files · Updated {new Date(selected.updatedAt).toLocaleString()}</p>
      <fieldset disabled={busy}><label>Instruction file<select value={path} onChange={e=>setPath(e.target.value)}>{bundle.files.map(f=><option key={f.path}>{f.path}</option>)}</select></label>
      {historical&&<div className="notice">Viewing revision {historical}. Saving creates a new revision; the current version is not overwritten.</div>}
      <label>Markdown instructions<textarea className="skill-code" readOnly={readOnly} spellCheck={false} value={file?.content??''} onChange={e=>setBundle({files:bundle.files.map(f=>f.path===path?{...f,content:e.target.value}:f)})}/></label>
      {!readOnly && <><label>Change note<input maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="What should we do differently?"/></label>
      <div className="actions"><button className="primary" disabled={!dirty||!note.trim()} onClick={()=>void save()}>Save new revision</button><button onClick={()=>void choose(selected.id)}>Reload latest</button><button onClick={()=>void run(async()=>setHistory((await(await api(`/skills/${selected.id}/history`)).json()).revisions))}>Revision history</button></div></>}</fieldset>
      {!readOnly&&history.length>0&&<div className="skill-history"><h3>Saved revisions</h3>{history.map(h=><div key={h.version}><span>v{h.version} · {h.note} · {new Date(h.updatedAt).toLocaleString()}</span><button disabled={busy} onClick={()=>{if(dirty&&!window.confirm('Discard unsaved edits to view this revision?'))return;void run(async()=>{const d=await(await api(`/skills/${selected.id}?version=${h.version}`)).json();setBundle(d.bundle);setPath('SKILL.md');setHistorical(h.version);setNote(`Restore revision ${h.version}`);});}}>Load revision {h.version}</button></div>)}</div>}
      <details><summary>Original source and dependencies</summary><p><code>{selected.sourceRoot}</code></p><p>{readOnly?'These are reference copies of installed instructions. Production uses the installed tool files; this panel does not check whether a runtime is currently available.':'Original repository files are preserved. Our cloud revisions override the instruction documents after sync.'} Supporting scripts, media and installed rendering tools remain separate dependencies; edits here do not install or execute them.</p>{!!selected.supportFiles?.length&&<p>{selected.supportFiles.length} supporting files stay in the installed skill.</p>}</details>
      </>:<div className="empty">Choose a skill to read or edit.<small>{section==='team'?'Only our editable creative guidance appears here.':'Installed tools are available for reference, without editing controls.'}</small></div>}
    </section></div>
    <details className="sync-help"><summary>Use the latest skills when creating content</summary><p>From a configured project, run <code>node marketing/cli.mjs prepare-content</code>. It downloads a verified snapshot using your developer Firebase credentials, preserves repository originals, and prints the index to read. Team browser sign-in does not grant developer cloud access. A failed sync stops the preparation step; it never silently uses stale cloud instructions.</p><p>Choose the skills appropriate to the creative brief. The library does not generate content, install tools or publish posts by itself.</p></details>
  </section>;
}
