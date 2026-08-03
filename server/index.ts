import express from 'express'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { db, getSetting, setSetting, allSettings, type CardRow } from './db.ts'
import { review, deserialize, serialize, previews, resetFsrs, rescheduleDue, Rating, type Grade } from './scheduler.ts'
import { upsert, timTrung, type RawCard } from './import-core.ts'
import { optimizeParams } from './optimize.ts'
import { generateCards, AI_MODELS } from './ai.ts'
import { makeBackup, listBackups, backupPath, NAME_RE } from './backup.ts'

const here = dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json({ limit: '25mb' }))

// ---------- tien ich ngay (theo gio dia phuong) ----------

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}
const dayKey = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// So the moi (chua tung on) da hoc trong hom nay
function newToday(): number {
  const start = startOfToday()
  const r = db
    .prepare(`SELECT COUNT(*) n FROM (SELECT guid, MIN(reviewed) m FROM review_log GROUP BY guid) WHERE m >= ?`)
    .get(start) as { n: number }
  return r.n
}

// So luot on the CU trong hom nay = tong luot hom nay tru so the moi hoc hom nay
// (de gioi han max_reviews_per_day khong dinh toi the moi).
function reviewsToday(): number {
  const start = startOfToday()
  const tong = (db.prepare('SELECT COUNT(*) n FROM review_log WHERE reviewed>=?').get(start) as { n: number }).n
  return Math.max(0, tong - newToday())
}

// Loc theo deck / tag -> menh de WHERE + tham so
function locWhere(deck?: string, tag?: string) {
  const w: string[] = []
  const p: any[] = []
  if (deck) { w.push('c.deck = ?'); p.push(deck) }
  if (tag) { w.push('c.tags LIKE ?'); p.push(`%${tag}%`) }
  return { clause: w.length ? ' AND ' + w.join(' AND ') : '', params: p }
}

// ---------- REVIEW ----------

