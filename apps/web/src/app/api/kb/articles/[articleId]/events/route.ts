// apps/web/src/app/api/kb/articles/[articleId]/events/route.ts

import { database as db, schema } from '@auxx/database'
import { kbArticleChannel } from '@auxx/lib/kb'
import { createScopedLogger } from '@auxx/logger'
import { createDedicatedClient } from '@auxx/redis'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('kb-article-events-api')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * SSE endpoint for KB article realtime events. Each connected editor
 * subscribes to the per-article channel and receives:
 *   - `kb-article-patch`: incremental block-CRUD op from Kopilot
 *   - `kb-article-resync`: full doc replacement (manual edits, revert, hash mismatch)
 *   - `kb-article-lock` / unlock: editor read-only signal
 *
 * Auth happens at connect time only; subsequent events are delivered
 * to whoever is subscribed to the channel. This matches the existing
 * imports/documents SSE pattern.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ articleId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { articleId } = await params
  const organizationId =
    (session.user as { defaultOrganizationId?: string }).defaultOrganizationId ||
    (session.user as { organizationId?: string }).organizationId

  if (!organizationId) {
    return new Response('Organization not found', { status: 403 })
  }

  // Verify access: article must belong to this org.
  const [article] = await db
    .select({ id: schema.Article.id })
    .from(schema.Article)
    .where(and(eq(schema.Article.id, articleId), eq(schema.Article.organizationId, organizationId)))
    .limit(1)

  if (!article) {
    return new Response('Article not found', { status: 404 })
  }

  const encoder = new TextEncoder()

  // Hoisted so the stream's cancel() handler can tear down Redis on client disconnect.
  let cleanup: () => Promise<void> = async () => {}

  const stream = new ReadableStream({
    async start(controller) {
      // Once the stream is closed (disconnect, error, completion) we must stop touching the
      // controller. Without this guard, a flood of Redis events each hits a closed controller
      // and spams error logs (and leaks the dedicated Redis client).
      let closed = false

      const send = (event: string, data: unknown) => {
        if (closed) return

        const message = [`event: ${event}`, `data: ${JSON.stringify(data)}`, '', ''].join('\n')
        try {
          controller.enqueue(encoder.encode(message))
        } catch {
          // Controller closed underneath us (client gone). Tear down once instead of
          // logging an error for every subsequent event.
          void cleanup()
        }
      }

      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat)
          return
        }
        try {
          controller.enqueue(encoder.encode(':heartbeat\n\n'))
        } catch {
          void cleanup()
        }
      }, 15000)

      let subscriber: Awaited<ReturnType<typeof createDedicatedClient>> | null = null
      const channel = kbArticleChannel(articleId)

      let messageHandler: ((channel: string, message: string) => void) | null = null

      cleanup = async () => {
        if (closed) return
        closed = true

        clearInterval(heartbeat)
        if (subscriber) {
          try {
            if (messageHandler) {
              subscriber.removeListener('message', messageHandler)
            }
            await subscriber.unsubscribe(channel)
            await subscriber.quit()
          } catch (error) {
            logger.error('Redis cleanup error', { error, articleId })
          }
        }
        try {
          controller.close()
        } catch {
          // Controller may already be closed
        }
      }

      try {
        subscriber = await createDedicatedClient()

        send('connected', { articleId, timestamp: new Date().toISOString() })

        messageHandler = (ch: string, message: string) => {
          if (ch !== channel) return
          try {
            if (!message || typeof message !== 'string' || message.trim() === '') return
            const event = JSON.parse(message)
            if (!event || typeof event !== 'object' || !event.type) {
              logger.warn('Invalid event structure from Redis', { articleId, event })
              return
            }
            send(event.type, event)
          } catch (error) {
            logger.error('Failed to parse Redis message', {
              error: error instanceof Error ? error.message : String(error),
              articleId,
            })
          }
        }

        await subscriber.subscribe(channel)
        subscriber.on('message', messageHandler)

        logger.info('SSE connection established for KB article', { articleId, organizationId })

        request.signal.addEventListener('abort', cleanup)
      } catch (error) {
        logger.error('SSE stream error', { error, articleId })
        await cleanup()
      }
    },
    // Fires when the consumer cancels the stream (client disconnect). More reliable than
    // request.signal in some runtimes, and ensures Redis is unsubscribed so events stop.
    async cancel() {
      await cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
