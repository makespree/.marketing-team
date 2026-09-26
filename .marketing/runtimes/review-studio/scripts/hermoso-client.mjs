// Exploration adapter: deliberately no media, publishing or spending methods.
const BASE = 'https://app.hermoso.ai/v1';
const READ_TOOLS = new Set(['list_connector_accounts', 'list_meta_pages']);
export class HermosoClient {
  #token; #fetch; #headers = {};
  constructor(token, transport = fetch) {
    if (typeof token !== 'string' || !/^hmk_[^\s]+$/.test(token)) throw Error('A valid Hermoso agent key is required. Store it locally, not in chat or source.');
    this.#token = token; this.#fetch = transport;
  }
  async #request(path, body) {
    let response;
    try {
      response = await this.#fetch(BASE + path, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${this.#token}`, ...this.#headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw Error('Hermoso could not be reached. No automatic retry or write was attempted.'); }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      // Do not echo arbitrary upstream text: it can contain request credentials.
      const code = typeof payload?.error?.code === 'string' && /^[a-z_]{1,80}$/.test(payload.error.code) ? payload.error.code : 'request_failed';
      const connector = typeof payload?.error?.connector === 'string' && /^[a-z_]{1,40}$/.test(payload.error.connector) ? payload.error.connector : undefined;
      throw Object.assign(Error(`Hermoso HTTP ${response.status}: ${code}${connector ? ` (connect ${connector} in Hermoso)` : ''}`), { status: response.status, code, connector });
    }
    if (!payload || typeof payload !== 'object') throw Error('Invalid Hermoso response.');
    return payload;
  }
  async brands() { return this.#request('/brands'); }
  async selectBrand(id) {
    if (!id) throw Error('Select an explicit Hermoso brand ID.');
    this.#headers = {};
    const list = await this.brands(), brand = list.data?.find(b => b.id === id);
    if (!brand || brand.headers?.['X-Hermoso-User'] !== id) throw Error('Hermoso brand was not found or returned invalid selection headers.');
    const headers = { 'X-Hermoso-User': id };
    if (brand.shared) {
      const owner = brand.headers['X-Hermoso-Owner'];
      if (typeof owner !== 'string' || !owner || owner !== brand.owner_account_id) throw Error('Shared brand owner header is missing or inconsistent.');
      headers['X-Hermoso-Owner'] = owner;
    }
    this.#headers = headers;
    return { id: brand.id, name: brand.name, shared: brand.shared, role: brand.role };
  }
  #selected() { if (!this.#headers['X-Hermoso-User']) throw Error('Select the brand before inspecting its accounts.'); }
  async channels() { this.#selected(); return this.#request('/channels'); }
  async schema(name) {
    this.#selected(); if (!/^[a-z][a-z0-9_]{1,90}$/.test(name)) throw Error('Invalid tool name.');
    return this.#request('/tools/' + name);
  }
  async readTool(name, args = {}) {
    this.#selected(); if (!READ_TOOLS.has(name)) throw Error('This adapter permits account discovery only.');
    const schema = await this.schema(name);
    if (schema.read_only !== true) throw Error('Live schema did not confirm a read-only tool.');
    if (schema.connector_connected === false) throw Error('The connector required by this tool is not connected to this Hermoso brand yet.');
    return this.#request('/tools/' + name, args);
  }
}

export function approvedExportPlan(post, assets) {
  if (post.status !== 'approved') throw Error('Approve this exact post revision in the studio before preparing an export.');
  if (!Number.isInteger(post.version) || !post.contentHash || !Array.isArray(post.assets) || !post.assets.length || assets.length !== post.assets.length) throw Error('Incomplete studio post.');
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    if (a.id !== post.assets[i] || !/^[a-f0-9]{64}$/.test(a.sha256) || !/^\d+$/.test(a.generation) || !['image/png', 'image/jpeg', 'image/webp', 'video/mp4'].includes(a.type)) throw Error('Invalid or unordered studio media records.');
  }
  return {
    mode: 'preview-only', postId: post.id, expectedVersion: post.version, contentHash: post.contentHash,
    title: post.title, caption: post.caption, placement: post.placement,
    assets: assets.map(({ id, type, size, sha256, generation }) => ({ id, type, size, sha256, generation })),
    timezone: 'Asia/Kolkata', transferPerformed: false,
    requiredBeforeTransfer: ['Explicit owner authorization for public Hermoso media URLs', 'Recheck exact post approval/version/hash', 'Select verified Hermoso brand and Meta destination IDs'],
  };
}
