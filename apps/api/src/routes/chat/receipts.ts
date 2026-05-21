// apps/api/src/routes/chat/receipts.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, ne } from 'drizzle-orm'
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
 * Body: `{ messageIds: string[] }`. Marks AGENT/SYSTEM messages as delivered
 * or read by the visitor. Phase 4 unifies with the Message read-state model.
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

  const body = (await c.req.json().catch(() => ({}))) as { messageIds?: string[] }
  const messageIds = Array.isArray(body.messageIds) ? body.messageIds : []
  if (messageIds.length === 0) {
    return c.json({ success: true, data: { updated: 0 } })
  }

  const targetStatus = kind === 'read' ? 'READ' : 'DELIVERED'

  try {
    await database
      .update(schema.ChatMessage)
      .set({ status: targetStatus, updatedAt: new Date() })
      .where(
        and(
          inArray(schema.ChatMessage.id, messageIds),
          ne(schema.ChatMessage.sender, 'USER'),
          ne(schema.ChatMessage.status, targetStatus)
        )
      )

    return c.json({ success: true, data: { updated: messageIds.length, status: targetStatus } })
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
