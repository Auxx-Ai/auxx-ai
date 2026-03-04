// apps/web/src/lib/sse/create-sse-poll-route.ts

import type { database } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { auth } from '~/auth/server'

interface SsePollRouteOptions {
  /** Maps route params to the Redis list key */
  getRedisKey: (params: Record<string, string>) => string
  /**
   * Optional authorization check. Receives session + route params.
   * Return true to allow, false to reject with 403.
   * If omitted, only session presence is checked.
   */
  authorize?: (
    session: { user: { defaultOrganizationId: string } },
    params: Record<string, string>,
    db: typeof database
  ) => Promise<boolean>
  /** Polling interval in ms (default 1000) */
  pollIntervalMs?: number
  /** Heartbeat interval in ms (default 30000) */
  heartbeatMs?: number
}

/**
 * Creates a Next.js GET route handler that streams SSE events from a Redis list.
 *
 * Uses lrange with a per-connection cursor (seenIds) instead of rpop,
 * so multiple concurrent listeners all receive the same events without
 * consuming them. Events are cleaned up by the producer's ltrim + TTL.
 */
export function createSsePollRoute(options: SsePollRouteOptions) {
  const { getRedisKey, authorize, pollIntervalMs = 1000, heartbeatMs = 30000 } = options

  return async (req: NextRequest, { params }: { params: Promise<Record<string, string>> }) => {
    const resolvedParams = await params

    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return new Response('Unauthorized', { status: 401 })
    }

    if (authorize) {
      const { database: db } = await import('@auxx/database')
      const allowed = await authorize(session as any, resolvedParams, db)
      if (!allowed) {
        return new Response('Forbidden', { status: 403 })
      }
    }

    const redisKey = getRedisKey(resolvedParams)

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue('event: connected\ndata: {"status": "connected"}\n\n')

        const redis = await getRedisClient(true)
        if (!redis) {
          controller.close()
          return
        }

        // Track which events this connection has already sent via event ID.
        // lpush puts newest at index 0, ltrim keeps indices 0-49.
        const seenIds = new Set<string>()

        // Send all existing events on connect (catch-up)
        try {
          const existing = await redis.lrange(redisKey, 0, 49)
          for (const raw of existing.reverse()) {
            try {
              const event = JSON.parse(raw)
              if (event.id) seenIds.add(event.id)
              controller.enqueue(`data: ${raw}\n\n`)
            } catch {
              /* skip unparseable */
            }
          }
        } catch (error) {
          console.error('Error reading initial events:', error)
        }

        // Poll for new events
        const pollInterval = setInterval(async () => {
          try {
            const events = await redis.lrange(redisKey, 0, 49)
            // Iterate newest-first, send only unseen events (in chronological order)
            const newEvents: string[] = []
            for (const raw of events) {
              try {
                const event = JSON.parse(raw)
                if (event.id && !seenIds.has(event.id)) {
                  seenIds.add(event.id)
                  newEvents.unshift(raw)
                }
              } catch {
                /* skip */
              }
            }
            for (const raw of newEvents) {
              controller.enqueue(`data: ${raw}\n\n`)
            }
          } catch (error) {
            console.error('Error polling events:', error)
          }
        }, pollIntervalMs)

        const heartbeatInterval = setInterval(() => {
          controller.enqueue(':heartbeat\n\n')
        }, heartbeatMs)

        req.signal.addEventListener('abort', () => {
          clearInterval(pollInterval)
          clearInterval(heartbeatInterval)
          controller.close()
        })
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }
}
