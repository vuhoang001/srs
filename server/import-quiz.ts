// Nhap the tu bo cau hoi JSON cua kho knowledge (quiz/<chu-de>/*.json):
//   npm run import:quiz -- bash "Bash"
//   npm run import:quiz -- data-modeling "Data modeling"
// Duong dan goc: bien moi truong KB_QUIZ_DIR, mac dinh ../knowledge/quiz
//
// Moi cau hoi thanh mot the:
//   guid  = kbg_<id cua cau hoi>   -> re-import GIU nguyen tien trinh FSRS
//   tags  = "quiz <topic> <level>"
//   source= truong .source cua file quiz (tro ve file goc trong docs/)
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { upsert } from './import-core.ts'

type Cau = { id: string; level: string; question: string; answer: string }
type FileQuiz = { topic: string; title?: string; source?: string; questions: Cau[] }

const here = dirname(fileURLToPath(import.meta.url))
const GOC = process.env.KB_QUIZ_DIR || join(here, '..', '..', 'knowledge', 'quiz')

const [chuDe, deckTuDongLenh] = process.argv.slice(2)
if (!chuDe) {
  console.error('Dung: npm run import:quiz -- <chu-de> [ten-deck]')
  console.error(`Cac chu de co trong ${GOC}:`)
  if (existsSync(GOC)) for (const d of readdirSync(GOC)) console.error(`  ${d}`)
  process.exit(1)
}

const THU_MUC = join(GOC, chuDe)
if (!existsSync(THU_MUC)) {
  console.error(`Khong thay thu muc quiz: ${THU_MUC}`)
  process.exit(1)
}
const deck = deckTuDongLenh || chuDe

// UI render bang dangerouslySetInnerHTML va KHONG hieu markdown. Nen phai:
// 1) escape & < > truoc — neu khong, `2>&1` hay `[[ $a < $b ]]` bi trinh duyet
//    nuot mat vi tuong la the HTML;
// 2) roi moi doi `code` -> <code> va **dam** -> <b>.
// Thu tu nay quan trong: escape truoc thi ky tu trong code cung duoc escape dung.
//
// Hai kieu code lam MOT luot regex: ``...`` (markdown boc doan co chua chinh dau
// backtick, vd "nen dung $(...) hay `` `...` ``?") phai duoc thu TRUOC `...`,
// khong thi luat mot-backtick an nham vao giua no.
const CODE = /``\s*(.+?)\s*``|`([^`]+)`/g

function sangHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(CODE, (_, doi: string | undefined, don: string | undefined) => `<code>${doi ?? don}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>')
}

const files = readdirSync(THU_MUC)
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .sort()
if (!files.length) {
  console.error(`Khong co file .json nao trong ${THU_MUC}`)
  process.exit(1)
}

let them = 0, sua = 0, giu = 0
for (const ten of files) {
  const j = JSON.parse(readFileSync(join(THU_MUC, ten), 'utf8')) as FileQuiz
  const topic = j.topic || ten.replace('.json', '')
  let t = 0, s = 0, g = 0
  for (const q of j.questions) {
    const { ket } = upsert({
      id: q.id,
      front: sangHtml(q.question),
      back: sangHtml(q.answer),
      tags: `quiz ${topic} ${q.level}`,
      deck,
      notetype: 'Basic',
      source: j.source || `quiz/${chuDe}/${ten}`,
    })
    if (ket === 'added') t++
    else if (ket === 'updated') s++
    else g++
  }
  console.log(`  ${ten.padEnd(32)} +${t} them, ${s} sua, ${g} giu nguyen`)
  them += t; sua += s; giu += g
}

console.log(`\nXong: ${them} the moi, ${sua} cap nhat, ${giu} khong doi (tong ${them + sua + giu}).`)
console.log(`Deck: "${deck}". Tien trinh on cua cac the cu KHONG bi dung toi.`)
