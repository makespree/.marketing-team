import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { authClient, appCheckToken, signInGoogle, runtimeEnvironment, project } from './auth';
import './style.css';
import { Skills } from './Skills';
import { Analytics } from './Analytics';

type Content = { title: string; caption: string; language: string; placement: string; assets: string[] };
type Publication = { channel: string; account: string; url: string; postedAt: string; revision: number };
type Handoff = { jobId: string; status: string; at: string; channels: string[]; revision: number; contentHash: string };
type Post = Content & { handoffs?: Handoff[]; publications?: Publication[]; reviewedBy?: string; actorName?: string; id: string; version: number; revision: number; status: string; feedback: string; contentHash: string; createdAt?: string; updatedAt: string; createdBy?: string; updatedBy?: string; actor?: string };
type Sort = 'newest' | 'updated' | 'oldest' | 'title';

const STATUSES = ['needs-review', 'approved', 'posted', 'changes-requested', 'rejected'];
const blank = (): Content => ({ title: '', caption: '', language: project.languages[0]!.code, placement: 'feed', assets: [] });
const label = (status: string) => ({ 'needs-review': 'Needs review', approved: 'Approved', posted: 'Posted', 'changes-requested': 'Changes requested', rejected: 'Rejected' })[status] ?? status;
const format = (placement: string) => ({ feed: 'Feed / carousel', reel: 'Reel', story: 'Story' })[placement] ?? placement;
const languageLabel = (code: string) => project.languages.find(l => l.code === code)?.label ?? code;
const initials = (name: string) => name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

// "2 min ago" for scanning the queue; the exact time sits in the tooltip.
function ago(iso?: string) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
const when = (iso?: string) => iso ? new Date(iso).toLocaleString() : '';

async function api(path: string, init: RequestInit = {}) {
  const { auth } = await authClient();
  if (!auth.currentUser) throw new Error('Sign in to review content.');
  const token = await auth.currentUser.getIdToken(), check = await appCheckToken();
  const response = await fetch(`/api/marketing${path}`, { ...init, cache: 'no-store', headers: { ...init.headers, Authorization: `Bearer ${token}`, ...(check ? { 'X-Firebase-AppCheck': check } : {}) } });
  if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.error?.message ?? `Request failed (${response.status}).`); }
  return response;
}

// Private media is fetched through the API once per session and kept as an
// object URL, so the queue thumbnails, the editor and the preview share one download.
const mediaCache = new Map<string, Promise<{ url: string; type: string }>>();
function loadMedia(id: string) {
  if (!mediaCache.has(id)) mediaCache.set(id, api(`/assets/${id}`).then(r => r.blob()).then(blob => ({ url: URL.createObjectURL(blob), type: blob.type })).catch(e => { mediaCache.delete(id); throw e; }));
  return mediaCache.get(id)!;
}
function useMedia(id: string | undefined, active = true) {
  const [media, setMedia] = useState<{ url: string; type: string }>(), [error, setError] = useState('');
  useEffect(() => {
    let live = true; setMedia(undefined); setError('');
    if (id && active) loadMedia(id).then(m => { if (live) setMedia(m); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [id, active]);
  return { media, error };
}
function Media({ id }: { id: string }) {
  const { media, error } = useMedia(id);
  if (error) return <p role="alert" className="media-error">{error}</p>;
  if (!media) return <p className="loading">Loading private preview…</p>;
  return media.type.startsWith('video/') ? <video controls playsInline src={media.url}/> : <img src={media.url} alt="Selected social post draft"/>;
}
// A queue thumbnail only downloads once it scrolls into view.
function Thumb({ id, count }: { id?: string; count: number }) {
  const ref = useRef<HTMLSpanElement>(null); const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!ref.current || seen) return;
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(ref.current); return () => io.disconnect();
  }, [seen]);
  const { media } = useMedia(id, seen);
  return <span className="thumb" ref={ref} aria-hidden="true">
    {media ? media.type.startsWith('video/') ? <video muted playsInline preload="metadata" src={media.url}/> : <img src={media.url} alt=""/> : <span className="thumb-blank"/>}
    {count > 1 && <span className="thumb-count">{count}</span>}
  </span>;
}

