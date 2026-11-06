import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.ts'
import { db, getChapter, setChapterStatus } from './db.ts'
import { getAtHome, pageUrls, USER_AGENT } from './mangadex.ts'

export function chapterDir(mangaId: string, chapterId: string): string {
  return path.join(config.filesDir, mangaId, chapterId)
}

type Meta = {
  mangaId: string
  chapterId: string
  chapter: string | null
  volume: string | null
  title: string | null
  group: string | null
  pages: string[]
}

export function readMeta(mangaId: string, chapterId: string): Meta | null {
  const file = path.join(chapterDir(mangaId, chapterId), 'meta.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Meta
  } catch {
    return null
  }
}

/* ---------------- queue ---------------- */

const pending: string[] = []
let active = 0
const inFlight = new Set<string>()

export function enqueueChapter(id: string): boolean {
  const chapter = getChapter(id)
  if (!chapter || chapter.external) return false
  if (chapter.status === 'done' || chapter.status === 'queued' || chapter.status === 'downloading') return false
  if (inFlight.has(id)) return false

  setChapterStatus(id, 'queued')
  pending.push(id)
  inFlight.add(id)
  pump()
  return true
}

export function enqueueMany(ids: string[]): number {
  let count = 0
  for (const id of ids) if (enqueueChapter(id)) count++
  return count
}

/** Anything left mid-download by a restart goes back in the queue on demand. */
export function resetStaleDownloads(): void {
  db.prepare("UPDATE chapters SET status = 'idle' WHERE status IN ('queued', 'downloading')").run()
}

function pump(): void {
  while (active < config.downloadConcurrency && pending.length > 0) {
    const id = pending.shift()!
    active++
    downloadChapter(id)
      .catch((error: unknown) => {
        setChapterStatus(id, 'failed', { error: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => {
        inFlight.delete(id)
        active--
        pump()
      })
  }
}

/* ---------------- downloading ---------------- */

async function downloadChapter(chapterId: string): Promise<void> {
  const chapter = getChapter(chapterId)
  if (!chapter) return
  if (chapter.external) {
    setChapterStatus(chapterId, 'idle')
    return
  }

  setChapterStatus(chapterId, 'downloading')
  const atHome = await getAtHome(chapterId)
  const urls = pageUrls(atHome, config.quality)
  if (urls.length === 0) throw new Error('MangaDex returned no pages')

  const dir = chapterDir(chapter.mangaId, chapterId)
  await fs.promises.mkdir(dir, { recursive: true })

  const names = urls.map((url, index) => {
    const ext = path.extname(new URL(url).pathname) || '.jpg'
    return `${String(index + 1).padStart(3, '0')}${ext}`
  })

  await mapLimit(urls, 4, async (url, index) => {
    const dest = path.join(dir, names[index])
    if (isNonEmptyFile(dest)) return
    await downloadFile(url, dest)
  })

  const meta: Meta = {
    mangaId: chapter.mangaId,
    chapterId,
    chapter: chapter.chapter,
    volume: chapter.volume,
    title: chapter.title,
    group: chapter.group,
    pages: names,
  }
  await fs.promises.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2))

  setChapterStatus(chapterId, 'done', { path: path.join(chapter.mangaId, chapterId), error: null })
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function downloadFile(url: string, dest: string, attempt = 1): Promise<void> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) throw new Error(`HTTP ${res.status} for page`)
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.byteLength === 0) throw new Error('empty page')
    await fs.promises.writeFile(dest, buffer)
  } catch (error) {
    if (attempt >= 3) throw error
    await sleep(700 * attempt)
    return downloadFile(url, dest, attempt + 1)
  }
}

function isNonEmptyFile(file: string): boolean {
  try {
    return fs.statSync(file).size > 0
  } catch {
    return false
  }
}

async function mapLimit<T>(items: T[], limit: number, work: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      await work(items[index], index)
    }
  })
  await Promise.all(workers)
}
