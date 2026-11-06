export type MangaSummary = {
  id: string
  title: string
  altTitles: string[]
  description: string
  coverUrl: string | null
  status: string | null
  year: number | null
  tags: string[]
  authors: string[]
  originalLanguage: string | null
  lastChapter: string | null
}

export type ChapterInfo = {
  id: string
  chapter: string | null
  chapterNum: number | null
  volume: string | null
  title: string | null
  language: string
  pages: number
  group: string | null
  external: boolean
  publishAt: string | null
}

export type ChapterStatus = 'idle' | 'queued' | 'downloading' | 'done' | 'failed'

export type DownloadMode = 'new' | 'all' | 'none'

export type ProgressRow = {
  chapterId: string
  mangaId: string
  page: number
  totalPages: number
  completed: boolean
  updatedAt: number
}

export type ChapterRow = ChapterInfo & {
  mangaId: string
  status: ChapterStatus
  error: string | null
  path: string | null
  updatedAt: number
}

export type SeriesRow = {
  mangaId: string
  title: string
  altTitles: string[]
  description: string
  coverUrl: string | null
  status: string | null
  year: number | null
  tags: string[]
  authors: string[]
  originalLanguage: string | null
  lastChapter: string | null
  updatedAt: number
}
