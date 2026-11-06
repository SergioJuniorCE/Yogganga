import { Directory, File, Paths } from 'expo-file-system'
import * as SQLite from 'expo-sqlite'
import { useSyncExternalStore } from 'react'
import { authHeaders, needsAuth } from './api'

export type OfflineProgress = {
  done: number
  total: number
  state: 'running' | 'done' | 'error'
  error?: string
}

const running = new Map<string, OfflineProgress>()
const listeners = new Set<() => void>()
let version = 0

function emit(): void {
  version++
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useOfflineProgress(chapterId: string): OfflineProgress | undefined {
  useSyncExternalStore(subscribe, () => version)
  return running.get(chapterId)
}

let database: Promise<SQLite.SQLiteDatabase> | null = null

function getDb(): Promise<SQLite.SQLiteDatabase> {
  database ??= SQLite.openDatabaseAsync('offline.db').then(async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS downloads (
        chapter_id TEXT PRIMARY KEY,
        manga_id   TEXT NOT NULL,
        pages      TEXT NOT NULL,
        bytes      INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `)
    return db
  })
  return database
}

function chapterDirectory(chapterId: string): Directory {
  return new Directory(Paths.document, 'chapters', chapterId)
}

function extensionOf(url: string): string {
  const match = url.split('?')[0].match(/\.(jpe?g|png|webp|gif)$/i)
  return match ? `.${match[1].toLowerCase()}` : '.jpg'
}

export async function getLocalPages(chapterId: string): Promise<string[] | null> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ pages: string }>(
    'SELECT pages FROM downloads WHERE chapter_id = ?',
    chapterId,
  )
  if (!row) return null

  const directory = chapterDirectory(chapterId)
  if (!directory.exists) {
    await db.runAsync('DELETE FROM downloads WHERE chapter_id = ?', chapterId)
    return null
  }

  const pages = JSON.parse(row.pages) as string[]
  const first = new File(pages[0])
  if (!first.exists) {
    await db.runAsync('DELETE FROM downloads WHERE chapter_id = ?', chapterId)
    return null
  }
  return pages
}

export async function saveChapter(chapterId: string, mangaId: string, pageUrls: string[]): Promise<void> {
  if (running.get(chapterId)?.state === 'running') return
  const total = pageUrls.length
  running.set(chapterId, { done: 0, total, state: 'running' })
  emit()

  try {
    const directory = chapterDirectory(chapterId)
    directory.create({ intermediates: true, idempotent: true })

    const uris: string[] = new Array(total)
    let bytes = 0
    let done = 0
    let cursor = 0

    const worker = async () => {
      while (cursor < total) {
        const index = cursor++
        const url = pageUrls[index]
        const file = new File(directory, `${String(index + 1).padStart(3, '0')}${extensionOf(url)}`)
        await File.downloadFileAsync(url, file, {
          headers: needsAuth(url) ? authHeaders() : undefined,
          idempotent: true,
        })
        uris[index] = file.uri
        bytes += file.size
        done++
        running.set(chapterId, { done, total, state: 'running' })
        emit()
      }
    }

    await Promise.all(Array.from({ length: Math.min(3, total) }, worker))

    const db = await getDb()
    await db.runAsync(
      `INSERT INTO downloads (chapter_id, manga_id, pages, bytes, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(chapter_id) DO UPDATE SET
         pages = excluded.pages, bytes = excluded.bytes, created_at = excluded.created_at`,
      chapterId,
      mangaId,
      JSON.stringify(uris),
      bytes,
      Date.now(),
    )

    running.set(chapterId, { done: total, total, state: 'done' })
    emit()
  } catch (error) {
    running.set(chapterId, {
      done: 0,
      total,
      state: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
    emit()
  }
}

export async function removeChapter(chapterId: string): Promise<void> {
  const directory = chapterDirectory(chapterId)
  if (directory.exists) directory.delete()
  const db = await getDb()
  await db.runAsync('DELETE FROM downloads WHERE chapter_id = ?', chapterId)
  running.delete(chapterId)
  emit()
}

export async function offlineStats(): Promise<{ chapters: number; bytes: number }> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ chapters: number; bytes: number }>(
    'SELECT COUNT(*) AS chapters, COALESCE(SUM(bytes), 0) AS bytes FROM downloads',
  )
  return row ?? { chapters: 0, bytes: 0 }
}

export async function clearOffline(): Promise<void> {
  const root = new Directory(Paths.document, 'chapters')
  if (root.exists) root.delete()
  const db = await getDb()
  await db.runAsync('DELETE FROM downloads')
  running.clear()
  emit()
}