// Chon the ke tiep, uu tien theo 3 bac:
//   1. The DANG HOC LAI trong phien (Learning/Relearning, den han trong learn_ahead_min phut)
//      -> hien lai ngay trong buoi de "dong dinh" the vua sai, dung Anki lam.
//   2. The CU den han (Review) — chan boi max_reviews_per_day.
//   3. The MOI chua tung on — chan boi new_per_day.
// Tra kem preview khoang cach va, neu quiz, dap an nhieu. dir: fwd|rev|both (hoc xuoi/nguoc).
app.get('/api/next', (req, res) => {
  const deck = req.query.deck ? String(req.query.deck) : undefined
  const tag = req.query.tag ? String(req.query.tag) : undefined
  const mode = String(req.query.mode || 'flash')
  const dir = String(req.query.dir || 'fwd') // fwd | rev | both
  const now = new Date()
  const nowIso = now.toISOString()
  const learnAhead = Math.max(0, Number(getSetting('learn_ahead_min')) || 0)
  const aheadIso = new Date(now.getTime() + learnAhead * 60000).toISOString()
  const { clause, params } = locWhere(deck, tag)

  // Han muc con lai hom nay
  const newLimit = Number(getSetting('new_per_day'))
  const newConLai = Math.max(0, newLimit - newToday())
  const maxRev = Number(getSetting('max_reviews_per_day')) || 0 // 0 = khong gioi han
  const revConLai = maxRev <= 0 ? Infinity : Math.max(0, maxRev - reviewsToday())

  // Dem tung bac (de hien thanh tien do "con lai")
  const cnt = (sql: string, ...extra: any[]) =>
    (db.prepare(sql).get(...extra, ...params) as { n: number }).n

  // The hoc/hoc-lai: tach "DEN HAN that (<=now)" vs "SAP toi (trong learn_ahead)".
  const learnDueNow = cnt(
    `SELECT COUNT(*) n FROM card c JOIN state s USING(guid)
      WHERE s.st IN (1,3) AND s.due<=?${clause}`, nowIso)
  const learnSoon = cnt(
    `SELECT COUNT(*) n FROM card c JOIN state s USING(guid)
      WHERE s.st IN (1,3) AND s.due>? AND s.due<=?${clause}`, nowIso, aheadIso)
  const reviewDue = cnt(
    `SELECT COUNT(*) n FROM card c JOIN state s USING(guid)
      WHERE s.st=2 AND s.due<=?${clause}`, nowIso)
  const freshTong = cnt(
    `SELECT COUNT(*) n FROM card c JOIN state s USING(guid)
      WHERE NOT EXISTS(SELECT 1 FROM review_log r WHERE r.guid=c.guid)${clause}`)
  const freshDung = Math.min(freshTong, newConLai)
  const reviewDung = Math.min(reviewDue, revConLai)

  // Lay the theo thu tu uu tien:
  //   1) hoc/hoc-lai DEN HAN that (due<=now)   2) review den han   3) the moi
  //   4) (PHUONG AN CUOI) hoc-lai SAP toi (due trong learn_ahead nhung >now)
  //      — chi khi khong con gi khac. Nho vay the vua cham KHONG bi lap lai ngay
  //      khi van con the moi / the khac de hoc.
  const pick = (sql: string, ...extra: any[]) =>
    db.prepare(sql).get(...extra, ...params) as CardRow | undefined

  let row: CardRow | undefined
  let laMoi = false
  row = pick(
    `SELECT c.* FROM card c JOIN state s USING(guid)
      WHERE s.st IN (1,3) AND s.due<=?${clause} ORDER BY s.due ASC LIMIT 1`, nowIso)
  if (!row && reviewDung > 0) {
    row = pick(
      `SELECT c.* FROM card c JOIN state s USING(guid)
        WHERE s.st=2 AND s.due<=?${clause} ORDER BY s.due ASC LIMIT 1`, nowIso)
  }
  if (!row && freshDung > 0) {
    row = pick(
      `SELECT c.* FROM card c JOIN state s USING(guid)
        WHERE NOT EXISTS(SELECT 1 FROM review_log r WHERE r.guid=c.guid)${clause}
        ORDER BY s.due ASC LIMIT 1`)
    laMoi = !!row
  }
  if (!row) {
    row = pick(
      `SELECT c.* FROM card c JOIN state s USING(guid)
        WHERE s.st IN (1,3) AND s.due>? AND s.due<=?${clause} ORDER BY s.due ASC LIMIT 1`, nowIso, aheadIso)
  }

  const due = learnDueNow + learnSoon + reviewDung + freshDung
  const out: any = { card: row ?? null, laMoi, due, reversed: false, ...demSo() }
  if (row) {
    // Hoc nguoc: doi vai mat truoc/sau. Cloze khong dao duoc -> luon xuoi.
    const canRev = row.notetype.toLowerCase() !== 'cloze'
    const reverse = canRev && (dir === 'rev' || (dir === 'both' && Math.random() < 0.5))
    if (reverse) {
      out.card = { ...row, front: row.back, back: row.front }
      out.reversed = true
    }
    const st = db.prepare('SELECT fsrs FROM state WHERE guid=?').get(row.guid) as { fsrs: string }
    out.preview = previews(deserialize(st.fsrs), now)
    // Trac nghiem chi ap dung khi hoc xuoi & khong phai cloze
    if (mode === 'quiz' && !reverse && row.notetype.toLowerCase() !== 'cloze') {
      out.choices = quizChoices(row)
    }
  }
  res.json(out)
})

