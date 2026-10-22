import type { Candidate, FetchedRecord, TypeKind } from './model';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) {
    let detail = `${r.status}`;
    try {
      const j = (await r.json()) as { detail?: string };
      if (j.detail) detail = String(j.detail);
    } catch {
      detail = `${r.status} ${r.statusText}`;
    }
    throw new Error(detail);
  }
  return (await r.json()) as T;
}

export interface ResolveResult {
  text: string;
  matches: Candidate[];
  note: string;
  failed?: boolean;
}

export interface RecordResult {
  entity: string;
  record: FetchedRecord | null;
  note: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  needs_key: boolean;
  key_set: boolean;
  key_help: string;
  site: string;
  terms: string;
  base: string;
  default_base: string;
  rpm: number;
  delay: number;
  supports: string[];
}

export interface QuoteSettings {
  provider: string;
  fx: 'ecb' | 'provider';
  ttl: Record<string, number>;
  providers: ProviderInfo[];
  ecb: { label: string; site: string; terms: string; base: string; default_base: string };
  requests?: Record<string, number>;
  cached?: number;
}

export interface RefreshSettings {
  stocks: string;
  currencies: string;
}

export const resolveTexts = (kind: TypeKind, texts: string[], fresh = false) => call<{ results: ResolveResult[] }>('POST', '/api/datatypes/resolve', { kind, texts, fresh });
export const fetchRecords = (kind: TypeKind, entities: string[], fresh = true) => call<{ results: RecordResult[] }>('POST', '/api/datatypes/records', { kind, entities, fresh });
export const getQuoteSettings = () => call<QuoteSettings>('GET', '/api/settings/quotes');
export const putQuoteSettings = (body: unknown) => call<QuoteSettings>('PUT', '/api/settings/quotes', body);
export const testProvider = (provider: string) => call<{ ecb: { ok: boolean; note: string }; provider?: { ok: boolean; note: string } }>('POST', '/api/settings/quotes/test', { provider });
export const getRefresh = (workbook: string) => call<RefreshSettings>('GET', `/api/datatypes/refresh-settings?workbook=${encodeURIComponent(workbook)}`);
export const putRefresh = (workbook: string, body: Partial<RefreshSettings>) => call<RefreshSettings>('PUT', `/api/datatypes/refresh-settings?workbook=${encodeURIComponent(workbook)}`, body);
