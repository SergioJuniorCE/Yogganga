import type { ImageSource } from 'expo-image'

export type DownloadMode = 'new' | 'all' | 'none'

export type User = {
  id: string
  username: string
  createdAt: number
}

export type AuthResult = {
  token: string
  user: User
}

export type Manga = {
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

export type ChapterStatus = 'idle' | 'queued' | 'downloading' | 'done' | 'failed'

export type ChapterProgress = {
  page: number
  totalPages: number
  completed: boolean
  updatedAt: number
}

export type Chapter = {
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
  status: ChapterStatus
  error: string | null
  downloaded: boolean
  progress?: ChapterProgress | null
}

export type MangaDetails = {
  manga: Manga
  followed: boolean
  downloadMode: DownloadMode
  chapters: Chapter[]
}

export type ContinueReading = {
  chapter: Chapter
  page: number
  totalPages: number
  completed: boolean
  updatedAt: number
}

export type LibraryItem = Manga & {
  downloadMode: DownloadMode
  chapterCount: number
  downloadedCount: number
  readCount: number
  latestChapter: Chapter | null
  nextChapter: Chapter | null
  continueReading: ContinueReading | null
  updatedAt: number
}

export type HistoryItem = {
  manga: Manga
  chapter: Chapter
  page: number
  totalPages: number
  completed: boolean
  updatedAt: number
}

export type Stats = {
  series: number
  chapters: number
  downloaded: number
  queued: number
  failed: number
}

export type ChapterPayload = {
  chapter: Chapter
  manga: Manga | null
  pages: string[]
  progress: ChapterProgress | null
  prev: string | null
  next: string | null
}

let baseUrl = ''
let sessionToken = ''
let onUnauthorized: (() => void) | null = null

export function configure(serverUrl: string, token: string): void {
  baseUrl = serverUrl.trim().replace(/\/+$/, '')
  sessionToken = token.trim()
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler
}

export function isConfigured(): boolean {
  return baseUrl.length > 0
}

export function getBaseUrl(): string {
  return baseUrl
}

export function authHeaders(): Record<string, string> {
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}
}

/** Our own files are relative paths; MangaDex pages are absolute CDN URLs. */
export function imageSource(uri: string | null | undefined): ImageSource | undefined {
  if (!uri) return undefined
  if (uri.startsWith('file://')) return { uri }
  if (/^https?:\/\//i.test(uri)) return { uri }
  return { uri: `${baseUrl}${uri}`, headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : undefined }
}

export function needsAuth(uri: string): boolean {
  return !/^https?:\/\//i.test(uri) && !uri.startsWith('file://')
}

type RequestOptions = { method?: string; body?: unknown; skipAuthHandler?: boolean }

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!baseUrl) throw new Error('Server URL is not set')

  const headers: Record<string, string> = { Accept: 'application/json', ...authHeaders() }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  if (response.status === 401 && sessionToken && !options.skipAuthHandler) {
    onUnauthorized?.()
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let message = `HTTP ${response.status}`
    try {
      const parsed = JSON.parse(text) as { error?: string }
      if (parsed.error) message = parsed.error
    } catch {
      if (text) message = text.slice(0, 200)
    }
    throw new Error(message)
  }

  return (await response.json()) as T
}

/* ---------------- auth ---------------- */

export function login(username: string, password: string): Promise<AuthResult> {
  return request('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    skipAuthHandler: true,
  })
}

export function register(username: string, password: string, invite: string): Promise<AuthResult> {
  return request('/api/auth/register', {
    method: 'POST',
    body: { username, password, invite },
    skipAuthHandler: true,
  })
}

export function logout(): Promise<{ ok: boolean }> {
  return request('/api/auth/logout', { method: 'POST', skipAuthHandler: true })
}

export function me(): Promise<{ user: User }> {
  return request('/api/auth/me', { skipAuthHandler: true })
}

/* ---------------- catalogue ---------------- */

export function health(): Promise<{ ok: boolean; version: string }> {
  return request('/api/health', { skipAuthHandler: true })
}

export function search(query: string, offset = 0): Promise<{ items: Manga[]; total: number }> {
  return request(`/api/search?q=${encodeURIComponent(query)}&limit=30&offset=${offset}`)
}

export function getManga(id: string, refresh = false): Promise<MangaDetails> {
  return request(`/api/manga/${id}${refresh ? '?refresh=1' : ''}`)
}

/* ---------------- library ---------------- */

export function getLibrary(): Promise<{ items: LibraryItem[]; stats: Stats }> {
  return request('/api/library')
}

export function getHistory(limit = 20): Promise<{ items: HistoryItem[] }> {
  return request(`/api/history?limit=${limit}`)
}

export function follow(id: string, downloadMode: DownloadMode): Promise<{ queued: number }> {
  return request(`/api/library/${id}`, { method: 'PUT', body: { downloadMode } })
}

export function unfollow(id: string): Promise<{ ok: boolean }> {
  return request(`/api/library/${id}`, { method: 'DELETE' })
}

export function setDownloadMode(id: string, downloadMode: DownloadMode): Promise<{ ok: boolean; queued: number }> {
  return request(`/api/library/${id}/mode`, { method: 'POST', body: { downloadMode } })
}

/* ---------------- reading ---------------- */

export function getChapter(id: string): Promise<ChapterPayload> {
  return request(`/api/chapters/${id}`)
}

export function saveProgress(
  chapterId: string,
  page: number,
  totalPages: number,
  completed: boolean,
): Promise<{ ok: boolean }> {
  return request(`/api/chapters/${chapterId}/progress`, {
    method: 'PUT',
    body: { page, totalPages, completed },
  })
}

/* ---------------- downloads ---------------- */

export function downloadChapter(id: string): Promise<{ ok: boolean; queued: boolean }> {
  return request(`/api/chapters/${id}/download`, { method: 'POST' })
}

export function refreshLibrary(): Promise<{ ok: boolean; series: number; added: number; queued: number }> {
  return request('/api/refresh', { method: 'POST' })
}

export function getStats(): Promise<Stats> {
  return request('/api/stats')
}
