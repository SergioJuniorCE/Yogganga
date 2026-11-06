import {
  followSeries,
  getSeries,
  getUserSeries,
  listChapters,
  listFollowers,
  listSeriesWithFollowers,
  preferredChapters,
  setUserDownloadMode,
  unfollowSeries,
  upsertChapters,
  upsertSeries,
} from './db.ts'
import { enqueueMany } from './downloader.ts'
import { getChapterList, getMangaInfo } from './mangadex.ts'
import type { DownloadMode, SeriesRow } from './types.ts'

export async function syncManga(id: string) {
  const [manga, chapters] = await Promise.all([getMangaInfo(id), getChapterList(id)])
  upsertSeries(manga)
  const added = upsertChapters(id, chapters)
  return { manga, chapters, added }
}

/** Make sure a series has metadata and a chapter list cached locally. */
export async function ensureManga(id: string): Promise<SeriesRow> {
  const existing = getSeries(id)
  if (!existing || listChapters(id).length === 0) await syncManga(id)
  const series = getSeries(id)
  if (!series) throw new Error(`Could not load series ${id}`)
  return series
}

function highestChapter(rows: { chapterNum: number | null }[]): number | null {
  const numbers = rows.map((r) => r.chapterNum).filter((n): n is number => n != null)
  return numbers.length > 0 ? Math.max(...numbers) : null
}

export async function followManga(
  userId: string,
  id: string,
  downloadMode: DownloadMode = 'new',
): Promise<{ series: SeriesRow; queued: number }> {
  const { chapters } = await syncManga(id)
  const series = getSeries(id)
  if (!series) throw new Error(`Could not load series ${id}`)

  const existing = getUserSeries(userId, id)
  // "new" means: from now on. Snapshot the current newest chapter so following
  // doesn't pull four hundred chapters of backlog.
  const baseline = downloadMode === 'all' ? 0 : existing?.baselineChapter ?? highestChapter(chapters)
  followSeries(userId, id, downloadMode, baseline)

  let queued = 0
  if (downloadMode === 'all') queued = queueBacklog(id)

  return { series, queued }
}

export function unfollowManga(userId: string, id: string): void {
  unfollowSeries(userId, id)
}

export function queueBacklog(mangaId: string): number {
  const chapters = preferredChapters(listChapters(mangaId))
  return enqueueMany(chapters.filter((c) => !c.external && c.status !== 'done').map((c) => c.id))
}

export async function refreshSeries(series: SeriesRow): Promise<{ added: number; queued: number }> {
  const followers = listFollowers(series.mangaId)
  const chapters = await getChapterList(series.mangaId)
  const added = upsertChapters(series.mangaId, chapters)

  if (followers.length === 0) return { added, queued: 0 }

  const preferred = preferredChapters(listChapters(series.mangaId))
  const wanted = new Set<string>()

  for (const follower of followers) {
    if (follower.downloadMode === 'all') {
      preferred.forEach((chapter) => wanted.add(chapter.id))
    } else if (follower.downloadMode === 'new' && follower.baselineChapter != null) {
      const baseline = follower.baselineChapter
      preferred
        .filter((chapter) => chapter.chapterNum != null && chapter.chapterNum >= baseline)
        .forEach((chapter) => wanted.add(chapter.id))
    }
  }

  const byId = new Map(preferred.map((chapter) => [chapter.id, chapter]))
  const targets = [...wanted].filter((id) => {
    const chapter = byId.get(id)
    return chapter && !chapter.external && chapter.status !== 'done' && chapter.status !== 'failed'
  })

  return { added, queued: enqueueMany(targets) }
}

export async function refreshAll(): Promise<{ series: number; added: number; queued: number }> {
  const followed = listSeriesWithFollowers()
  let added = 0
  let queued = 0
  for (const series of followed) {
    try {
      const result = await refreshSeries(series)
      added += result.added
      queued += result.queued
    } catch (error) {
      console.error(`[refresh] ${series.title}:`, error)
    }
  }
  return { series: followed.length, added, queued }
}

export { setUserDownloadMode }
