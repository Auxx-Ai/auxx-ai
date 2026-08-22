// apps/web/src/app/api/files/upload/[sessionId]/events/route.ts

import { createScopedLogger } from '@auxx/logger'
import { createDedicatedClient } from '@auxx/redis'
import type { NextRequest } from 'next/server'
import { authorizeUploadSession } from '../authorize-upload-session'

const logger = createScopedLogger('upload-sse')

interface RouteParams {
  params: Promise<{ sessionId: string }>
}

/**
 * Server-Sent Events endpoint for presigned upload progress
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params

  // Authenticate: this stream used to disclose upload status for any known
  // session id (`docs/files-upload-architecture-guide.md` §11.4).
  const authorized = await authorizeUploadSession(sessionId)
  if (authorized instanceof Response) return authorized
  const { session } = authorized

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      // Send initial session status
      const sendEvent = (type: string, data: any) => {
        const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
        controller.enqueue(encoder.encode(message))
      }

      // Send current session status
      sendEvent('session-status', {
        sessionId,
        status: session.status,
        timestamp: new Date().toISOString(),
      })

      // Set up Redis subscriber for session updates
      const setupSubscription = async () => {
        try {
          // Per-request dedicated client — cleanup .quit() must not affect any
          // shared singleton.
          const subscriber = await createDedicatedClient()
          if (!subscriber) {
            logger.warn('Redis not available for SSE', { sessionId })
            return
          }

          const statusChannel = `upload:status:${sessionId}`

          await subscriber.subscribe(statusChannel)

          subscriber.on('message', (channel, message) => {
            if (channel === statusChannel) {
              try {
                const update = JSON.parse(message)
                sendEvent('status-update', update)

                // Close stream if session is completed or failed
                if (update.status === 'completed' || update.status === 'failed') {
                  setTimeout(() => controller.close(), 1000) // Allow final message to send
                }
              } catch (error) {
                logger.error('Failed to parse status update', { sessionId, error })
              }
            }
          })

          logger.info('Subscribed to session status updates', { sessionId })

          // Cleanup on close
          request.signal.addEventListener('abort', () => {
            subscriber.unsubscribe(statusChannel)
            subscriber.quit()
            controller.close()
          })
        } catch (error) {
          logger.error('Failed to setup Redis subscription', { sessionId, error })
        }
      }

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        sendEvent('heartbeat', { timestamp: new Date().toISOString() })
      }, 30000)

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
        controller.close()
      })

      // Set up subscription
      setupSubscription()
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
