// Goi API backend. Vite proxy /api -> http://localhost:3001
export type Card = {
  guid: string
  deck: string
  notetype: string
  front: string
  back: string
  tags: string
  due?: string
  reps?: number
}
export type Preview = Record<'1' | '2' | '3' | '4', string>
export type Choice = { text: string; correct: boolean }
export type NextResp = {
  card: Card | null
  laMoi: boolean
  reversed: boolean
  due: number
  daOnHomNay: number
  total: number
  preview?: Preview
  choices?: Choice[]
}
export type Maturity = { new: number; learning: number; young: number; mature: number }
export type Dashboard = {
  daOnHomNay: number
  retention: number | null
  review30: number
  streak: number
  maturity: Maturity
  retentionByDeck: { deck: string; retention: number; n: number }[]
  heatmap: { day: string; n: number }[]
  forecast: { day: string; n: number }[]
  tongThe: number
}
export type OptimizeResult = {
  ok: boolean
  message?: string
  w?: number[]
  reviews: number
  cards: number
  lossBefore?: number
  lossAfter?: number
}

async function j<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText)
  return r.json()
}
const qs = (o: Record<string, string | undefined>) =>
  Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')

export const api = {
  next: (f: { deck?: string; tag?: string; mode?: string; dir?: string } = {}) => j<NextResp>(`/api/next?${qs(f)}`),
  review: (guid: string, rating: number) =>
    j<{ ok: true; due: string }>('/api/review', { method: 'POST', body: JSON.stringify({ guid, rating }) }),
  undo: () => j<{ ok: boolean; guid?: string; message?: string }>('/api/undo', { method: 'POST' }),
  stats: () => j<{ total: number; daOnHomNay: number }>('/api/stats'),
  decks: () => j<{ deck: string; n: number }[]>('/api/decks'),
  tags: () => j<{ tag: string; n: number }[]>('/api/tags'),
  settings: () => j<Record<string, string>>('/api/settings'),
  saveSettings: (s: Record<string, string>) => j<Record<string, string>>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
  dashboard: () => j<Dashboard>('/api/dashboard'),
  cards: (f: { q?: string; deck?: string; state?: string; page?: number; pageSize?: number } = {}) =>
    j<{ cards: Card[]; total: number; khop: number; page: number; pageSize: number; soTrang: number }>(
      `/api/cards?${qs({ q: f.q, deck: f.deck, state: f.state, page: f.page?.toString(), pageSize: f.pageSize?.toString() })}`),
  checkDup: (front: string, guid?: string) =>
    j<{ trung: string[] }>('/api/check-dup', { method: 'POST', body: JSON.stringify({ front, guid }) }),
  create: (c: Partial<Card>) =>
    j<{ ok: true; guid: string; ket: string }>('/api/cards', { method: 'POST', body: JSON.stringify(c) }),
  update: (guid: string, c: Partial<Card>) =>
    j<{ ok: true }>(`/api/cards/${encodeURIComponent(guid)}`, { method: 'PUT', body: JSON.stringify(c) }),
  remove: (guid: string) => j<{ ok: true }>(`/api/cards/${encodeURIComponent(guid)}`, { method: 'DELETE' }),
  bulk: (guids: string[], action: 'delete' | 'deck', deck?: string) =>
    j<{ ok: true; so: number }>('/api/cards/bulk', { method: 'POST', body: JSON.stringify({ guids, action, deck }) }),
  import: (rows: Partial<Card>[], deck?: string) =>
    j<{ them: number; sua: number; giu: number; trung: { front: string; guids: string[] }[] }>(
      '/api/import', { method: 'POST', body: JSON.stringify({ rows, deck }) }),
  optimize: () => j<OptimizeResult>('/api/optimize', { method: 'POST' }),
  optimizeReset: () => j<{ ok: true }>('/api/optimize/reset', { method: 'POST' }),
  reschedule: () => j<{ ok: true; so: number }>('/api/reschedule', { method: 'POST' }),
  aiStatus: () => j<{ enabled: boolean; models: string[] }>('/api/ai/status'),
  generate: (text: string, model?: string, count?: number, deck?: string) =>
    j<{ cards: { front: string; back: string; tags: string }[] }>(
      '/api/generate', { method: 'POST', body: JSON.stringify({ text, model, count, deck }) }),
  backup: () => j<{ ok: true; file: string }>('/api/backup', { method: 'POST' }),
  backups: () => j<{ file: string; size: number; at: string }[]>('/api/backups'),
  renameDeck: (from: string, to: string) =>
    j<{ ok: true; so: number }>('/api/decks/rename', { method: 'POST', body: JSON.stringify({ from, to }) }),
  deleteDeck: (deck: string) =>
    j<{ ok: true; so: number }>('/api/decks/delete', { method: 'POST', body: JSON.stringify({ deck }) }),
}