// Dap an nhieu: 3 mat sau cua the khac cung deck (thieu thi lay bat ky) + dap an dung
function quizChoices(card: CardRow): { text: string; correct: boolean }[] {
  let nhieu = db
    .prepare(`SELECT back FROM card WHERE guid!=? AND notetype!='Cloze' AND deck=? ORDER BY RANDOM() LIMIT 3`)
    .all(card.guid, card.deck) as { back: string }[]
  if (nhieu.length < 3) {
    const them = db
      .prepare(`SELECT back FROM card WHERE guid!=? AND notetype!='Cloze' ORDER BY RANDOM() LIMIT ?`)
      .all(card.guid, 3 - nhieu.length) as { back: string }[]
    nhieu = [...nhieu, ...them]
  }
  const ds = [{ text: card.back, correct: true }, ...nhieu.map((n) => ({ text: n.back, correct: false }))]
  for (let i = ds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[ds[i], ds[j]] = [ds[j], ds[i]]
  }
  return ds
}

// Cham diem: luu trang thai TRUOC (de undo) roi cho FSRS lap lich lai
app.post('/api/review', (req, res) => {
  const { guid, rating } = req.body as { guid: string; rating: number }
  if (![1, 2, 3, 4].includes(rating)) return res.status(400).json({ error: 'rating phai 1..4' })
  const st = db.prepare('SELECT due, fsrs FROM state WHERE guid=?').get(guid) as { due: string; fsrs: string } | undefined
  if (!st) return res.status(404).json({ error: 'khong thay the' })
  const now = new Date()
  const { card } = review(deserialize(st.fsrs), rating as Grade, now)
  const iso = now.toISOString()
  db.prepare('UPDATE state SET due=?, fsrs=?, st=?, updated=? WHERE guid=?')
    .run(card.due.toISOString(), serialize(card), Number(card.state), iso, guid)
  db.prepare('INSERT INTO review_log (guid, rating, reviewed, prev_due, prev_fsrs) VALUES (?,?,?,?,?)')
    .run(guid, rating, iso, st.due, st.fsrs)
  res.json({ ok: true, due: card.due.toISOString() })
})

// Hoan tac lan cham gan nhat: khoi phuc trang thai truoc do
app.post('/api/undo', (_req, res) => {
  const last = db.prepare('SELECT * FROM review_log ORDER BY id DESC LIMIT 1').get() as
    | { id: number; guid: string; prev_due: string; prev_fsrs: string }
    | undefined
  if (!last) return res.json({ ok: false, message: 'khong co gi de hoan tac' })
  if (last.prev_fsrs) {
    let prevSt = 0
    try { prevSt = Number(JSON.parse(last.prev_fsrs).state) || 0 } catch { /* giu 0 */ }
    db.prepare('UPDATE state SET due=?, fsrs=?, st=?, updated=? WHERE guid=?')
      .run(last.prev_due, last.prev_fsrs, prevSt, new Date().toISOString(), last.guid)
  }
  db.prepare('DELETE FROM review_log WHERE id=?').run(last.id)
  res.json({ ok: true, guid: last.guid })
})

function demSo() {
  const now = new Date().toISOString()
  const total = (db.prepare('SELECT COUNT(*) n FROM card').get() as { n: number }).n
  const daOnHomNay = (db.prepare('SELECT COUNT(*) n FROM review_log WHERE reviewed>=?').get(startOfToday()) as { n: number }).n
  return { total, daOnHomNay }
}
app.get('/api/stats', (_req, res) => res.json(demSo()))

// ---------- BO / TAG (cho bo loc) ----------

app.get('/api/decks', (_req, res) => {
  res.json(db.prepare('SELECT deck, COUNT(*) n FROM card GROUP BY deck ORDER BY deck').all())
})
app.get('/api/tags', (_req, res) => {
  const rows = db.prepare('SELECT tags FROM card').all() as { tags: string }[]
  const dem = new Map<string, number>()
  for (const r of rows) for (const t of r.tags.split(/\s+/).filter(Boolean)) {
    if (t.startsWith('kbg_')) continue
    dem.set(t, (dem.get(t) || 0) + 1)
  }
  res.json([...dem.entries()].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n))
})

// ---------- SETTINGS ----------

