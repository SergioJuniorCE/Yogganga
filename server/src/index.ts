import { serve } from '@hono/node-server'
import { config } from './config.ts'
import { app } from './routes.ts'
import { refreshAll } from './service.ts'

serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`manga-server listening on http://localhost:${info.port}`)
  console.log(`data directory: ${config.dataDir}`)
  if (!config.inviteCode) {
    console.log('note: MANGA_INVITE_CODE is unset - after the first account, registration is closed')
  }
})

async function poll() {
  try {
    const result = await refreshAll()
    console.log(`[refresh] ${result.series} series, ${result.added} new chapters, ${result.queued} queued`)
  } catch (error) {
    console.error('[refresh] failed:', error)
  }
}

if (config.pollHours > 0) {
  setTimeout(poll, 5_000)
  setInterval(poll, config.pollHours * 60 * 60 * 1000)
}
