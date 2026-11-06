import { config } from './config.ts'
import type { ChapterInfo, MangaSummary } from './types.ts'

const BASE = 'https://api.mangadex.org'
const USER_AGENT = 'manga-server/0.1 (self-hosted manga library)'
const MIN_INTERVAL_MS = 260 // ~4 requests/second, under MangaDex's 5/s limit

// MangaDex asks for a User-Agent and modest rate limits. Starting requests at
// least MIN_INTERVAL_MS apart keeps us inside that without a token bucket.
let lastStart = 0
let gateChain: Promise<void> = Promise.resolve()
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function gate(): Promise<void> {
  gateChain = gateChain.then(async () => {
    const wait = lastStart + MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastStart = Date.now()
  })
  return gateChain
}

type Params = Record<string, string | number | string[] | undefined>

async function api<T>(path: string, params: Params = {}): Promise<T> {
  const url = new URL(BASE + path)
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v))
    else url.searchParams.set(key, String(value))
  }

  await gate()
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`MangaDex ${res.status} ${res.statusText} on ${url.pathname}`)
  }
  return (await res.json()) as T
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type RawEntity = any

function englishTitle(attributes: RawEntity): string {
  const titles = attributes?.title ?? {}
  return (
    titles.en ??
    titles['ja-ro'] ??
    titles.ja ??
    (Object.values(titles)[0] as string | undefined) ??
    'Untitled'
  )
}

function relationship(data: RawEntity, type: string): RawEntity | undefined {
  return data?.relationships?.find((r: RawEntity) => r.type === type)
}

export function toSummary(data: RawEntity): MangaSummary {
  const attrs = data.attributes ?? {}
  const cover = relationship(data, 'cover_art')
  const fileName = cover?.attributes?.fileName

  const tags: string[] = (attrs.tags ?? [])
    .map((t: RawEntity) => t.attributes?.name?.en)
    .filter(Boolean)

  const authors: string[] = (data.relationships ?? [])
    .filter((r: RawEntity) => r.type === 'author' || r.type === 'artist')
    .map((r: RawEntity) => r.attributes?.name)
    .filter(Boolean)

  return {
    id: data.id,
    title: englishTitle(attrs),
    altTitles: (attrs.altTitles ?? [])
      .map((t: RawEntity) => Object.values(t)[0] as string)
      .filter(Boolean)
      .slice(0, 8),
    description: attrs.description?.en ?? attrs.description?.[config.languages[0]] ?? '',
    coverUrl: fileName ? `https://uploads.mangadex.org/covers/${data.id}/${fileName}.512.jpg` : null,
    status: attrs.status ?? null,
    year: attrs.year ?? null,
    tags,
    authors: [...new Set(authors)],
    originalLanguage: attrs.originalLanguage ?? null,
    lastChapter: attrs.lastChapter ?? null,
  }
}

export async function searchManga(title: string, limit: number, offset: number) {
  const json = await api<{ data: RawEntity[]; total: number }>('/manga', {
    title,
    limit,
    offset,
    'order[relevance]': 'desc',
    'contentRating[]': ['safe', 'suggestive', 'erotica'],
    'availableTranslatedLanguage[]': config.languages,
    'hasAvailableChapters': 'true',
    'includes[]': ['cover_art', 'author', 'artist'],
  })
  return { items: json.data.map(toSummary), total: json.total }
}

export async function getMangaInfo(id: string): Promise<MangaSummary> {
  const json = await api<{ data: RawEntity }>(`/manga/${id}`, {
    'includes[]': ['cover_art', 'author', 'artist'],
  })
  return toSummary(json.data)
}

export async function getChapterList(mangaId: string): Promise<ChapterInfo[]> {
  const chapters: ChapterInfo[] = []
  let offset = 0

  // Feed pages are capped at 500; a manga with more than 10k chapters is not a
  // thing we need to support.
  for (let page = 0; page < 20; page++) {
    const json = await api<{ data: RawEntity[]; total: number }>(`/manga/${mangaId}/feed`, {
      limit: 500,
      offset,
      'translatedLanguage[]': config.languages,
      'order[volume]': 'asc',
      'order[chapter]': 'asc',
      'contentRating[]': ['safe', 'suggestive', 'erotica'],
      'includes[]': 'scanlation_group',
    })

    for (const data of json.data) {
      const attrs = data.attributes ?? {}
      const group = relationship(data, 'scanlation_group')?.attributes?.name ?? null
      const raw = attrs.chapter as string | null
      const num = raw == null || raw === '' ? null : Number(raw)

      chapters.push({
        id: data.id,
        chapter: raw,
        chapterNum: num != null && Number.isFinite(num) ? num : null,
        volume: attrs.volume ?? null,
        title: attrs.title ?? null,
        language: attrs.translatedLanguage ?? 'en',
        pages: attrs.pages ?? 0,
        group,
        external: Boolean(attrs.externalUrl),
        publishAt: attrs.publishAt ?? null,
      })
    }

    offset += json.data.length
    if (json.data.length === 0 || offset >= json.total) break
  }

  return chapters
}

export type AtHome = {
  baseUrl: string
  chapter: { hash: string; data: string[]; dataSaver: string[] }
}

export function getAtHome(chapterId: string): Promise<AtHome> {
  return api<AtHome>(`/at-home/server/${chapterId}`)
}

export function pageUrls(atHome: AtHome, quality: 'data' | 'data-saver'): string[] {
  const files = quality === 'data' ? atHome.chapter.data : atHome.chapter.dataSaver
  const segment = quality === 'data' ? 'data' : 'data-saver'
  return files.map((file) => `${atHome.baseUrl}/${segment}/${atHome.chapter.hash}/${file}`)
}

export { USER_AGENT }