app.get('/api/settings', (_req, res) => res.json(allSettings()))
app.put('/api/settings', (req, res) => {
  for (const [k, v] of Object.entries(req.body as Record<string, string>)) setSetting(k, String(v))
  resetFsrs() // request_retention / w co the da doi -> dung lai FSRS
  res.json(allSettings())
})

// ---------- OPTIMIZE (ca nhan hoa tham so FSRS tu lich su on) ----------

app.post('/api/optimize', async (_req, res) => {
  try {
    const kq = await optimizeParams()
    if (kq.w) { setSetting('w', JSON.stringify(kq.w)); resetFsrs() }
    res.json(kq)
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'toi uu that bai' })
  }
})

// Khoi phuc tham so mac dinh
app.post('/api/optimize/reset', (_req, res) => {
  setSetting('w', '')
  resetFsrs()
  res.json({ ok: true })
})

// Tinh lai lich toan bo the Review theo tham so hien tai (sau khi optimize/doi retention)
app.post('/api/reschedule', (_req, res) => {
  const rows = db.prepare('SELECT guid, fsrs FROM state WHERE st=2').all() as { guid: string; fsrs: string }[]
  const now = new Date()
  const iso = now.toISOString()
  const upd = db.prepare('UPDATE state SET due=?, fsrs=?, updated=? WHERE guid=?')
  let so = 0
  db.transaction(() => {
    for (const r of rows) {
      try {
        const c = deserialize(r.fsrs)
        const due = rescheduleDue(c, now)
        c.due = due
        upd.run(due.toISOString(), serialize(c), iso, r.guid)
        so++
      } catch { /* bo qua ban ghi loi */ }
    }
  })()
  res.json({ ok: true, so })
})

// ---------- AI SINH THE ----------

app.get('/api/ai/status', (_req, res) => {
  res.json({ enabled: !!process.env.ANTHROPIC_API_KEY, models: AI_MODELS })
})

// Danh sach cau hoi (mat truoc, da bo HTML) da co trong kho — de khu trung khi sinh moi
function frontsHienCo(deck?: string): string[] {
  const rows = (deck
    ? db.prepare('SELECT front FROM card WHERE deck=?').all(deck)
    : db.prepare('SELECT front FROM card').all()) as { front: string }[]
  return rows.map((r) => r.front.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean)
}

app.get('/api/questions', (req, res) => {
  const deck = req.query.deck ? String(req.query.deck) : undefined
  res.json({ questions: frontsHienCo(deck) })
})

app.post('/api/generate', async (req, res) => {
  const { text, model, count, avoid } = req.body as
    { text?: string; model?: string; count?: number; avoid?: string[] }
  try {
    // Khu trung theo TOAN KHO (moi deck) — "cau nay da co chua" khong phu thuoc deck.
    // Client co the tu gui 'avoid' de ghi de.
    const avoidList = Array.isArray(avoid) && avoid.length ? avoid : frontsHienCo()
    const cards = await generateCards({ text: text || '', model, count, avoid: avoidList })
    res.json({ cards })
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Tạo thẻ thất bại' })
  }
})

// ---------- SAO LUU ----------

app.post('/api/backup', async (_req, res) => {
  try {
    const file = await makeBackup(new Date().toISOString())
    res.json({ ok: true, file })
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Sao lưu thất bại' })
  }
})

app.get('/api/backups', (_req, res) => res.json(listBackups()))

app.get('/api/backups/:file', (req, res) => {
  const file = req.params.file
  if (!NAME_RE.test(file)) return res.status(400).json({ error: 'tên file không hợp lệ' })
  res.download(backupPath(file), file)
})

// ---------- DASHBOARD ----------

