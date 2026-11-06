import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import {
  burnPasswordCheck,
  clearLoginFailures,
  createSession,
  createUser,
  findUserByUsername,
  loginAllowed,
  purgeExpiredSessions,
  recordLoginFailure,
  revokeSession,
  safeEqual,
  userCount,
  userForToken,
  verifyPassword,
  type User,
} from './auth.ts'
import { config } from './config.ts'
import {
  getChapter,
  getProgress,
  getSeries,
  getUserSeries,
  listChapters,
  listUserSeries,
  migrateLegacyFollows,
  preferredChapters,
  progressForSeries,
  recentProgress,
  saveProgress,
  setChapterStatus,
  setUserDownloadMode,
  stats,
} from './db.ts'
import { enqueueChapter, readMeta, resetStaleDownloads } from './downloader.ts'
import { getAtHome, pageUrls, searchManga } from './mangadex.ts'
import { ensureManga, followManga, queueBacklog, refreshAll, syncManga, unfollowManga } from './service.ts'
import type { ChapterRow, DownloadMode, ProgressRow, SeriesRow } from './types.ts'

type Env = { Variables: { user: User } }

const app = new Hono<Env>()

app.use('*', cors())

function bearer(c: Context<Env>): string {
  const header = c.req.header('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

function clientKey(c: Context<Env>): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming
  return incoming?.socket?.remoteAddress ?? 'unknown'
}

const PUBLIC_ROUTES = new Set(['/api/health', '/api/auth/login', '/api/auth/register'])

app.use('*', async (c, next) => {
  if (PUBLIC_ROUTES.has(c.req.path)) return next()

  const user = userForToken(bearer(c))
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  c.set('user', user)
  await next()
})

app.use('/files/*', serveStatic({ root: config.dataDir }))

function publicUser(user: User) {
  return { id: user.id, username: user.username, createdAt: user.createdAt }
}

/* ---------------- auth ---------------- */

app.post('/api/auth/register', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')
  const invite = String(body.invite ?? '').trim()

  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return c.json({ error: 'Username must be 3-32 characters: letters, numbers, dot, dash, underscore.' }, 400)
  }
  if (password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters.' }, 400)
  }

  // The first account bootstraps the server. After that, registration requires
  // the invite code (and is closed entirely if none is configured).
  if (userCount() > 0) {
    if (!config.inviteCode) {
      return c.json({ error: 'Registration is closed. Ask the owner for an invite.' }, 403)
    }
    if (!safeEqual(invite, config.inviteCode)) {
      return c.json({ error: 'Invalid invite code.' }, 403)
    }
  }

  try {
    const user = await createUser(username, password)
    migrateLegacyFollows()
    const token = createSession(user.id)
    return c.json({ token, user: publicUser(user) }, 201)
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      return c.json({ error: 'That username is taken.' }, 409)
    }
    throw error
  }
})

app.post('/api/auth/login', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')
  if (!username || !password) {
    return c.json({ error: 'Username and password are required.' }, 400)
  }

  const key = `${clientKey(c)}|${username.toLowerCase()}`
  if (!loginAllowed(key)) {
    return c.json({ error: 'Too many attempts. Try again in a few minutes.' }, 429)
  }

  const user = findUserByUsername(username)
  if (!user) {
    await burnPasswordCheck(password)
    recordLoginFailure(key)
    return c.json({ error: 'Wrong username or password.' }, 401)
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    recordLoginFailure(key)
    return c.json({ error: 'Wrong username or password.' }, 401)
  }

  clearLoginFailures(key)
  const token = createSession(user.id)
  return c.json({ token, user: publicUser(user) })
})

app.post('/api/auth/logout', (c) => {
  revokeSession(bearer(c))
  return c.json({ ok: true })
})

app.get('/api/auth/me', (c) => c.json({ user: publicUser(c.get('user')) }))

/* ---------------- serialization ---------------- */

function seriesToManga(series: SeriesRow) {
  return {
    id: series.mangaId,
    title: series.title,
    altTitles: series.altTitles,
    description: series.description,
    coverUrl: series.coverUrl,
    status: series.status,
    year: series.year,
    tags: series.tags,
    authors: series.authors,
    originalLanguage: series.originalLanguage,
    lastChapter: series.lastChapter,
  }
}

