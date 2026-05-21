// apps/api/src/routes/chat/receipts.ts

import { database } from '@auxx/database'
import { markDelivered, markRead } from '@auxx/lib/chat'
import { createScopedLogger } from '@auxx/logger'
import { Hono } from 'hono'
import { applyChatCorsHeaders } from './lib'

const log = createScopedLogger('chat-receipts-route')

const receiptsRoute = new Hono()

receiptsRoute.options('/:kind', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * POST /api/chat/receipts/delivered
 * POST /api/chat/receipts/read
 *
 * Body: `{ messageIds: string[] }`. Marks AGENT-sent messages as delivered or
 * read by the visitor. Publishes `message:updated` so agent UIs reflect the
 * receipt without a refetch.
 */
receiptsRoute.post('/:kind', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const kind = c.req.param('kind')
  if (kind !== 'delivered' && kind !== 'read') {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Unknown receipt kind' } },
      404
    )
  }

  const chat = c.get('chat')
  const body = (await c.req.json().catch(() => ({}))) as { messageIds?: string[] }
  const messageIds = Array.isArray(body.messageIds) ? body.messageIds : []
  if (messageIds.length === 0) {
    return c.json({ success: true, data: { updated: 0 } })
  }

  try {
    const ctx = { db: database, organizationId: chat.organizationId }
    const result =
      kind === 'delivered'
        ? await markDelivered(ctx, chat.visitorParticipantId, messageIds)
        : await markRead(ctx, chat.visitorParticipantId, messageIds)
    if (result.error) {
      log.error('Receipt update failed', { kind, error: result.error.message })
      return c.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update receipts' } },
        500
      )
    }
    return c.json({
      success: true,
      data: { updated: result.value.updated, status: kind === 'read' ? 'READ' : 'DELIVERED' },
    })
  } catch (error) {
    log.error('Failed to update receipts', {
      kind,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update receipts' } },
      500
    )
  }
})

export default receiptsRoute
