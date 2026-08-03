// Nhap the tu kho knowledge (cac file anki/*.tsv) qua dong lenh:  npm run import
// Duong dan kho: bien moi truong KB_DIR, mac dinh ../knowledge/anki
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { upsert, type RawCard } from './import-core.ts'

const here = dirname(fileURLToPath(import.meta.url))
const KB = process.env.KB_DIR || join(here, '..', '..', 'knowledge', 'anki')

if (!existsSync(KB)) {
  console.error(`Khong thay thu muc kho: ${KB}`)
  console.error('Dat KB_DIR tro toi thu muc chua cac file .tsv, vd:')
  console.error('  KB_DIR=/duong/dan/knowledge/anki npm run import')
  process.exit(1)
}

const files = readdirSync(KB).filter((f) => f.endsWith('.tsv') && f !== '_pending.tsv').sort()
if (!files.length) {
  console.error(`Khong co file .tsv nao trong ${KB}`)
  process.exit(1)
}

let them = 0, sua = 0, giu = 0
for (const ten of files) {
  const meta: Record<string, string> = {}
  const raw: RawCard[] = []
  for (const d of readFileSync(join(KB, ten), 'utf8').split('\n')) {
    if (!d.trim()) continue
    if (d.startsWith('#')) {
      const [k, ...r] = d.slice(1).split(':')
      meta[k.trim()] = r.join(':').trim()
      continue
    }
    const cot = d.split('\t')
    raw.push({ front: cot[0] || '', back: cot[1] || '', tags: cot[2] || '' })
  }
  const deck = meta.deck || ten.replace('.tsv', '')
  const notetype = meta.notetype || 'Basic'
  let t = 0, s = 0, g = 0
  for (const r of raw) {
    const { ket } = upsert({ ...r, deck, notetype, source: `${relative(join(here, '..'), KB)}/${ten}` })
    if (ket === 'added') t++
    else if (ket === 'updated') s++
    else g++
  }
  console.log(`  ${ten.padEnd(28)} +${t} them, ${s} sua, ${g} giu nguyen`)
  them += t; sua += s; giu += g
}

console.log(`\nXong: ${them} the moi, ${sua} cap nhat, ${giu} khong doi (tong ${them + sua + giu}).`)
console.log('Tien trinh on cua cac the cu KHONG bi dung toi.')
