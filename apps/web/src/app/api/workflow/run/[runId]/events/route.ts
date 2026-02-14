// apps/web/src/app/api/workflow/run/[runId]/events/route.ts

import { database as db, schema } from '@auxx/database'
import { safeJsonStringify } from '@auxx/lib/workflow-engine'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { and, asc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('workflow-run-events-api')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { runId } = await params
  // Get organization ID from session or user profile
  const organizationId =
    (session.user as any).defaultOrganizationId || (session.user as any).organizationId

  // Verify access and get current state
  const [workflowRun] = await db
    .select()
    .from(schema.WorkflowRun)
    .where(
      and(eq(schema.WorkflowRun.id, runId), eq(schema.WorkflowRun.organizationId, organizationId))
    )
    .limit(1)

  const nodeExecutions = await db
    .select()
    .from(schema.WorkflowNodeExecution)
    .where(eq(schema.WorkflowNodeExecution.workflowRunId, runId))
    .orderBy(asc(schema.WorkflowNodeExecution.createdAt))

  if (!workflowRun) {
    return new Response('Workflow run not found', { status: 404 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      // Helper to send SSE formatted data
      const send = (event: string, data: any) => {
        const message = [
          `event: ${event}`,
          `data: ${safeJsonStringify(data)}`,
          '', // Empty line to signal end of message
          '',
        ].join('\n')

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
        } catch (error) {
          clearInterval(heartbeat)
        }
      }, 15000)

      // Create dedicated Redis subscriber
      let subscriber: Awaited<ReturnType<typeof getRedisClient>> | null = null
      const channel = `workflow:run:${runId}`

      // Track cleanup
      let cleaned = false
      let messageHandler: ((channel: string, message: string) => void) | null = null
      const cleanup = async () => {
        if (cleaned) return
        cleaned = true

        clearInterval(heartbeat)
        if (subscriber) {
          try {
            // Remove message handler if it exists
            if (messageHandler) {
              subscriber.removeListener('message', messageHandler)
            }
            await subscriber.unsubscribe(channel)
            await subscriber.quit()
          } catch (error) {
            logger.error('Redis cleanup error', { error, runId })
          }
        }
        try {
          controller.close()
        } catch (error) {
          // Controller may already be closed
        }
      }

      try {
        // Get Redis subscriber client
        subscriber = await getRedisClient(true)

        // Send initial connection event (normalize status to lowercase to match event schema)
        send('connected', {
          runId,
          status: workflowRun.status.toLowerCase(),
          timestamp: new Date().toISOString(),
        })

        // Send current node states from database (initial state reconstruction)
        for (const nodeExec of nodeExecutions) {
          if (nodeExec.status === 'succeeded' || nodeExec.status === 'failed') {
            send('node-finished', {
              id: nodeExec.id,
              node_id: nodeExec.nodeId,
              node_type: nodeExec.nodeType,
              title: nodeExec.title,
              index: nodeExec.index,
              predecessor_node_id: null, // Could be derived from graph if needed
              inputs: nodeExec.inputs,
              outputs: nodeExec.outputs,
              status: nodeExec.status,
              error: nodeExec.error,
              elapsedTime: nodeExec.elapsedTime,
              createdAt: Math.floor(nodeExec.createdAt.getTime() / 1000),
              finishedAt: Math.floor((nodeExec.finishedAt || nodeExec.createdAt).getTime() / 1000),
            })
          } else if (nodeExec.status === 'running') {
            send('node-started', {
              id: nodeExec.id,
              node_id: nodeExec.nodeId,
              node_type: nodeExec.nodeType,
              title: nodeExec.title,
              index: nodeExec.index,
              predecessor_node_id: null,
              inputs: nodeExec.inputs,
              createdAt: Math.floor(nodeExec.createdAt.getTime() / 1000),
            })
          }
        }

        // Send workflow-finished event for already-completed workflows
        // This ensures clients receive the same events whether they connect before or after completion
        if (workflowRun.status === 'SUCCEEDED' || workflowRun.status === 'FAILED') {
          send('workflow-finished', {
            id: workflowRun.id,
            workflowId: workflowRun.workflowId,
            status: workflowRun.status.toLowerCase(),
            outputs: workflowRun.outputs,
            elapsedTime: workflowRun.elapsedTime,
            totalTokens: workflowRun.totalTokens,
            totalSteps: workflowRun.totalSteps,
            createdAt: Math.floor(workflowRun.createdAt.getTime() / 1000),
            finishedAt: workflowRun.finishedAt
              ? Math.floor(workflowRun.finishedAt.getTime() / 1000)
              : Math.floor(Date.now() / 1000),
          })
        }

        // Set up message handler for Redis subscription (ioredis pattern)
        messageHandler = (channel: string, message: string) => {
          try {
            // Check for null/undefined messages
            if (message === null || message === undefined) {
              logger.warn('Received null/undefined Redis message', { runId, message })
              return
            }

            // Check for empty messages
            if (typeof message !== 'string' || message.trim() === '') {
              logger.warn('Received empty Redis message', {
                runId,
                message,
                messageType: typeof message,
              })
              return
            }

            logger.debug('Received Redis message', {
              runId,
              channel,
              messageLength: message.length,
              messagePreview: message.substring(0, 100),
            })

            const event = JSON.parse(message)

            if (!event || typeof event !== 'object') {
              logger.warn('Parsed event is not an object', {
                runId,
                event,
                message: message.substring(0, 200),
              })
              return
            }

            if (!event.event || !event.data) {
              logger.warn('Invalid event structure from Redis', {
                runId,
                hasEvent: !!event.event,
                hasData: !!event.data,
                eventKeys: Object.keys(event),
                event,
              })
              return
            }

            send(event.event, event.data)
          } catch (error) {
            logger.error('Failed to parse Redis message', {
              error: error instanceof Error ? error.message : String(error),
              runId,
              message,
              messageType: typeof message,
              messageLength: message?.length,
            })
          }
        }

        // Subscribe to live events from Redis using ioredis pattern
        await subscriber.subscribe(channel)
        subscriber.on('message', messageHandler)

        logger.info('SSE connection established with Redis subscription', { runId, organizationId })

        // Handle client disconnect
        request.signal.addEventListener('abort', cleanup)
      } catch (error) {
        logger.error('SSE stream error', { error, runId })
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