app.get('/api/dashboard', (_req, res) => {
  const now = new Date()
  // review 90 ngay gan nhat -> bucket theo ngay dia phuong (kem deck de tinh retention theo bo)
  const from = new Date(now); from.setDate(from.getDate() - 89); from.setHours(0, 0, 0, 0)
  const logs = db.prepare(
    `SELECT r.guid, r.rating, r.reviewed, c.deck FROM review_log r
     LEFT JOIN card c USING(guid) WHERE r.reviewed>=? ORDER BY r.reviewed ASC`
  ).all(from.toISOString()) as { guid: string; rating: number; reviewed: string; deck: string | null }[]

  // Heatmap 90 ngay: dem MOI luot (ke ca hoc lai) — day la "hoat dong", khong phai retention
  const theoNgay = new Map<string, number>()
  for (const l of logs) {
    const k = dayKey(l.reviewed)
    theoNgay.set(k, (theoNgay.get(k) || 0) + 1)
  }
  const heatmap: { day: string; n: number }[] = []
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i)
    const k = dayKey(d.toISOString())
    heatmap.push({ day: k, n: theoNgay.get(k) || 0 })
  }

  // ---- True retention 30 ngay (chuan hon) ----
  // Chi tinh LAN CHAM DAU cua moi the trong moi ngay, va bo qua lan cham dau doi cua the
  // (do la the moi dang hoc, khong phai "on lai"). pass = rating>=2 (khong phai Again).
  const firstEver = new Map<string, string>()
  for (const r of db.prepare('SELECT guid, MIN(reviewed) m FROM review_log GROUP BY guid').all() as
    { guid: string; m: string }[]) firstEver.set(r.guid, r.m)

  const start30 = new Date(now); start30.setDate(start30.getDate() - 29); start30.setHours(0, 0, 0, 0)
  const seenFirstOfDay = new Set<string>() // guid|day da tinh
  let pass = 0, tong = 0
  const perDeck = new Map<string, { pass: number; tong: number }>()
  for (const l of logs) {
    if (new Date(l.reviewed) < start30) continue
    if (firstEver.get(l.guid) === l.reviewed) continue // bo lan hoc dau tien cua the
    const key = `${l.guid}|${dayKey(l.reviewed)}`
    if (seenFirstOfDay.has(key)) continue // chi lan dau trong ngay
    seenFirstOfDay.add(key)
    const ok = l.rating >= 2
    tong++; if (ok) pass++
    const dk = l.deck || '—'
    const pd = perDeck.get(dk) || { pass: 0, tong: 0 }
    pd.tong++; if (ok) pd.pass++
    perDeck.set(dk, pd)
  }
  const retentionByDeck = [...perDeck.entries()]
    .filter(([, v]) => v.tong >= 3)
    .map(([deck, v]) => ({ deck, retention: Math.round((v.pass / v.tong) * 100), n: v.tong }))
    .sort((a, b) => a.retention - b.retention) // deck yeu nhat len dau

  // ---- Chuoi ngay hoc lien tiep (streak) ----
  const ngayCoHoc = new Set(
    (db.prepare('SELECT reviewed FROM review_log').all() as { reviewed: string }[]).map((r) => dayKey(r.reviewed)))
  let streak = 0
  const cur = new Date(now)
  if (!ngayCoHoc.has(dayKey(cur.toISOString()))) cur.setDate(cur.getDate() - 1) // hom nay chua hoc -> tinh tu hom qua
  while (ngayCoHoc.has(dayKey(cur.toISOString()))) { streak++; cur.setDate(cur.getDate() - 1) }

  // ---- Phan bo do chin cua the ----
  // New (st=0) · Learning (st 1/3) · Young (Review, chu ky <21 ngay) · Mature (>=21 ngay)
  const chin = { new: 0, learning: 0, young: 0, mature: 0 }
  for (const s of db.prepare('SELECT st, fsrs FROM state').all() as { st: number; fsrs: string }[]) {
    if (s.st === 1 || s.st === 3) { chin.learning++; continue }
    if (s.st !== 2) { chin.new++; continue }
    let sd = 0
    try { sd = Number(JSON.parse(s.fsrs).scheduled_days) || 0 } catch { /* 0 */ }
    if (sd >= 21) chin.mature++; else chin.young++
  }

  // ---- Du bao: the den han 7 ngay toi ----
  const dues = db.prepare('SELECT due FROM state').all() as { due: string }[]
  const forecast: { day: string; n: number }[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(now); d.setDate(d.getDate() + i)
    const k = dayKey(d.toISOString())
    const n = dues.filter((x) => dayKey(x.due) === k || (i === 0 && new Date(x.due) <= now)).length
    forecast.push({ day: k, n })
  }

  res.json({
    daOnHomNay: (theoNgay.get(dayKey(now.toISOString())) || 0),
    retention: tong ? Math.round((pass / tong) * 100) : null,
    review30: tong,
    streak,
    maturity: chin,
    retentionByDeck,
    heatmap,
    forecast,
    tongThe: (db.prepare('SELECT COUNT(*) n FROM card').get() as { n: number }).n,
  })
})