function chapterToView(chapter: ChapterRow) {
  return {
    id: chapter.id,
    chapter: chapter.chapter,
    chapterNum: chapter.chapterNum,
    volume: chapter.volume,
    title: chapter.title,
    language: chapter.language,
    pages: chapter.pages,
    group: chapter.group,
    external: chapter.external,
    publishAt: chapter.publishAt,
    status: chapter.status,
    error: chapter.error,
    downloaded: chapter.status === 'done',
  }
}

function progressToView(progress: ProgressRow | null) {
  if (!progress) return null
  return {
    page: progress.page,
    totalPages: progress.totalPages,
    completed: progress.completed,
    updatedAt: progress.updatedAt,
  }
}

/* ---------------- catalogue ---------------- */

app.get('/api/health', (c) => c.json({ ok: true, version: '0.1.0' }))

app.get('/api/search', async (c) => {
  const query = (c.req.query('q') ?? '').trim()
  if (!query) return c.json({ error: 'missing q' }, 400)
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? 20)))
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0))
  const result = await searchManga(query, limit, offset)
  return c.json({ ...result, limit, offset })
})

app.get('/api/manga/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  if (c.req.query('refresh') === '1') await syncManga(id)

  const series = await ensureManga(id)
  const chapters = preferredChapters(listChapters(id))
  const progress = new Map(progressForSeries(user.id, id).map((row) => [row.chapterId, row]))
  const follow = getUserSeries(user.id, id)

  return c.json({
    manga: seriesToManga(series),
    followed: Boolean(follow),
    downloadMode: follow?.downloadMode ?? 'new',
    chapters: chapters.map((chapter) => ({
      ...chapterToView(chapter),
      progress: progressToView(progress.get(chapter.id) ?? null),
    })),
  })
})

/* ---------------- library ---------------- */

app.get('/api/library', (c) => {
  const user = c.get('user')

  const items = listUserSeries(user.id).map((series) => {
    const chapters = preferredChapters(listChapters(series.mangaId))
    const progress = progressForSeries(user.id, series.mangaId)
    const progressById = new Map(progress.map((row) => [row.chapterId, row]))

    const downloaded = chapters.filter((chapter) => chapter.status === 'done').length
    const read = chapters.filter((chapter) => progressById.get(chapter.id)?.completed).length
    const latest = chapters.at(-1)
    const nextUp = chapters.find((chapter) => !progressById.get(chapter.id)?.completed)

    const lastTouched = [...progress].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const lastTouchedChapter = lastTouched
      ? chapters.find((chapter) => chapter.id === lastTouched.chapterId)
      : undefined

    return {
      ...seriesToManga(series),
      downloadMode: getUserSeries(user.id, series.mangaId)?.downloadMode ?? 'new',
      chapterCount: chapters.length,
      downloadedCount: downloaded,
      readCount: read,
      latestChapter: latest ? chapterToView(latest) : null,
      nextChapter: nextUp ? chapterToView(nextUp) : null,
      continueReading:
        lastTouched && lastTouchedChapter
          ? {
              chapter: chapterToView(lastTouchedChapter),
              page: lastTouched.page,
              totalPages: lastTouched.totalPages || lastTouchedChapter.pages,
              completed: lastTouched.completed,
              updatedAt: lastTouched.updatedAt,
            }
          : null,
      updatedAt: series.updatedAt,
    }
  })

  return c.json({ items, stats: stats(user.id) })
})

app.put('/api/library/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { downloadMode?: DownloadMode }
  const mode = body.downloadMode ?? 'new'
  if (!['new', 'all', 'none'].includes(mode)) return c.json({ error: 'invalid downloadMode' }, 400)

  const { series, queued } = await followManga(user.id, id, mode)
  return c.json({
    manga: seriesToManga(series),
    downloadMode: getUserSeries(user.id, id)?.downloadMode ?? mode,
    queued,
  })
})

