import { db } from './db.ts'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'

// Sao luu file SQLite dinh ky — du lieu tien trinh hoc la thu quy nhat, khong duoc mat.
// Dung better-sqlite3 db.backup() (an toan khi DB dang mo, khac voi copy file tho).

const here = dirname(fileURLToPath(import.meta.url))
const DIR = join(here, '..', 'data', 'backups')
const KEEP = 10 // giu 10 ban gan nhat

export const NAME_RE = /^kb-[0-9A-Za-z_-]+\.db$/ // chan path traversal khi tai ve

export function backupsDir() {
  mkdirSync(DIR, { recursive: true })
  return DIR
}

export function backupPath(file: string) {
  return join(DIR, file)
}

export function listBackups(): { file: string; size: number; at: string }[] {
  const dir = backupsDir()
  return readdirSync(dir)
    .filter((f) => NAME_RE.test(f))
    .map((f) => {
      const s = statSync(join(dir, f))
      return { file: f, size: s.size, at: s.mtime.toISOString() }
    })
    .sort((a, b) => (a.at < b.at ? 1 : -1)) // moi nhat truoc
}

export async function makeBackup(stamp: string): Promise<string> {
  const dir = backupsDir()
  const name = `kb-${stamp.replace(/[^0-9A-Za-z_-]/g, '-')}.db`
  await (db as any).backup(join(dir, name))
  for (const f of listBackups().slice(KEEP)) {
    try { unlinkSync(join(dir, f.file)) } catch { /* bo qua */ }
  }
  return name
}

export function lastBackupAgeMs(): number | null {
  const files = listBackups()
  if (!files.length) return null
  return Date.now() - new Date(files[0].at).getTime()
}

// Tu dong sao luu khi khoi dong neu ban gan nhat da qua 24h (hoac chua co)
export async function autoBackup(stamp: string) {
  const age = lastBackupAgeMs()
  if (age === null || age > 24 * 3600 * 1000) {
    try { await makeBackup(stamp) } catch { /* khong chan khoi dong neu backup loi */ }
  }
}