function App() {
  const [tab, setTab] = useState('content'), [pane, setPane] = useState<'queue' | 'editor' | 'preview'>('queue');
  const [user, setUser] = useState<User | null>(null), [ready, setReady] = useState(false);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [posts, setPosts] = useState<Post[]>([]), [cursor, setCursor] = useState<string | null>(null), [filter, setFilter] = useState('all');
  const [query, setQuery] = useState(''), [sort, setSort] = useState<Sort>('newest'), [person, setPerson] = useState('all');
  const [selected, setSelected] = useState<Post>(), [draft, setDraft] = useState<Content>(blank), [id, setId] = useState<string>(() => crypto.randomUUID());
  const [slide, setSlide] = useState(0), [feedback, setFeedback] = useState(''), [history, setHistory] = useState<Post[]>([]), [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const retry = useRef<{ key: string; requestId: string } | undefined>(undefined);
  const editorRef = useRef<HTMLElement>(null);
  const local = runtimeEnvironment() === 'local';
  const dirty = !selected || JSON.stringify(draft) !== JSON.stringify(pick(selected));
  function pick(post: Post): Content { return { title: post.title, caption: post.caption, language: post.language, placement: post.placement, assets: post.assets }; }
  async function run(task: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await task(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  async function load(after?: string) {
    const data = await (await api(`/posts${after ? `?after=${after}` : ''}`)).json();
    setPosts(old => after ? [...old, ...data.posts.filter((p: Post) => !old.some(o => o.id === p.id))] : data.posts); setCursor(data.next);
  }
  useEffect(() => {
    let unsubscribe = () => {}, active = true;
    authClient().then(({ auth }) => { if (active) unsubscribe = onAuthStateChanged(auth, account => { setUser(account); setReady(true); setPosts([]); setSelected(undefined); setDraft(blank()); setHistory([]); setPassword(''); }); }).catch(e => { setError(e.message); setReady(true); });
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => { if (user) void run(() => load()); }, [user]);
  function choose(post?: Post) {
    if (dirty && (draft.title || draft.caption || draft.assets.length) && !window.confirm('Discard the unsaved changes in this editor? Uploaded files remain private.')) return;
    setSelected(post); setDraft(post ? pick(post) : blank()); setId(post?.id ?? crypto.randomUUID()); setSlide(0); setFeedback(''); setHistory([]); setHistoryOpen(false); setError(''); setNotice(''); retry.current = undefined;
    setPane('editor'); setTimeout(() => editorRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }), 0);
    return true;
  }
  async function mutate(action: Record<string, unknown>) {
    const payload = { ...action, expectedVersion: selected?.version ?? 0 }, key = JSON.stringify({ id, ...payload });
    if (retry.current?.key !== key) retry.current = { key, requestId: crypto.randomUUID() };
    const data = await (await api(`/posts/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, requestId: retry.current.requestId }) })).json();
    setSelected(data.post); setDraft(pick(data.post)); setFeedback(''); setHistory([]); setHistoryOpen(false); retry.current = undefined;
    setPosts(old => [data.post, ...old.filter(p => p.id !== data.post.id)]); setNotice(action.action === 'save' ? 'Draft saved. This revision needs review.' : 'Review saved. Nothing has been published.');
  }
  async function upload(files: File[]) {
    if (draft.assets.length + files.length > 10) throw new Error('A post can contain up to 10 files.');
    if (files.some(file => !file.size || file.size > 20 * 1024 * 1024)) throw new Error('Each file must be between 1 byte and 20 MB.');
    for (const file of files) {
      setNotice(`Uploading ${file.name}…`);
      const asset = await (await api('/assets', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file })).json();
      setDraft(old => ({ ...old, assets: [...old.assets, asset.id] }));
    }
    setNotice('Files uploaded privately. Save the draft to add it to the review queue.');
  }
  async function showHistory() { if (!selected) return; setHistoryOpen(true); await run(async () => { setHistory((await (await api(`/posts/${selected.id}/history`)).json()).history); }); }
  function move(index: number, delta: number) { const assets = [...draft.assets]; [assets[index], assets[index + delta]] = [assets[index + delta]!, assets[index]!]; setDraft({ ...draft, assets }); setSlide(index + delta); }

  const counts = useMemo(() => Object.fromEntries(['all', ...STATUSES].map(s => [s, posts.filter(p => s === 'all' || p.status === s).length])), [posts]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = posts.filter(p => (filter === 'all' || p.status === filter) && (person === 'all' || (p.createdBy ?? '') === person) && (!q || `${p.title} ${p.caption} ${p.createdBy ?? ''} ${p.updatedBy ?? ''}`.toLowerCase().includes(q)));
    const t = (p: Post) => new Date(p.createdAt ?? p.updatedAt).getTime(), u = (p: Post) => new Date(p.updatedAt).getTime();
    return list.sort((a, b) => sort === 'newest' ? t(b) - t(a) : sort === 'oldest' ? t(a) - t(b) : sort === 'updated' ? u(b) - u(a) : a.title.localeCompare(b.title));
  }, [posts, filter, query, sort, person]);
  const people = useMemo(() => [...new Set(posts.map(p => p.createdBy).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b)), [posts]);
  const who = user?.displayName || user?.email || '';

  if (!ready) return <main className="studio"><p className="loading">Opening the studio…</p></main>;
  return <main className="studio">
    <header className="top">
      <a className="brand" href="/"><span className="brand-mark">{initials(project.name)}</span><span className="brand-name">{project.name}</span> <span className="brand-sub">Studio</span></a>
      {user && <nav className="tabs" aria-label="Studio sections"><button aria-pressed={tab === 'content'} onClick={() => setTab('content')}>Content</button><button aria-pressed={tab === 'analytics'} onClick={() => setTab('analytics')}>Analytics</button><button aria-pressed={tab === 'skills'} onClick={() => setTab('skills')}>Skills</button></nav>}
      <div className="account">
        <span className="pill quiet">{local ? 'Local preview' : 'Private workspace'}</span>
        {user && <span className="who" title={user.email ?? ''}><span className="avatar" aria-hidden="true">{initials(who)}</span><span className="who-name">{who}</span></span>}
        {user && <button disabled={busy} onClick={() => void run(async () => { await signOut((await authClient()).auth); })}>Sign out</button>}
      </div>
    </header>
    <p className="paused">Approval is for review. Posted means scheduled in Hermoso or published. Check each card for its delivery details.</p>
    <div className="messages" aria-live="polite">{error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}</div>

    {!user ? <section className="login">
      <h1>Sign in to the studio</h1><p>The shared content workspace for {project.name}. Use the account that was invited.</p>
      {local && <form onSubmit={e => { e.preventDefault(); void run(async () => { await signInWithEmailAndPassword((await authClient()).auth, email, password); }); }}><label>Email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></label><button className="primary" disabled={busy}>Sign in</button></form>}
      {!local && <button className="primary" disabled={busy} onClick={() => void run(async () => { await signInGoogle(); })}>Continue with Google</button>}
      {local && <p className="muted">Local emulators only. Demo login: <code>reviewer@marketing.test</code> with the password printed by the start command.</p>}
    </section> : <>
    <div hidden={tab !== 'content'}>
      <nav className="panes" aria-label="Sections on a phone">{(['queue', 'editor', 'preview'] as const).map(p => <button key={p} aria-pressed={pane === p} onClick={() => setPane(p)}>{p === 'queue' ? `Queue (${posts.length})` : p === 'editor' ? (selected ? 'Post' : 'New post') : 'Preview'}</button>)}</nav>
      <div className="workspace" data-pane={pane}>
        <aside className="queue" aria-label="Review queue">
          <div className="queue-head"><h1>Queue</h1><button className="primary small" disabled={busy} onClick={() => choose()}>+ New post</button></div>
          <div className="queue-tools">
            <label className="search"><span className="sr-only">Search posts</span><input type="search" placeholder="Search posts" value={query} onChange={e => setQuery(e.target.value)}/></label>
            <label className="sort"><span className="sr-only">Sort</span><select value={sort} onChange={e => setSort(e.target.value as Sort)}><option value="newest">Newest first</option><option value="updated">Recently updated</option><option value="oldest">Oldest first</option><option value="title">Title A to Z</option></select></label>
          </div>
          {people.length > 0 && <label className="person"><span className="sr-only">Added by</span><select value={person} onChange={e => setPerson(e.target.value)}><option value="all">Added by anyone</option>{people.map(n => <option key={n} value={n}>{n} ({posts.filter(p => p.createdBy === n).length})</option>)}</select></label>}
          <div className="chips" role="group" aria-label="Filter by status">{['all', ...STATUSES].map(s => <button key={s} className={`chip ${s}`} aria-pressed={filter === s} onClick={() => setFilter(s)}>{s === 'all' ? 'All' : label(s)} <b>{counts[s]}</b></button>)}</div>
          <div className="list" role="list">
            {shown.map(p => <button key={p.id} role="listitem" disabled={busy} className={`row ${selected?.id === p.id ? 'active' : ''}`} aria-current={selected?.id === p.id ? 'true' : undefined} onClick={() => choose(p)}>
              <Thumb id={p.assets[0]} count={p.assets.length}/>
              <span className="row-body">
                <span className="row-title">{p.title}</span>
                <span className="row-meta">{format(p.placement)} · {languageLabel(p.language)} · {p.assets.length} file{p.assets.length === 1 ? '' : 's'} · r{p.revision}</span>
                <span className="row-by" title={`Added ${when(p.createdAt ?? p.updatedAt)}${p.updatedAt !== (p.createdAt ?? p.updatedAt) ? ` · updated ${when(p.updatedAt)}` : ''}`}>{p.createdBy ? `Added by ${p.createdBy}` : 'Added'} {ago(p.createdAt ?? p.updatedAt)}{p.createdAt && p.updatedAt !== p.createdAt ? ` · updated ${ago(p.updatedAt)}` : ''}</span>
              </span>
              {p.handoffs?.some(h => h.contentHash === p.contentHash && h.revision === p.revision && !h.channels.every(channel => p.publications?.some(pub => pub.channel === channel && pub.revision === h.revision))) && <span className="muted">Scheduled in Hermoso</span>}
              <span className={`status ${p.status}`}>{label(p.status)}</span>
            </button>)}
            {!shown.length && <p className="empty-list">{posts.length ? 'Nothing matches this filter.' : 'No posts yet. Add the first one.'}</p>}
          </div>
          {cursor && <button disabled={busy} onClick={() => void run(() => load(cursor))}>Load more posts</button>}
          <button className="quiet-link" disabled={busy} onClick={() => void run(() => load())}>Refresh the queue</button>
        </aside>

        <section className="editor" ref={editorRef} aria-label={selected ? 'Post details' : 'New post'}>
          <div className="editor-head">
            <div><span className="eyebrow">{selected ? 'Post' : 'New post'}</span><h2>{selected ? selected.title : 'Untitled post'}</h2></div>
            <div className="editor-state">{selected && <span className={`status ${selected.status}`}>{label(selected.status)}</span>}{selected && <span className="pill quiet">r{selected.revision}</span>}{dirty && draft.title && <span className="pill unsaved">Unsaved changes</span>}</div>
          </div>
          {selected && <p className="muted byline">{selected.createdBy ? `Added by ${selected.createdBy} ` : 'Added '}{ago(selected.createdAt ?? selected.updatedAt)} · last change {ago(selected.updatedAt)}{selected.updatedBy ? ` by ${selected.updatedBy}` : ''}{selected.reviewedBy && selected.status !== 'needs-review' ? ` · reviewed by ${selected.reviewedBy}` : ''}</p>}
          <fieldset disabled={busy}>
            <label>Internal title<input maxLength={120} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="What is this post about?"/></label>
            <div className="two"><label>Language<select value={draft.language} onChange={e => setDraft({ ...draft, language: e.target.value })}>{project.languages.map(language => <option key={language.code} value={language.code}>{language.label}</option>)}</select></label><label>Format<select value={draft.placement} onChange={e => setDraft({ ...draft, placement: e.target.value })}><option value="feed">Feed / carousel</option><option value="reel">Reel</option><option value="story">Story</option></select></label></div>
            <label>Caption<textarea rows={6} maxLength={2200} value={draft.caption} onChange={e => setDraft({ ...draft, caption: e.target.value })} placeholder="The exact caption, with handles and hashtags"/><small className="counter">{draft.caption.length} / 2,200</small></label>
            <div className="media-block">
              <div className="media-head"><h3>Media</h3><span className="muted">{draft.assets.length} of 10</span></div>
              <ol className="assets">{draft.assets.map((asset, index) => <li key={asset} className={slide === index ? 'current' : ''}>
                <button className="asset-pick" onClick={() => { setSlide(index); setPane('preview'); }} aria-pressed={slide === index} aria-label={`Preview media ${index + 1}`}><Thumb id={asset} count={0}/><span>{index + 1}</span></button>
                <span className="asset-actions"><button aria-label={`Move media ${index + 1} earlier`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button aria-label={`Move media ${index + 1} later`} disabled={index === draft.assets.length - 1} onClick={() => move(index, 1)}>↓</button><button className="danger-link" onClick={() => { setDraft({ ...draft, assets: draft.assets.filter(a => a !== asset) }); setSlide(0); }}>Remove</button></span>
              </li>)}</ol>
              <label className="upload"><input type="file" accept="image/png,image/jpeg,image/webp,video/mp4" multiple onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) void run(() => upload(files)); }}/><span className="upload-text"><strong>Add media</strong><small>PNG, JPEG, WebP or MP4 · 20 MB per file · up to 10 slides</small></span></label>
            </div>
            <div className="save-bar"><span className="muted">{!draft.title.trim() ? 'Give the post a title to save it.' : !draft.assets.length ? 'Add at least one file to save.' : dirty ? 'Ready to save.' : 'Saved.'}</span><button className="primary" disabled={!dirty || !draft.title.trim() || !draft.assets.length} onClick={() => void run(() => mutate({ action: 'save', content: draft }))}>{selected ? 'Save new revision' : 'Save for review'}</button></div>
          </fieldset>

          {selected?.handoffs?.length ? <section className="publication" aria-label="Hermoso schedules"><h3>Hermoso schedules</h3>{selected.handoffs.map(h => <p key={h.jobId}><strong>{h.channels.every(channel => selected.publications?.some(pub => pub.channel === channel && pub.revision === h.revision)) ? 'Publication verified' : 'Scheduled in Hermoso'}</strong> · r{h.revision}<br/>{new Date(h.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · {h.channels.join(' + ')}<br/><small className="muted">{h.jobId}</small></p>)}<p className="muted">Posted includes confirmed scheduling. Live links appear after publication is verified. Editing this card does not update or cancel the Hermoso schedule.</p></section> : null}
          {selected?.publications?.length ? <section className="publication" aria-label="Published posts"><h3>Published posts</h3>{selected.publications.map(p => <p key={p.url}><a href={p.url} target="_blank" rel="noopener noreferrer">View on {p.channel === 'instagram' ? 'Instagram' : p.channel}</a> · {p.account} · r{p.revision}<br/><small className="muted">{when(p.postedAt)} · via Hermoso</small></p>)}<p className="muted">Saving a new revision does not change the live post.</p></section> : null}
          <section className="review" aria-label="Review">
            <h3>Review</h3>
            {selected && selected.status !== 'needs-review' && <div className={`decision ${selected.status}`}><span className={`status ${selected.status}`}>{label(selected.status)}</span><span className="muted">{ago(selected.updatedAt)}{selected.updatedBy ? ` by ${selected.updatedBy}` : ''}</span>{selected.feedback && <blockquote>{selected.feedback}</blockquote>}</div>}
            {dirty ? <p className="muted">Save the draft first. Every saved edit needs a fresh review.</p> : <p className="muted">{selected?.status === 'posted' ? 'This revision is posted. Save a new revision to prepare changes.' : 'Approve as is, or say what should change.'}</p>}
            <label>Feedback<textarea rows={3} maxLength={4000} disabled={busy || dirty || selected?.status === 'posted'} value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="What works? What should change?"/></label>
            <div className="actions">
              <button className="approve" disabled={busy || dirty || selected?.status === 'posted' || !selected} onClick={() => void run(() => mutate({ action: 'review', status: 'approved', feedback }))}>Approve</button>
              <button className="changes" disabled={busy || dirty || selected?.status === 'posted' || !selected || !feedback.trim()} onClick={() => void run(() => mutate({ action: 'review', status: 'changes-requested', feedback }))}>Request changes</button>
              <button className="reject" disabled={busy || dirty || selected?.status === 'posted' || !selected || !feedback.trim()} onClick={() => { if (window.confirm('Reject this post? The decision is recorded in its history.')) void run(() => mutate({ action: 'review', status: 'rejected', feedback })); }}>Reject</button>
            </div>
            {selected && !dirty && !feedback.trim() && <small className="muted">Request changes and Reject need written feedback.</small>}
          </section>

          {selected && <section className="history" aria-label="History">
            <div className="media-head"><h3>History</h3>{!historyOpen && <button disabled={busy} onClick={() => void showHistory()}>Show revisions and decisions</button>}</div>
            {historyOpen && <ol className="timeline">{history.map(h => <li key={h.version} className={h.status}>
              <span className="dot" aria-hidden="true"/>
              <div><strong>r{h.revision} · {label(h.status)}</strong><small className="muted" title={when(h.updatedAt)}>{ago(h.updatedAt)}{h.actorName ? ` · by ${h.actorName}` : ''}</small>
                {h.feedback && <blockquote>{h.feedback}</blockquote>}
                <details><summary>Revision r{h.revision} content</summary><p><strong>{h.title}</strong> · {format(h.placement)} · {languageLabel(h.language)}</p><p className="caption">{h.caption}</p><div className="history-media">{h.assets.map((asset, index) => <details key={asset}><summary>Media {index + 1}</summary><HistoricalMedia id={asset}/></details>)}</div><code>record {h.version} · {h.contentHash.slice(0, 12)}</code></details>
              </div>
            </li>)}{historyOpen && !history.length && !busy && <p className="muted">No history loaded.</p>}</ol>}
            {historyOpen && <small className="muted">Latest 100 actions. Older records stay stored.</small>}
          </section>}
        </section>

        <section className="preview" aria-label="Post preview">
          <div className="preview-head"><h2>Preview</h2><span className="pill quiet">{format(draft.placement)}</span></div>
          <div className={`phone ${draft.placement}`}>
            <div className="phone-top"><span className="avatar" aria-hidden="true">{initials(project.socialHandle || project.name)}</span><strong>{project.socialHandle || project.name}</strong></div>
            <div className="phone-media">{draft.assets[slide] ? <Media id={draft.assets[slide]}/> : <div className="empty">Your next post goes here.<small>Add media to see the private preview.</small></div>}</div>
            {draft.assets.length > 1 && <div className="pager"><button disabled={slide === 0} onClick={() => setSlide(slide - 1)} aria-label="Previous slide">‹</button><span className="dots" aria-label={`Slide ${slide + 1} of ${draft.assets.length}`}>{draft.assets.map((a, i) => <i key={a} className={i === slide ? 'on' : ''}/>)}</span><button disabled={slide >= draft.assets.length - 1} onClick={() => setSlide(slide + 1)} aria-label="Next slide">›</button></div>}
            <p className="caption"><strong>{project.socialHandle || project.name}</strong> {draft.caption || 'Your caption will appear here.'}</p>
          </div>
          <small className="muted">Preview only. Nothing is sent to Instagram or Facebook.</small>
        </section>
      </div>
    </div>
    <div hidden={tab !== 'skills'}><Skills api={api}/></div>
    {tab === 'analytics' && <Analytics key={user.uid} api={api} renderMedia={assetId => <Media id={assetId}/>} onOpenPost={postId => void run(async () => {
      const {post} = await (await api(`/posts/${postId}`)).json() as {post: Post};
      if (choose(post)) { setPosts(old => [post, ...old.filter(p => p.id !== post.id)]); setTab('content'); }
    })}/>}
    </>}
  </main>;
}
function HistoricalMedia({ id }: { id: string }) { const [open, setOpen] = useState(false); return open ? <Media id={id}/> : <button onClick={() => setOpen(true)}>Load private media</button>; }
createRoot(document.getElementById('root')!).render(<App/>);
