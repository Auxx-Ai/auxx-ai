// apps/web/src/app/api/documents/[documentId]/events/route.ts

import { NextRequest } from 'next/server'
import { auth } from '~/auth/server'
import { headers } from 'next/headers'
import { RedisEventRouter } from '@auxx/redis'
import { DocumentEventType, type DocumentEvent } from '@auxx/lib/datasets'
import { createScopedLogger } from '@auxx/logger'
import { DocumentModel } from '@auxx/database/models'

const logger = createScopedLogger('document-events-sse')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * SSE endpoint for document processing progress
 * GET /api/documents/[documentId]/events
 *
 * Follows same pattern as workflow run events endpoint
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { documentId } = await context.params
  const organizationId = (session.user as any).defaultOrganizationId

  // Verify document exists and belongs to user's organization
  const docModel = new DocumentModel(organizationId)
  const docResult = await docModel.findById(documentId)

  if (!docResult.ok || !docResult.value) {
    return new Response('Document not found', { status: 404 })
  }

  const document = docResult.value

  logger.info('Starting document SSE connection', {
    documentId,
    datasetId: document.datasetId,
    organizationId,
  })

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const send = (event: DocumentEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`)
          )
        } catch (error) {
          logger.error('Failed to send SSE event', {
            error: error instanceof Error ? error.message : String(error),
            documentId,
          })
        }
      }

      let router: RedisEventRouter | null = null
      let handlerId: string | null = null
      let heartbeatInterval: NodeJS.Timeout | null = null

      const cleanup = async () => {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval)
          heartbeatInterval = null
        }

        if (router && handlerId) {
          try {
            await router.unsubscribe(handlerId)
            logger.info('Document event subscription cleaned up', { handlerId, documentId })
          } catch (error) {
            logger.error('Error cleaning up subscription', {
              error: error instanceof Error ? error.message : String(error),
              handlerId,
            })
          }
        }

        try {
          controller.close()
        } catch {
          // Controller might already be closed
        }
      }

      try {
        // Set up Redis event subscription FIRST (before sending connected event)
        // This prevents race conditions where events are emitted before subscription
        router = RedisEventRouter.getInstance('document-sse')

        handlerId = await router.subscribeToDocumentEvents(documentId, (event: DocumentEvent) => {
          try {
            send(event)

            // Auto-close on terminal events (after a short delay for client to receive)
            if (
              event.event === DocumentEventType.PROCESSING_COMPLETED ||
              event.event === DocumentEventType.PROCESSING_FAILED
            ) {
              setTimeout(() => {
                cleanup()
              }, 1000)
            }
          } catch (error) {
            logger.error('Error handling document event', {
              error: error instanceof Error ? error.message : String(error),
              documentId,
              event: event.event,
            })
          }
        })

        logger.info('Subscribed to document events', { documentId, handlerId })

        // Now send initial connected event with current document status
        send({
          event: DocumentEventType.CONNECTED,
          documentId,
          datasetId: document.datasetId,
          timestamp: new Date().toISOString(),
          data: {
            status: document.status,
            title: document.title,
          },
        })

        // If document is already in terminal state, send special event and close after delay
        // Using 'already_indexed' event (not PROCESSING_COMPLETED) to prevent reconnection loops
        // Delay allows client to receive the event before stream closes
        if (document.status === 'INDEXED') {
          send({
            event: 'already_indexed',
            documentId,
            datasetId: document.datasetId,
            timestamp: new Date().toISOString(),
            data: {
              status: 'INDEXED',
              message: 'Document already indexed - no processing needed',
            },
          } as any) // Type assertion since already_indexed is not in DocumentEventType
          setTimeout(() => cleanup(), 1000)
          return
        } else if (document.status === 'FAILED') {
          send({
            event: DocumentEventType.PROCESSING_FAILED,
            documentId,
            datasetId: document.datasetId,
            timestamp: new Date().toISOString(),
            data: {
              error: document.errorMessage || 'Processing failed',
            },
          })
          setTimeout(() => cleanup(), 1000)
          return
        }

        // Heartbeat to keep connection alive (every 15 seconds)
        heartbeatInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(':heartbeat\n\n'))
          } catch {
            cleanup()
          }
        }, 15000)

        // Handle client disconnect
        request.signal.addEventListener('abort', () => {
          logger.info('Client disconnected from document SSE', { documentId })
          cleanup()
        })
      } catch (error) {
        logger.error('Failed to set up document SSE', {
          error: error instanceof Error ? error.message : String(error),
          documentId,
        })

        send({
          event: 'connection_error', // Use 'connection_error' instead of 'error' to avoid conflict with native EventSource error event
          documentId,
          datasetId: document.datasetId,
          timestamp: new Date().toISOString(),
          data: {
            message: error instanceof Error ? error.message : 'Failed to connect',
            code: 'CONNECTION_ERROR',
          },
        })

        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  })
}
