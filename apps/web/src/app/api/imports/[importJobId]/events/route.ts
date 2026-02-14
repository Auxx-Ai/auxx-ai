// apps/web/src/app/api/imports/[importJobId]/events/route.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { createDedicatedClient } from '@auxx/redis'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('import-job-events-api')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Redis channel prefix for import events */
const IMPORT_EVENTS_CHANNEL = 'import:events'

/**
 * SSE endpoint for import job events.
 * Clients subscribe to receive real-time updates on import progress.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ importJobId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { importJobId } = await params
  const organizationId =
    (session.user as { defaultOrganizationId?: string }).defaultOrganizationId ||
    (session.user as { organizationId?: string }).organizationId

  if (!organizationId) {
    return new Response('Organization not found', { status: 403 })
  }

  // Verify access to the import job
  const [importJob] = await db
    .select()
    .from(schema.ImportJob)
    .where(
      and(eq(schema.ImportJob.id, importJobId), eq(schema.ImportJob.organizationId, organizationId))
    )
    .limit(1)

  if (!importJob) {
    return new Response('Import job not found', { status: 404 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      /** Helper to send SSE formatted data */
      const send = (event: string, data: unknown) => {
        const message = [`event: ${event}`, `data: ${JSON.stringify(data)}`, '', ''].join('\n')

        try {
          controller.enqueue(encoder.encode(message))
        } catch (error) {
          logger.error('Failed to send SSE message', { error, event })
        }
      }

      // Send heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(':heartbeat\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, 15000)

      // Create dedicated Redis subscriber (each SSE connection gets its own client)
      let subscriber: Awaited<ReturnType<typeof createDedicatedClient>> | null = null
      const channel = `${IMPORT_EVENTS_CHANNEL}:${importJobId}`

      // Track cleanup
      let cleaned = false
      let messageHandler: ((channel: string, message: string) => void) | null = null

      const cleanup = async () => {
        if (cleaned) return
        cleaned = true

        clearInterval(heartbeat)
        if (subscriber) {
          try {
            if (messageHandler) {
              subscriber.removeListener('message', messageHandler)
            }
            await subscriber.unsubscribe(channel)
            await subscriber.quit()
          } catch (error) {
            logger.error('Redis cleanup error', { error, importJobId })
          }
        }
        try {
          controller.close()
        } catch {
          // Controller may already be closed
        }
      }

      try {
        // Get dedicated Redis subscriber client (isolated from other connections)
        subscriber = await createDedicatedClient()

        // Send initial connection event with current job status
        send('connected', {
          importJobId,
          status: importJob.status,
          rowCount: importJob.rowCount,
          columnCount: importJob.columnCount,
          receivedChunks: importJob.receivedChunks,
          totalChunks: importJob.totalChunks,
          timestamp: new Date().toISOString(),
        })

        // If job is already completed or failed, send final status
        if (importJob.status === 'completed' || importJob.status === 'failed') {
          send('job:status', {
            status: importJob.status,
            statistics: importJob.statistics,
            completedAt: importJob.completedAt?.toISOString(),
          })
        }

        // If resolution is complete (waiting status with allowPlanGeneration), send status
        if (importJob.status === 'waiting' && importJob.allowPlanGeneration) {
          send('job:status', {
            status: importJob.status,
          })
        }

        // Set up message handler for Redis subscription
        messageHandler = (ch: string, message: string) => {
          if (ch !== channel) return

          try {
            if (!message || typeof message !== 'string' || message.trim() === '') {
              return
            }

            const event = JSON.parse(message)

            if (!event || typeof event !== 'object' || !event.type) {
              logger.warn('Invalid event structure from Redis', { importJobId, event })
              return
            }

            // Forward the event to the client
            send(event.type, event)
          } catch (error) {
            logger.error('Failed to parse Redis message', {
              error: error instanceof Error ? error.message : String(error),
              importJobId,
              message,
            })
          }
        }

        // Subscribe to live events from Redis
        await subscriber.subscribe(channel)
        subscriber.on('message', messageHandler)

        logger.info('SSE connection established for import job', { importJobId, organizationId })

        // Handle client disconnect
        request.signal.addEventListener('abort', cleanup)
      } catch (error) {
        logger.error('SSE stream error', { error, importJobId })
        await cleanup()
      }
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
