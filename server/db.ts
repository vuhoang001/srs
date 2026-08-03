import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const DATA = join(here, '..', 'data')
mkdirSync(DATA, { recursive: true })

export const db = new Database(join(DATA, 'kb.db'))
db.pragma('journal_mode = WAL')

// card    = NOI DUNG (nhap tu kho, ghi de khi kho doi)
// state   = TIEN TRINH on tap do FSRS quan (KHONG dung khi import lai)
// tach hai bang la ly do sua noi dung khong bao gio lam mat lich su on.
db.exec(`
  CREATE TABLE IF NOT EXISTS card (
    guid     TEXT PRIMARY KEY,
    deck     TEXT NOT NULL,
    notetype TEXT NOT NULL,
    front    TEXT NOT NULL,
    back     TEXT NOT NULL,
    tags     TEXT NOT NULL DEFAULT '',
    source   TEXT NOT NULL DEFAULT '',
    updated  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS state (
    guid    TEXT PRIMARY KEY REFERENCES card(guid) ON DELETE CASCADE,
    due     TEXT NOT NULL,
    fsrs    TEXT NOT NULL,
    st      INTEGER NOT NULL DEFAULT 0,
    updated TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_state_due ON state(due);

  CREATE TABLE IF NOT EXISTS review_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    guid      TEXT NOT NULL,
    rating    INTEGER NOT NULL,
    reviewed  TEXT NOT NULL,
    prev_due  TEXT,
    prev_fsrs TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_log_reviewed ON review_log(reviewed);
  CREATE INDEX IF NOT EXISTS idx_log_guid ON review_log(guid);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

// prev_due/prev_fsrs them sau — DB cu chua co thi ALTER (bo qua neu da co)
for (const col of ['prev_due', 'prev_fsrs']) {
  try {
    db.exec(`ALTER TABLE review_log ADD COLUMN ${col} TEXT`)
  } catch {
    /* cot da ton tai */
  }
}

// state.st (trang thai FSRS: 0 New·1 Learning·2 Review·3 Relearning) them sau —
// DB cu chua co cot thi ALTER roi backfill tu JSON fsrs (de loc "the dang hoc lai" nhanh).
const stateCols = (db.prepare('PRAGMA table_info(state)').all() as { name: string }[]).map((c) => c.name)
if (!stateCols.includes('st')) {
  db.exec('ALTER TABLE state ADD COLUMN st INTEGER NOT NULL DEFAULT 0')
  const rows = db.prepare('SELECT guid, fsrs FROM state').all() as { guid: string; fsrs: string }[]
  const upd = db.prepare('UPDATE state SET st=? WHERE guid=?')
  db.transaction(() => {
    for (const r of rows) {
      try { upd.run(Number(JSON.parse(r.fsrs).state) || 0, r.guid) } catch { /* bo qua ban ghi loi */ }
    }
  })()
}
db.exec('CREATE INDEX IF NOT EXISTS idx_state_st ON state(st)')

// ---------- settings: key-value, co gia tri mac dinh ----------

const MAC_DINH: Record<string, string> = {
  new_per_day: '20',
  max_reviews_per_day: '200',   // tran so luot on the CU moi ngay (0 = khong gioi han)
  request_retention: '0.9',     // muc tieu ti le nho FSRS (0.80–0.97)
  learn_ahead_min: '20',        // the dang hoc/hoc lai den han trong bao nhieu phut thi cho hien lai trong phien
  w: '',                        // 19 tham so FSRS toi uu (JSON) — rong = dung mac dinh
}
export function getSetting(key: string): string {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return r?.value ?? MAC_DINH[key] ?? ''
}
export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(
    key, value, value,
  )
}
export function allSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const out = { ...MAC_DINH }
  for (const r of rows) out[r.key] = r.value
  return out
}

export type CardRow = {
  guid: string
  deck: string
  notetype: string
  front: string
  back: string
  tags: string
  source: string
  updated: string
}
