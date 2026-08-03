import { fsrs, generatorParameters, createEmptyCard, Rating, State, type Card, type Grade } from 'ts-fsrs'
import { getSetting } from './db.ts'

export { Rating, State }
export type { Card, Grade }

// FSRS duoc dung lai qua nhieu request. Tham so (request_retention + w) lay tu settings
// nen phai dung lai duoc khi nguoi dung doi cau hinh hoac chay optimizer. Cache lai, xoa
// bang resetFsrs() moi khi settings.request_retention / settings.w thay doi.
let _f: ReturnType<typeof fsrs> | null = null

export function resetFsrs() {
  _f = null
}

function inst() {
  if (_f) return _f
  const rr = Number(getSetting('request_retention'))
  const request_retention = rr > 0 && rr <= 1 ? rr : 0.9
  let w: number[] | undefined
  const raw = getSetting('w')
  if (raw) {
    try {
      const a = JSON.parse(raw)
      if (Array.isArray(a) && a.length === 19 && a.every((x) => Number.isFinite(x))) w = a
    } catch { /* w hong -> dung mac dinh */ }
  }
  // enable_fuzz: gian cach ngau nhien nhe de cac the khong don cuc bo cung mot ngay
  _f = fsrs(generatorParameters({ enable_fuzz: true, request_retention, ...(w ? { w } : {}) }))
  return _f
}

// Xem truoc: cham moi muc thi den han khi nao — de hien nhan len 4 nut
export function previews(card: Card, now = new Date()): Record<1 | 2 | 3 | 4, string> {
  const r = inst().repeat(card, now)
  return {
    1: r[Rating.Again].card.due.toISOString(),
    2: r[Rating.Hard].card.due.toISOString(),
    3: r[Rating.Good].card.due.toISOString(),
    4: r[Rating.Easy].card.due.toISOString(),
  }
}

export function newCard(now = new Date()): Card {
  return createEmptyCard(now)
}

// Tinh lai lich cho MOT the (state Review) theo tham so hien tai (request_retention/w moi).
// Dung sau khi optimize/doi retention: due cu tinh theo tham so cu -> tinh lai tu do on dinh
// (stability) hien co, KHONG doi lich su on. Sua scheduled_days va tra ve due moi.
export function rescheduleDue(card: Card, now = new Date()): Date {
  const ivl = inst().next_interval(card.stability, card.elapsed_days)
  card.scheduled_days = ivl
  const base = card.last_review ? new Date(card.last_review) : now
  const d = new Date(base)
  d.setDate(d.getDate() + ivl)
  return d
}

// rating: 1 Again · 2 Hard · 3 Good · 4 Easy
export function review(card: Card, rating: Grade, now = new Date()) {
  return inst().next(card, now, rating) // { card, log }
}

export function serialize(card: Card): string {
  return JSON.stringify(card)
}

// FSRS luu due/last_review la Date; JSON bien thanh chuoi nen phai doi lai
export function deserialize(s: string): Card {
  const c = JSON.parse(s) as Card
  c.due = new Date(c.due)
  if (c.last_review) c.last_review = new Date(c.last_review)
  return c
}
