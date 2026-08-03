import { createHash } from 'node:crypto'
import { db } from './db.ts'
import { newCard, serialize } from './scheduler.ts'

// Mot the ma nguon co the den tu: file .tsv cua kho, Excel, CSV, hay nhap tay.
export type RawCard = {
  front: string
  back: string
  tags?: string
  deck?: string
  notetype?: string
  source?: string
  id?: string // id on dinh neu nguon co san — giu tien trinh khi sua mat truoc
}

// GUID on dinh, KHONG phu thuoc mat truoc: co id thi dung id; khong thi
// suy tu (deck + mat truoc) lan dau. Sua trong app giu nguyen guid nay nen
// doi mat truoc/sau van giu lich su on. Chi khi RE-IMPORT tu file ma mat
// truoc da doi va nguon KHONG co cot id thi moi coi la the moi.
export function guidCua(r: RawCard, deck: string): string {
  const raw = (r.id || '').trim()
  if (raw) return raw.startsWith('kbg_') ? raw : 'kbg_' + raw
  const tag = (r.tags || '').split(/\s+/).find((t) => t.startsWith('kbg_'))
  if (tag) return tag
  return 'kbg_' + createHash('sha1').update(`${deck}\t${r.front}`).digest('hex').slice(0, 10)
}

// Cloze {{c1::abc}} -> cau hoi hien [...], dap an hien dam
const CLOZE = /\{\{c\d+::(.*?)(?:::.*?)?\}\}/g
export function renderCloze(text: string) {
  return {
    front: text.replace(CLOZE, '[…]'),
    back: text.replace(CLOZE, '<b>$1</b>'),
  }
}

const selCard = db.prepare('SELECT front, back, tags, deck FROM card WHERE guid = ?')
const insCard = db.prepare(
  `INSERT INTO card (guid, deck, notetype, front, back, tags, source, updated)
   VALUES (@guid, @deck, @notetype, @front, @back, @tags, @source, @updated)`,
)
const updCard = db.prepare(
  `UPDATE card SET deck=@deck, notetype=@notetype, front=@front, back=@back,
   tags=@tags, source=@source, updated=@updated WHERE guid=@guid`,
)
const hasState = db.prepare('SELECT 1 FROM state WHERE guid = ?')
const insState = db.prepare(
  'INSERT INTO state (guid, due, fsrs, st, updated) VALUES (?, ?, ?, 0, ?)', // the moi -> st=0 (New)
)

export type Ket = 'added' | 'updated' | 'unchanged'

// Upsert mot the. Tra ve trang thai de bang tong ket biet da them/sua/giu nguyen.
// KHONG bao gio dung toi bang state — do la ly do sua noi dung giu tien trinh.
export function upsert(r: RawCard, now = new Date()): { guid: string; ket: Ket } {
  const deck = (r.deck || 'Nhap').trim()
  const notetype = r.notetype || (CLOZE.test(r.front) ? 'Cloze' : 'Basic')
  CLOZE.lastIndex = 0
  const guid = guidCua(r, deck)

  let front = r.front
  let back = r.back
  if (notetype.toLowerCase() === 'cloze') {
    const c = renderCloze(r.front)
    front = c.front
    back = r.back ? `${c.back}<br>${r.back}` : c.back
  }

  const iso = now.toISOString()
  const row = { guid, deck, notetype, front, back, tags: r.tags || '', source: r.source || '', updated: iso }

  const cu = selCard.get(guid) as { front: string; back: string; tags: string; deck: string } | undefined
  if (!cu) {
    insCard.run(row)
    insState.run(guid, iso, serialize(newCard(now)), iso) // the moi -> den han ngay
    return { guid, ket: 'added' }
  }
  const doi = cu.front !== front || cu.back !== back || cu.tags !== row.tags || cu.deck !== deck
  if (!doi) return { guid, ket: 'unchanged' }
  updCard.run(row)
  if (!hasState.get(guid)) insState.run(guid, iso, serialize(newCard(now)), iso)
  return { guid, ket: 'updated' }
}

// Phat hien trung: mat truoc giong het the khac (guid khac) — de canh bao "cau nay co roi".
const normFront = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
export function timTrung(front: string, boQuaGuid?: string): string[] {
  const n = normFront(front)
  const rows = db.prepare('SELECT guid, front FROM card').all() as { guid: string; front: string }[]
  return rows.filter((r) => r.guid !== boQuaGuid && normFront(r.front) === n).map((r) => r.guid)
}
