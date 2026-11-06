import { DatabaseSync } from 'node:sqlite'
import { config } from './config.ts'
import type {
  ChapterInfo,
  ChapterRow,
  ChapterStatus,
  DownloadMode,
  MangaSummary,
  ProgressRow,
  SeriesRow,
} from './types.ts'

const db = new DatabaseSync(config.dbPath)

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS series (
    manga_id          TEXT PRIMARY KEY,
    title             TEXT NOT NULL,
    alt_titles        TEXT NOT NULL DEFAULT '[]',
    description       TEXT NOT NULL DEFAULT '',
    cover_url         TEXT,
    status            TEXT,
    year              INTEGER,
    tags              TEXT NOT NULL DEFAULT '[]',
    authors           TEXT NOT NULL DEFAULT '[]',
    original_language TEXT,
    last_chapter      TEXT,
    followed          INTEGER NOT NULL DEFAULT 0,
    download_mode     TEXT NOT NULL DEFAULT 'new',
    baseline_chapter  REAL,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id);

  CREATE TABLE IF NOT EXISTS user_series (
    user_id          TEXT NOT NULL,
    manga_id         TEXT NOT NULL,
    download_mode    TEXT NOT NULL DEFAULT 'new',
    baseline_chapter REAL,
    created_at       INTEGER NOT NULL,
    PRIMARY KEY (user_id, manga_id)
  );

  CREATE TABLE IF NOT EXISTS read_progress (
    user_id     TEXT NOT NULL,
    chapter_id  TEXT NOT NULL,
    manga_id    TEXT NOT NULL,
    page        INTEGER NOT NULL DEFAULT 0,
    total_pages INTEGER NOT NULL DEFAULT 0,
    completed   INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, chapter_id)
  );

  CREATE INDEX IF NOT EXISTS read_progress_by_user ON read_progress (user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS chapters (
    id           TEXT PRIMARY KEY,
    manga_id     TEXT NOT NULL,
    chapter      TEXT,
    chapter_num  REAL,
    volume       TEXT,
    title        TEXT,
    language     TEXT NOT NULL DEFAULT 'en',
    pages        INTEGER NOT NULL DEFAULT 0,
    group_name   TEXT,
    external     INTEGER NOT NULL DEFAULT 0,
    publish_at   TEXT,
    status       TEXT NOT NULL DEFAULT 'idle',
    error        TEXT,
    path         TEXT,
    updated_at   INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS chapters_by_manga ON chapters (manga_id, chapter_num);
`)

/* ---------- row mapping ---------- */

type SeriesDbRow = {
  manga_id: string
  title: string
  alt_titles: string
  description: string
  cover_url: string | null
  status: string | null
  year: number | null
  tags: string
  authors: string
  original_language: string | null
  last_chapter: string | null
  updated_at: number
}

type ChapterDbRow = {
  id: string
  manga_id: string
  chapter: string | null
  chapter_num: number | null
  volume: string | null
  title: string | null
  language: string
  pages: number
  group_name: string | null
  external: number
  publish_at: string | null
  status: string
  error: string | null
  path: string | null
  updated_at: number
}

export type UserSeriesRow = {
  mangaId: string
  downloadMode: DownloadMode
  baselineChapter: number | null
  createdAt: number
}

const jsonArray = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function toSeries(row: SeriesDbRow): SeriesRow {
  return {
    mangaId: row.manga_id,
    title: row.title,
    altTitles: jsonArray(row.alt_titles),
    description: row.description,
    coverUrl: row.cover_url,
    status: row.status,
    year: row.year,
    tags: jsonArray(row.tags),
    authors: jsonArray(row.authors),
    originalLanguage: row.original_language,
    lastChapter: row.last_chapter,
    updatedAt: row.updated_at,
  }
}

function toChapter(row: ChapterDbRow): ChapterRow {
  return {
    id: row.id,
    mangaId: row.manga_id,
    chapter: row.chapter,
    chapterNum: row.chapter_num,
    volume: row.volume,
    title: row.title,
    language: row.language,
    pages: row.pages,
    group: row.group_name,
    external: row.external === 1,
    publishAt: row.publish_at,
    status: row.status as ChapterStatus,
    error: row.error,
    path: row.path,
    updatedAt: row.updated_at,
  }
}

/* ---------- series metadata ---------- */

export function upsertSeries(manga: MangaSummary): void {
  const now = Date.now()
  db.prepare(
    `INSERT INTO series (manga_id, title, alt_titles, description, cover_url, status, year,
                         tags, authors, original_language, last_chapter, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(manga_id) DO UPDATE SET
       title = excluded.title,
       alt_titles = excluded.alt_titles,
       description = excluded.description,
       cover_url = excluded.cover_url,
       status = excluded.status,
       year = excluded.year,
       tags = excluded.tags,
       authors = excluded.authors,
       original_language = excluded.original_language,
       last_chapter = excluded.last_chapter,
       updated_at = excluded.updated_at`,
  ).run(
    manga.id,
    manga.title,
    JSON.stringify(manga.altTitles),
    manga.description,
    manga.coverUrl,
    manga.status,
    manga.year,
    JSON.stringify(manga.tags),
    JSON.stringify(manga.authors),
    manga.originalLanguage,
    manga.lastChapter,
    now,
    now,
  )
}

export function getSeries(id: string): SeriesRow | null {
  const row = db.prepare('SELECT * FROM series WHERE manga_id = ?').get(id) as SeriesDbRow | undefined
  return row ? toSeries(row) : null
}

/** Every series at least one user follows. Drives the background refresh. */
export function listSeriesWithFollowers(): SeriesRow[] {
  const rows = db
    .prepare(
      'SELECT s.* FROM series s WHERE EXISTS (SELECT 1 FROM user_series us WHERE us.manga_id = s.manga_id) ORDER BY s.title COLLATE NOCASE',
    )
    .all() as SeriesDbRow[]
  return rows.map(toSeries)
}

/* ---------- per-user follows ---------- */

export function followSeries(
  userId: string,
  mangaId: string,
  mode: DownloadMode,
  baselineChapter: number | null,
): void {
  db.prepare(
    `INSERT INTO user_series (user_id, manga_id, download_mode, baseline_chapter, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, manga_id) DO UPDATE SET
       download_mode = excluded.download_mode,
       baseline_chapter = COALESCE(excluded.baseline_chapter, user_series.baseline_chapter)`,
  ).run(userId, mangaId, mode, baselineChapter, Date.now())
}

export function unfollowSeries(userId: string, mangaId: string): void {
  // Downloaded files stay on disk: re-following shouldn't re-download.
  db.prepare('DELETE FROM user_series WHERE user_id = ? AND manga_id = ?').run(userId, mangaId)
}

export function getUserSeries(userId: string, mangaId: string): UserSeriesRow | null {
  const row = db
    .prepare('SELECT * FROM user_series WHERE user_id = ? AND manga_id = ?')
    .get(userId, mangaId) as
    | { manga_id: string; download_mode: string; baseline_chapter: number | null; created_at: number }
    | undefined
  if (!row) return null
  return {
    mangaId: row.manga_id,
    downloadMode: row.download_mode as UserSeriesRow['downloadMode'],
    baselineChapter: row.baseline_chapter,
    createdAt: row.created_at,
  }
}

export function setUserDownloadMode(userId: string, mangaId: string, mode: DownloadMode): void {
  db.prepare('UPDATE user_series SET download_mode = ? WHERE user_id = ? AND manga_id = ?').run(mode, userId, mangaId)
}

export function listUserSeries(userId: string): SeriesRow[] {
  const rows = db
    .prepare(
      `SELECT s.* FROM series s
       JOIN user_series us ON us.manga_id = s.manga_id
       WHERE us.user_id = ?
       ORDER BY s.title COLLATE NOCASE`,
    )
    .all(userId) as SeriesDbRow[]
  return rows.map(toSeries)
}

export function listFollowers(mangaId: string): UserSeriesRow[] {
  const rows = db.prepare('SELECT * FROM user_series WHERE manga_id = ?').all(mangaId) as {
    manga_id: string
    download_mode: string
    baseline_chapter: number | null
    created_at: number
  }[]
  return rows.map((row) => ({
    mangaId: row.manga_id,
    downloadMode: row.download_mode as UserSeriesRow['downloadMode'],
    baselineChapter: row.baseline_chapter,
    createdAt: row.created_at,
  }))
}

/* ---------- chapters ---------- */

export function upsertChapters(mangaId: string, chapters: ChapterInfo[]): number {
  const now = Date.now()
  const statement = db.prepare(
    `INSERT INTO chapters (id, manga_id, chapter, chapter_num, volume, title, language, pages,
                           group_name, external, publish_at, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?)
     ON CONFLICT(id) DO UPDATE SET
       pages = excluded.pages,
       volume = excluded.volume,
       title = excluded.title,
       group_name = excluded.group_name,
       external = excluded.external,
       publish_at = excluded.publish_at`,
  )
  let added = 0
  const existing = new Set(
    (db.prepare('SELECT id FROM chapters WHERE manga_id = ?').all(mangaId) as { id: string }[]).map((r) => r.id),
  )

  for (const chapter of chapters) {
    if (!existing.has(chapter.id)) added++
    statement.run(
      chapter.id,
      mangaId,
      chapter.chapter,
      chapter.chapterNum,
      chapter.volume,
      chapter.title,
      chapter.language,
      chapter.pages,
      chapter.group,
      chapter.external ? 1 : 0,
      chapter.publishAt,
      now,
    )
  }
  return added
}

export function listChapters(mangaId: string): ChapterRow[] {
  const rows = db
    .prepare('SELECT * FROM chapters WHERE manga_id = ? ORDER BY chapter_num IS NULL, chapter_num, chapter')
    .all(mangaId) as ChapterDbRow[]
  return rows.map(toChapter)
}

export function getChapter(id: string): ChapterRow | null {
  const row = db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) as ChapterDbRow | undefined
  return row ? toChapter(row) : null
}

export function setChapterStatus(
  id: string,
  status: ChapterStatus,
  extra: { error?: string | null; path?: string | null } = {},
): void {
  db.prepare('UPDATE chapters SET status = ?, error = ?, path = COALESCE(?, path), updated_at = ? WHERE id = ?').run(
    status,
    extra.error ?? null,
    extra.path ?? null,
    Date.now(),
    id,
  )
}

/**
 * MangaDex lists the same chapter number once per scanlation group. The reader
 * only needs one: prefer real chapters over external links, then the one with
 * the most pages, then the most recent upload.
 */
export function preferredChapters(rows: ChapterRow[]): ChapterRow[] {
  const best = new Map<string, ChapterRow>()
  for (const row of rows) {
    const key = row.chapterNum != null ? `n:${row.chapterNum}` : `s:${row.chapter ?? row.id}`
    const current = best.get(key)
    if (!current || isBetter(row, current)) best.set(key, row)
  }
  return [...best.values()].sort((a, b) => {
    if (a.chapterNum == null && b.chapterNum == null) return (a.chapter ?? '').localeCompare(b.chapter ?? '')
    if (a.chapterNum == null) return 1
    if (b.chapterNum == null) return -1
    return a.chapterNum - b.chapterNum
  })
}

function isBetter(candidate: ChapterRow, current: ChapterRow): boolean {
  if (candidate.external !== current.external) return !candidate.external
  if (candidate.pages !== current.pages) return candidate.pages > current.pages
  return (candidate.publishAt ?? '') > (current.publishAt ?? '')
}

/* ---------- reading progress ---------- */

export function saveProgress(
  userId: string,
  chapterId: string,
  mangaId: string,
  page: number,
  totalPages: number,
  completed: boolean,
): void {
  db.prepare(
    `INSERT INTO read_progress (user_id, chapter_id, manga_id, page, total_pages, completed, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, chapter_id) DO UPDATE SET
       page = excluded.page,
       total_pages = excluded.total_pages,
       completed = MAX(read_progress.completed, excluded.completed),
       updated_at = excluded.updated_at`,
  ).run(userId, chapterId, mangaId, page, totalPages, completed ? 1 : 0, Date.now())
}

export function getProgress(userId: string, chapterId: string): ProgressRow | null {
  const row = db
    .prepare('SELECT * FROM read_progress WHERE user_id = ? AND chapter_id = ?')
    .get(userId, chapterId) as
    | { chapter_id: string; manga_id: string; page: number; total_pages: number; completed: number; updated_at: number }
    | undefined
  if (!row) return null
  return {
    chapterId: row.chapter_id,
    mangaId: row.manga_id,
    page: row.page,
    totalPages: row.total_pages,
    completed: row.completed === 1,
    updatedAt: row.updated_at,
  }
}

export function progressForSeries(userId: string, mangaId: string): ProgressRow[] {
  const rows = db
    .prepare('SELECT * FROM read_progress WHERE user_id = ? AND manga_id = ?')
    .all(userId, mangaId) as {
    chapter_id: string
    manga_id: string
    page: number
    total_pages: number
    completed: number
    updated_at: number
  }[]
  return rows.map((row) => ({
    chapterId: row.chapter_id,
    mangaId: row.manga_id,
    page: row.page,
    totalPages: row.total_pages,
    completed: row.completed === 1,
    updatedAt: row.updated_at,
  }))
}

export function recentProgress(
  userId: string,
  limit: number,
): { progress: ProgressRow; chapter: ChapterRow }[] {
  const rows = db
    .prepare(
      `SELECT rp.* FROM read_progress rp
       WHERE rp.user_id = ?
       ORDER BY rp.updated_at DESC
       LIMIT ?`,
    )
    .all(userId, limit) as {
    chapter_id: string
    manga_id: string
    page: number
    total_pages: number
    completed: number
    updated_at: number
  }[]

  const result: { progress: ProgressRow; chapter: ChapterRow }[] = []
  for (const row of rows) {
    const chapter = getChapter(row.chapter_id)
    if (!chapter) continue
    result.push({
      progress: {
        chapterId: row.chapter_id,
        mangaId: row.manga_id,
        page: row.page,
        totalPages: row.total_pages,
        completed: row.completed === 1,
        updatedAt: row.updated_at,
      },
      chapter,
    })
  }
  return result
}

/* ---------- one-off migration from the single-user schema ---------- */

export function migrateLegacyFollows(): void {
  const already = db.prepare('SELECT COUNT(*) AS count FROM user_series').get() as { count: number }
  if (already.count > 0) return

  const owner = db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get() as { id: string } | undefined
  if (!owner) return

  const legacy = db
    .prepare('SELECT manga_id, download_mode, baseline_chapter FROM series WHERE followed = 1')
    .all() as { manga_id: string; download_mode: string; baseline_chapter: number | null }[]

  for (const row of legacy) {
    followSeries(
      owner.id,
      row.manga_id,
      (row.download_mode as DownloadMode) ?? 'new',
      row.baseline_chapter,
    )
  }
}

export function stats(userId: string) {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM user_series WHERE user_id = ?) AS series,
         (SELECT COUNT(*) FROM chapters c JOIN user_series us ON us.manga_id = c.manga_id
            WHERE us.user_id = ?) AS chapters,
         (SELECT COUNT(*) FROM chapters c JOIN user_series us ON us.manga_id = c.manga_id
            WHERE us.user_id = ? AND c.status = 'done') AS downloaded,
         (SELECT COUNT(*) FROM chapters c JOIN user_series us ON us.manga_id = c.manga_id
            WHERE us.user_id = ? AND c.status IN ('queued', 'downloading')) AS queued,
         (SELECT COUNT(*) FROM chapters c JOIN user_series us ON us.manga_id = c.manga_id
            WHERE us.user_id = ? AND c.status = 'failed') AS failed`,
    )
    .get(userId, userId, userId, userId, userId) as {
    series: number
    chapters: number
    downloaded: number
    queued: number
    failed: number
  }
  return row
}

export { db }