// ---------- QUAN LY ----------

app.get('/api/cards', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase()
  const deck = req.query.deck ? String(req.query.deck) : ''
  const trangThai = String(req.query.state || '') // '', 'new', 'due', 'seen'
  const now = new Date().toISOString()
  let rows = db
    .prepare(`SELECT c.guid, c.deck, c.notetype, c.front, c.back, c.tags, s.due,
              (SELECT COUNT(*) FROM review_log r WHERE r.guid=c.guid) reps
       FROM card c LEFT JOIN state s USING(guid) ORDER BY c.updated DESC`)
    .all() as any[]
  // Loc theo deck kem deck con: chon "KB" ra ca "KB::dbt", "KB::Data Modeling"…
  if (deck) rows = rows.filter((r) => r.deck === deck || r.deck.startsWith(deck + '::'))
  if (trangThai === 'new') rows = rows.filter((r) => !r.reps)
  else if (trangThai === 'seen') rows = rows.filter((r) => r.reps)
  else if (trangThai === 'due') rows = rows.filter((r) => r.due && r.due <= now)
  const loc = q ? rows.filter((r) => (r.front + ' ' + r.tags).toLowerCase().includes(q)) : rows
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50))
  const soTrang = Math.max(1, Math.ceil(loc.length / pageSize))
  const page = Math.min(soTrang, Math.max(1, Number(req.query.page) || 1))
  const start = (page - 1) * pageSize
  res.json({ cards: loc.slice(start, start + pageSize), total: rows.length, khop: loc.length, page, pageSize, soTrang })
})

app.post('/api/check-dup', (req, res) => {
  const { front, guid } = req.body as { front: string; guid?: string }
  res.json({ trung: timTrung(front || '', guid) })
})

app.put('/api/cards/:guid', (req, res) => {
  const { front, back, tags, deck } = req.body as Partial<CardRow>
  const cur = db.prepare('SELECT * FROM card WHERE guid=?').get(req.params.guid) as CardRow | undefined
  if (!cur) return res.status(404).json({ error: 'khong thay the' })
  db.prepare('UPDATE card SET front=?, back=?, tags=?, deck=?, updated=? WHERE guid=?')
    .run(front ?? cur.front, back ?? cur.back, tags ?? cur.tags, deck ?? cur.deck, new Date().toISOString(), req.params.guid)
  res.json({ ok: true })
})

app.post('/api/cards', (req, res) => {
  const { front, back, tags, deck } = req.body as Partial<RawCard>
  if (!front || !back) return res.status(400).json({ error: 'thieu mat truoc/sau' })
  const { guid, ket } = upsert({ front, back, tags, deck, source: 'nhap tay' })
  res.json({ ok: true, guid, ket })
})

app.delete('/api/cards/:guid', (req, res) => {
  db.prepare('DELETE FROM card WHERE guid=?').run(req.params.guid)
  res.json({ ok: true })
})

