export type Metrics = { spendMinor: number | null; impressions: number | null; reach: number | null; clicks: number | null; linkClicks: number | null; landingPageViews: number | null; reactions: number | null; shares: number | null; saves: number | null };
export type AnalyticsRow = { id: string; name: string; campaignId: string; postId: string | null; metrics: Metrics; hasData: boolean };
export type AnalyticsSnapshot = { schemaVersion: 1; id: string; reportDate: string; fetchedAt: string; source: 'Hermoso / Meta Insights'; reportingTimezone: string; currency: string; currencyDigits: number; adAccountId: string; campaigns: AnalyticsRow[]; ads: AnalyticsRow[]; totals: Metrics };
const keys: (keyof Metrics)[] = ['spendMinor','impressions','reach','clicks','linkClicks','landingPageViews','reactions','shares','saves'];
export function dateKey(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value) throw Error('Use a valid reporting date (YYYY-MM-DD).');
  return value;
}
export function metricsFromMeta(rows: unknown, date: string, digits: number): Metrics {
  dateKey(date);
  if (!Array.isArray(rows) || rows.length > 1) throw Error('Expected one unbroken-down row for the explicit campaign or ad.');
  const r = rows[0];
  if (r && (r.date_start !== date || r.date_stop !== date)) throw Error('Meta reporting date does not match the requested day.');
  const number = (v: unknown, integer = true): number | null => {
    if (v === undefined || v === null || v === '') return null;
    if ((typeof v !== 'string' && typeof v !== 'number') || !/^\d+(\.\d+)?$/.test(String(v))) throw Error('Invalid metric.');
    const n = Number(v); if (!Number.isFinite(n) || n < 0 || (integer && !Number.isSafeInteger(n))) throw Error('Invalid metric.'); return n;
  };
  const action = (name: string) => {
    if (!Array.isArray(r?.actions)) return null;
    const matches = r.actions.filter((a: {action_type?: string}) => a.action_type === name);
    if (matches.length > 1) throw Error('Duplicate action metric.');
    return matches.length ? number(matches[0].value) : 0;
  };
  const spend = number(r?.spend, false);
  // Meta also returns omni_landing_page_view. It overlaps and must not be added.
  return { spendMinor: spend === null ? null : Math.round(spend * 10 ** digits), impressions:number(r?.impressions), reach:number(r?.reach), clicks:number(r?.clicks), linkClicks:action('link_click'), landingPageViews:action('landing_page_view'), reactions:action('post_reaction'), shares:action('post'), saves:action('onsite_conversion.post_save') };
}
export function totalMetrics(rows: AnalyticsRow[]): Metrics {
  return Object.fromEntries(keys.map(k => [k, k === 'reach' || !rows.length || rows.some(r=>r.metrics[k]===null) ? null : rows.reduce((s,r)=>s+r.metrics[k]!,0)])) as Metrics;
}
export const ratio = (numerator: number | null, denominator: number | null, scale=1) => numerator === null || denominator === null || denominator === 0 ? null : numerator / denominator * scale;
// Explicit projection prevents raw provider payloads or credentials entering the UI.
export function analyticsProjection(raw: unknown): AnalyticsSnapshot {
  const r = raw as AnalyticsSnapshot;
  if (!r || r.schemaVersion !== 1 || !/^\d+-\d{4}-\d{2}-\d{2}$/.test(r.id) || !/^\d+$/.test(r.adAccountId) || r.id !== `${r.adAccountId}-${dateKey(r.reportDate)}` || !/^[A-Z]{3}$/.test(r.currency) || !Number.isInteger(r.currencyDigits) || r.currencyDigits<0 || r.currencyDigits>3 || !Number.isFinite(Date.parse(r.fetchedAt)) || r.source !== 'Hermoso / Meta Insights') throw Error('Invalid analytics snapshot.');
  const metric = (m: Metrics): Metrics => Object.fromEntries(keys.map(k=>{const n=m?.[k];if(n!==null && (!Number.isSafeInteger(n)||n!<0))throw Error('Invalid analytics metric.');return[k,n];})) as Metrics;
  const project = (rows: AnalyticsRow[]) => {
    if (!Array.isArray(rows)||rows.length>100)throw Error('Invalid analytics rows.');
    if(new Set(rows.map(x=>x.id)).size!==rows.length)throw Error('Duplicate analytics IDs.');
    return rows.map(x=>{if(!/^\d+$/.test(x.id)||!/^\d+$/.test(x.campaignId)||typeof x.name!=='string'||x.name.length>300||typeof x.hasData!=='boolean'||(x.postId!==null&&!/^[a-f0-9-]{36}$/.test(x.postId)))throw Error('Invalid analytics row.');return{id:x.id,name:x.name,campaignId:x.campaignId,postId:x.postId,hasData:x.hasData,metrics:metric(x.metrics)};});
  };
  const campaigns=project(r.campaigns),ads=project(r.ads);if(ads.some(a=>!campaigns.some(c=>c.id===a.campaignId)))throw Error('Ad outside selected campaigns.');
  return {schemaVersion:1,id:r.id,reportDate:r.reportDate,fetchedAt:r.fetchedAt,source:r.source,reportingTimezone:'Meta ad account reporting day',currency:r.currency,currencyDigits:r.currencyDigits,adAccountId:r.adAccountId,campaigns,ads,totals:totalMetrics(campaigns)};
}