app.delete('/api/library/:id', (c) => {
  unfollowManga(c.get('user').id, c.req.param('id'))
  return c.json({ ok: true })
})

app.post('/api/library/:id/mode', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { downloadMode?: DownloadMode }
  if (!body.downloadMode || !['new', 'all', 'none'].includes(body.downloadMode)) {
    return c.json({ error: 'invalid downloadMode' }, 400)
  }
  setUserDownloadMode(user.id, id, body.downloadMode)
  const queued = body.downloadMode === 'all' ? queueBacklog(id) : 0
  return c.json({ ok: true, downloadMode: body.downloadMode, queued })
})

app.get('/api/history', (c) => {
  const user = c.get('user')
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? 20)))

  const items = recentProgress(user.id, limit)
    .map(({ progress, chapter }) => {
      const series = getSeries(chapter.mangaId)
      if (!series) return null
      return {
        manga: seriesToManga(series),
        chapter: chapterToView(chapter),
        page: progress.page,
        totalPages: progress.totalPages || chapter.pages,
        completed: progress.completed,
        updatedAt: progress.updatedAt,
      }
    })
    .filter(Boolean)

  return c.json({ items })
})

/* ---------------- reading ---------------- */

app.get('/api/chapters/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const chapter = getChapter(id)
  if (!chapter) return c.json({ error: 'unknown chapter' }, 404)

  const series = getSeries(chapter.mangaId)
  const ordered = preferredChapters(listChapters(chapter.mangaId))
  const index = ordered.findIndex((item) => item.id === id)

  let pages: string[] = []
  if (chapter.status === 'done') {
    const meta = readMeta(chapter.mangaId, chapter.id)
    pages = (meta?.pages ?? []).map((name) => `/files/${chapter.mangaId}/${chapter.id}/${name}`)
  } else if (!chapter.external) {
    const atHome = await getAtHome(chapter.id)
    pages = pageUrls(atHome, config.quality)
  }

  return c.json({
    chapter: chapterToView(chapter),
    manga: series ? seriesToManga(series) : null,
    pages,
    progress: progressToView(getProgress(user.id, id)),
    prev: index > 0 ? ordered[index - 1].id : null,
    next: index >= 0 && index < ordered.length - 1 ? ordered[index + 1].id : null,
  })
})

app.put('/api/chapters/:id/progress', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const chapter = getChapter(id)
  if (!chapter) return c.json({ error: 'unknown chapter' }, 404)

  const body = (await c.req.json().catch(() => ({}))) as {
    page?: number
    totalPages?: number
    completed?: boolean
  }

  const totalPages = Math.max(0, Number(body.totalPages ?? chapter.pages))
  const page = Math.min(Math.max(0, Number(body.page ?? 0)), Math.max(0, totalPages - 1))
  saveProgress(user.id, id, chapter.mangaId, page, totalPages, Boolean(body.completed))
  return c.json({ ok: true })
})

/* ---------------- downloads ---------------- */

app.post('/api/chapters/:id/download', (c) => {
  const id = c.req.param('id')
  const chapter = getChapter(id)
  if (!chapter) return c.json({ error: 'unknown chapter' }, 404)
  if (chapter.external) return c.json({ error: 'external chapter, nothing to download' }, 400)
  const queued = enqueueChapter(id)
  return c.json({ ok: true, queued, status: getChapter(id)?.status ?? 'idle' })
})

app.post('/api/chapters/:id/retry', (c) => {
  const id = c.req.param('id')
  const chapter = getChapter(id)
  if (!chapter) return c.json({ error: 'unknown chapter' }, 404)
  setChapterStatus(id, 'idle')
  const queued = enqueueChapter(id)
  return c.json({ ok: true, queued })
})

app.post('/api/refresh', async (c) => {
  const result = await refreshAll()
  return c.json({ ok: true, ...result })
})

app.get('/api/stats', (c) => c.json(stats(c.get('user').id)))

app.onError((error, c) => {
  console.error('[api]', error)
  return c.json({ error: error.message }, 500)
})

resetStaleDownloads()
purgeExpiredSessions()
migrateLegacyFollows()

export { app }
