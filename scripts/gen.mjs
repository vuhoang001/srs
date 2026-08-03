#!/usr/bin/env node
// Sinh the hoc tu mot URL (vd trang knowledge cua ban) roi import vao SRS.
// Server tu doc cac cau hoi DA CO trong deck de KHONG sinh trung; import lai bo trung mat truoc.
//
// Dung:  node scripts/gen.mjs <url> [deck] [count]
//        SRS_API=http://localhost:3001   (mac dinh)  · can bat server + co ANTHROPIC_API_KEY
//
// Vi du: node scripts/gen.mjs https://vuhoang001.github.io/knowledge/ "Knowledge" 20

const [url, deck = 'Knowledge', countArg] = process.argv.slice(2)
const API = process.env.SRS_API || 'http://localhost:3001'
const count = Number(countArg) || 20

if (!url) {
  console.error('Thiếu URL.\nDùng: node scripts/gen.mjs <url> [deck] [count]')
  process.exit(1)
}

const htmlToText = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()

async function main() {
  console.log(`Tải ${url} …`)
  const page = await fetch(url)
  if (!page.ok) throw new Error(`tải trang lỗi: HTTP ${page.status}`)
  const text = htmlToText(await page.text()).slice(0, 40000)
  if (text.length < 50) throw new Error('không trích được nội dung từ trang.')

  console.log(`Sinh thẻ (deck "${deck}", tối đa ${count}, tự bỏ câu đã có)…`)
  const gen = await fetch(`${API}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, deck, count }),
  })
  const genJson = await gen.json().catch(() => ({}))
  if (!gen.ok) throw new Error(genJson.error || 'sinh thẻ thất bại')
  const cards = genJson.cards || []
  console.log(`→ Nhận ${cards.length} thẻ mới.`)
  if (!cards.length) { console.log('Không có thẻ mới (kho có thể đã đủ ý).'); return }

  const imp = await fetch(`${API}/api/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rows: cards, deck }),
  })
  const impJson = await imp.json().catch(() => ({}))
  if (!imp.ok) throw new Error(impJson.error || 'import thất bại')
  console.log(
    `Xong: +${impJson.them} mới, ${impJson.sua} cập nhật, ${impJson.giu} giữ nguyên` +
      (impJson.trung?.length ? `, ${impJson.trung.length} trùng mặt trước (đã bỏ qua)` : ''),
  )
}

main().catch((e) => { console.error('Lỗi:', e.message); process.exit(1) })
