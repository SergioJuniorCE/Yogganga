import fs from 'node:fs'
import path from 'node:path'

const dataDir = path.resolve(process.env.DATA_DIR ?? './data')

export const config = {
  port: Number(process.env.PORT ?? 8787),
  dataDir,
  filesDir: path.join(dataDir, 'files'),
  dbPath: path.join(dataDir, 'manga.db'),
  /** When set, new accounts require this invite code. Ignored for the first account. */
  inviteCode: process.env.MANGA_INVITE_CODE?.trim() || null,
  pollHours: Number(process.env.POLL_HOURS ?? 6),
  languages: (process.env.LANGUAGES ?? 'en')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  quality: (process.env.QUALITY === 'data-saver' ? 'data-saver' : 'data') as 'data' | 'data-saver',
  downloadConcurrency: Math.max(1, Number(process.env.DOWNLOAD_CONCURRENCY ?? 2)),
}

fs.mkdirSync(config.filesDir, { recursive: true })
