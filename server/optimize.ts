import { db } from './db.ts'
import { FSRS, FSRSItem, FSRSReview, DEFAULT_PARAMETERS } from 'fsrs-rs-nodejs'

// Ca nhan hoa 19 tham so FSRS tu chinh lich su on cua ban (bang review_log).
// Dung fsrs-rs (cung engine Rust ma Anki dung) — cung phien ban FSRS-4.5, 19 tham so,
// nen ket qua cam vao ts-fsrs qua setting `w` la dung nghia.
//
// Moi the -> mot FSRSItem gom day cac lan cham (rating + so ngay cach lan truoc).
// Chi the co >=2 lan cham moi co tin hieu khoang cach de hoc.

export type OptimizeResult = {
  ok: boolean
  message?: string
  w?: number[]
  reviews: number      // tong luot on dung de train
  cards: number        // so the co du lich su
  lossBefore?: number  // log-loss truoc (tham so mac dinh)
  lossAfter?: number   // log-loss sau (tham so toi uu) — thap hon = tot hon
}

// Duoi nguong nay thi ket qua khong dang tin — bao nguoi dung on them.
const MIN_REVIEWS = 32

export async function optimizeParams(): Promise<OptimizeResult> {
  const logs = db
    .prepare('SELECT guid, rating, reviewed FROM review_log ORDER BY guid, reviewed ASC')
    .all() as { guid: string; rating: number; reviewed: string }[]

  const byGuid = new Map<string, { rating: number; reviewed: string }[]>()
  for (const l of logs) {
    const arr = byGuid.get(l.guid)
    if (arr) arr.push(l)
    else byGuid.set(l.guid, [l])
  }

  const items: FSRSItem[] = []
  let reviews = 0
  for (const revs of byGuid.values()) {
    if (revs.length < 2) continue // 1 lan cham -> khong co khoang cach de hoc
    const frs: FSRSReview[] = []
    let prev: number | null = null
    for (const r of revs) {
      const t = new Date(r.reviewed).getTime()
      const deltaDays = prev === null ? 0 : Math.max(0, Math.round((t - prev) / 86_400_000))
      frs.push(new FSRSReview(r.rating, deltaDays))
      prev = t
    }
    items.push(new FSRSItem(frs))
    reviews += frs.length
  }

  if (reviews < MIN_REVIEWS) {
    return {
      ok: false,
      reviews,
      cards: items.length,
      message: `Mới có ${reviews} lượt ôn có ích để tối ưu (cần ≥ ${MIN_REVIEWS}, lý tưởng vài trăm+). Cứ ôn thêm rồi tối ưu sau.`,
    }
  }

  const evalLoss = (params: number[] | number[]) => {
    try { return new FSRS(params as number[]).evaluate(items).logLoss } catch { return undefined }
  }
  const lossBefore = evalLoss(DEFAULT_PARAMETERS as unknown as number[])

  const w = await new FSRS().computeParameters(items, true)
  if (!Array.isArray(w) || w.length !== 19 || !w.every((x) => Number.isFinite(x))) {
    return { ok: false, reviews, cards: items.length, message: 'Optimizer trả về tham số không hợp lệ.' }
  }
  const lossAfter = evalLoss(w)

  return { ok: true, w, reviews, cards: items.length, lossBefore, lossAfter }
}
