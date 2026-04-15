// apps/api/src/routes/recording-webhooks.ts

import type { BotProviderId } from '@auxx/lib/recording/bot'
import { handleRecordingWebhook } from '@auxx/lib/recording/bot'
import { createScopedLogger } from '@auxx/logger'
import { Hono } from 'hono'
import type { AppContext } from '../types/context'

const log = createScopedLogger('recording-webhooks')

const recordingWebhooks = new Hono<AppContext>()

/**
 * POST /recording/:provider
 * Receive webhook callbacks from recording bot providers (e.g., Recall.ai).
 */
recordingWebhooks.post('/:provider', async (c) => {
  const provider = c.req.param('provider') as BotProviderId

  // Read raw body for signature verification
  const rawBody = await c.req.text()
  const headers = Object.fromEntries(c.req.raw.headers.entries())

  log.info('Recording webhook received', { provider })

  const result = await handleRecordingWebhook(provider, headers, rawBody)

  if (result.isErr()) {
    const status = result.error.message.includes('signature') ? 401 : 400
    log.warn('Recording webhook rejected', {
      provider,
      error: result.error.message,
    })
    return c.json({ error: result.error.message }, status)
  }

  return c.json({ ok: true }, 200)
})

export default recordingWebhooks
