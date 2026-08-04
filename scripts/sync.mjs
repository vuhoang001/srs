#!/usr/bin/env node
// Dong bo tay qua git. Hai lenh duy nhat can nho:
//   npm run pull   -> TRUOC khi mo app
//   npm run push   -> SAU khi on xong
//
// Vi sao can script: kb.db chay che do WAL, du lieu moi nam trong kb.db-wal
// (bi gitignore). Commit ma quen checkpoint = day len mot file DB THIEU du lieu.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' }).trim()
const shLive = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })
const DB = 'data/kb.db'

function checkpoint() {
  const require = createRequire(import.meta.url)
  const d = require('better-sqlite3')(DB)
  d.pragma('wal_checkpoint(TRUNCATE)')
  const n = (s) => d.prepare(s).get().n
  const info = `${n('select count(*) n from card')} the · ${n('select count(*) n from review_log')} luot on`
  d.close()
  return info
}

const lenh = process.argv[2]

if (lenh === 'pull') {
  // --ff-only: khong tu dong merge. Phan ky thi DUNG lai de nguoi tu xu ly,
  // vi kb.db la nhi phan — git merge se hong hoac mat du lieu mot ben.
  shLive('git', ['pull', '--ff-only'])
  console.log(`\nOK. ${checkpoint()}`)
} else if (lenh === 'push') {
  const info = checkpoint()
  sh('git', ['add', DB])
  const doi = sh('git', ['status', '--porcelain', DB])
  if (!doi) {
    console.log(`Khong co gi moi (${info}).`)
    process.exit(0)
  }
  const ngay = new Date().toISOString().slice(0, 10)
  sh('git', ['commit', '-m', `chore(data): on tap ${ngay} — ${info}`])
  shLive('git', ['push'])
  console.log(`\nDa day: ${info}`)
} else {
  console.log('Dung: npm run pull  |  npm run push')
  process.exit(1)
}