// Thao tac hang loat: xoa nhieu, hoac doi deck
app.post('/api/cards/bulk', (req, res) => {
  const { guids, action, deck } = req.body as { guids: string[]; action: 'delete' | 'deck'; deck?: string }
  if (!Array.isArray(guids) || !guids.length) return res.status(400).json({ error: 'thieu guids' })
  const q = guids.map(() => '?').join(',')
  if (action === 'delete') {
    db.prepare(`DELETE FROM card WHERE guid IN (${q})`).run(...guids)
  } else if (action === 'deck' && deck) {
    db.prepare(`UPDATE card SET deck=?, updated=? WHERE guid IN (${q})`).run(deck, new Date().toISOString(), ...guids)
  } else return res.status(400).json({ error: 'action khong hop le' })
  res.json({ ok: true, so: guids.length })
})

// ---------- IMPORT / EXPORT ----------

app.post('/api/import', (req, res) => {
  const { rows, deck } = req.body as { rows: RawCard[]; deck?: string }
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows phai la mang' })
  let them = 0, sua = 0, giu = 0
  const trung: { front: string; guids: string[] }[] = []
  for (const r of rows) {
    if (!r.front) continue
    const dup = timTrung(r.front)
    const { ket } = upsert({ ...r, deck: r.deck || deck })
    if (ket === 'added') them++
    else if (ket === 'updated') sua++
    else giu++
    if (dup.length) trung.push({ front: r.front.slice(0, 60), guids: dup })
  }
  res.json({ them, sua, giu, trung })
})

// Xuat toan bo hoac 1 deck (?deck=...). Ten file goi theo deck cho de quan ly.
app.get('/api/export', (req, res) => {
  const deck = req.query.deck ? String(req.query.deck) : ''
  const rows = (deck
    ? db.prepare('SELECT guid, deck, notetype, front, back, tags FROM card WHERE deck=? ORDER BY updated').all(deck)
    : db.prepare('SELECT guid, deck, notetype, front, back, tags FROM card ORDER BY deck, updated').all()) as any[]
  const slug = (deck || 'all').replace(/[^0-9A-Za-z]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'all'
  if (String(req.query.format) === 'csv') {
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`
    const head = 'id,deck,notetype,front,back,tags'
    const body = rows.map((r) => [r.guid, r.deck, r.notetype, r.front, r.back, r.tags].map(esc).join(',')).join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="srs-${slug}.csv"`)
    return res.send(head + '\n' + body)
  }
  res.setHeader('Content-Disposition', `attachment; filename="srs-${slug}.json"`)
  res.json(rows)
})

// ---------- QUAN LY DECK ----------

// Doi ten deck: chuyen moi the tu deck cu sang ten moi (dung body de khoi vuong ky tu :: / khoang trang)
app.post('/api/decks/rename', (req, res) => {
  const { from, to } = req.body as { from?: string; to?: string }
  if (!from || !to?.trim()) return res.status(400).json({ error: 'thiếu tên deck' })
  const r = db.prepare('UPDATE card SET deck=?, updated=? WHERE deck=?').run(to.trim(), new Date().toISOString(), from)
  res.json({ ok: true, so: r.changes })
})

// Xoa ca deck (xoa moi the trong deck + tien trinh cua chung)
app.post('/api/decks/delete', (req, res) => {
  const { deck } = req.body as { deck?: string }
  if (!deck) return res.status(400).json({ error: 'thiếu deck' })
  const r = db.prepare('DELETE FROM card WHERE deck=?').run(deck)
  res.json({ ok: true, so: r.changes })
})

// ---------- Phuc vu frontend da build ----------

const dist = join(here, '..', 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')))
}

const PORT = Number(process.env.PORT || 3001)
app.listen(PORT, () => console.log(`API + app: http://localhost:${PORT}`))
// Sao luu chi chay khi bam "Sao luu ngay" (POST /api/backup) — khong tu dong.
