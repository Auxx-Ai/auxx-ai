// apps/web/src/app/api/workflows/[workflowId]/run/route.ts

import { NextRequest } from 'next/server'
import { auth } from '~/auth/server'
import { headers } from 'next/headers'
import { RedisEventRouter } from '@auxx/redis'
import { WorkflowExecutionService } from '@auxx/lib/workflows'
import { RedisWorkflowExecutionReporter, WorkflowEventType } from '@auxx/lib/workflow-engine'
import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { safeJsonStringify } from '@auxx/lib/workflow-engine/utils/serialization'

// Types for file handling
interface UploadedFile {
  id: string // WorkflowFile ID
  fileId: string // Actual File ID  
  filename: string
  mimeType: string
  size: number
  url: string
  uploadedAt: string
}

interface WorkflowFileData {
  id: string // WorkflowFile ID
  fileId: string // Actual File ID
  filename: string
  mimeType: string
  size: number
  url: string
  nodeId: string
  uploadedAt: Date
  expiresAt?: Date // Set by WorkflowProcessor
}

const logger = createScopedLogger('workflow-run-api')

/**
 * Process file inputs and convert UploadedFile[] to WorkflowFileData format
 */
async function processFileInputs(inputs: Record<string, any>): Promise<Record<string, any>> {
  const processedInputs = { ...inputs }
  
  for (const [nodeId, value] of Object.entries(inputs)) {
    // Check if the value is an array of uploaded files
    if (Array.isArray(value) && value.length > 0 && isUploadedFileArray(value)) {
      // Convert UploadedFile[] to WorkflowFileData[]
      processedInputs[nodeId] = value.map((file: UploadedFile): WorkflowFileData => ({
        id: file.id,
        fileId: file.fileId,
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size,
        url: file.url,
        nodeId,
        uploadedAt: new Date(file.uploadedAt),
        // Note: expiresAt will be set by WorkflowProcessor during upload
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour default for workflow runs
      }))
      
      logger.info('Processed file inputs for workflow run', {
        nodeId,
        fileCount: value.length,
        files: value.map((f: UploadedFile) => ({ id: f.id, filename: f.filename })),
      })
    }
  }
  
  return processedInputs
}

/**
 * Type guard to check if a value is an array of UploadedFile objects
 */
function isUploadedFileArray(value: any[]): value is UploadedFile[] {
  return value.every(item => 
    typeof item === 'object' &&
    item !== null &&
    typeof item.id === 'string' &&
    typeof item.fileId === 'string' &&
    typeof item.filename === 'string' &&
    typeof item.url === 'string' &&
    typeof item.uploadedAt === 'string'
  )
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workflowId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { workflowId } = await context.params
  const body = await request.json()
  const { inputs = {}, mode = 'test' } = body

  const organizationId = (session.user as any).defaultOrganizationId
  const userId = session.user.id
  const userEmail = session.user.email || undefined
  const userName = session.user.name || undefined

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const send = (event: any) => {
        controller.enqueue(
          encoder.encode(`event: ${event.event}\n` + `data: ${safeJsonStringify(event)}\n\n`)
        )
      }

      let cleanup: (() => Promise<void>) | null = null
      let router: any = null
      let handlerId: string | null = null

      try {
        // 1. Process file inputs and convert to WorkflowFileData format
        const processedInputs = await processFileInputs(inputs)
        
        // 2. Create the workflow run using service with processed inputs
        const workflowExecutionService = new WorkflowExecutionService(db)
        const workflowRun = await workflowExecutionService.createRun({
          workflowId,
          inputs: processedInputs,
          mode,
          userId,
          organizationId,
          userEmail,
          userName,
        })

        // 2. Send initial run-created event
        send({
          event: WorkflowEventType.RUN_CREATED,
          workflowRunId: workflowRun.id,
          timestamp: new Date().toISOString(),
          data: workflowRun,
        })
        logger.info('Workflow run created', { workflowRunId: workflowRun.id, workflowId })

        // 3. Set up Redis event subscription using RedisEventRouter
        router = RedisEventRouter.getInstance('workflow-sse')
        logger.info('Setting up Redis event subscription', { workflowRunId: workflowRun.id })

        handlerId = await router.subscribeToWorkflowEvents(workflowRun.id, (event: any) => {
          try {
            send(event)

            // Auto-close only on true terminal events
            // Note: WORKFLOW_PAUSED and WORKFLOW_RESUMED are NOT terminal - keep connection open
            if (
              [
                WorkflowEventType.WORKFLOW_FINISHED,
                WorkflowEventType.WORKFLOW_FAILED,
                WorkflowEventType.WORKFLOW_CANCELLED,
              ].includes(event.event)
            ) {
              setTimeout(() => {
                if (cleanup) cleanup()
              }, 1000)
            }
          } catch (error) {
            logger.error('Error handling workflow event', {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              workflowRunId: workflowRun.id,
            })
          }
        })

        logger.info('Successfully subscribed to workflow events', {
          workflowRunId: workflowRun.id,
          handlerId,
        })

        // 4. Start workflow execution (WorkflowEngine will emit events)
        // Always create reporter - needed for node execution persistence and SSE events
        const reporter = new RedisWorkflowExecutionReporter(workflowRun.id)

        // Execute workflow asynchronously
        workflowExecutionService.executeWorkflowAsync(workflowRun, reporter, userEmail, userName).catch((error) => {
          logger.error('Workflow execution failed', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            workflowRunId: workflowRun.id,
          })

          // Send error event
          send({
            event: WorkflowEventType.ERROR,
            workflowRunId: workflowRun.id,
            timestamp: new Date().toISOString(),
            data: {
              message: error instanceof Error ? error.message : 'Workflow execution failed',
              code: 'WORKFLOW_EXECUTION_ERROR',
            },
          })
        })

        // 5. Heartbeat
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(':heartbeat\n\n'))
          } catch {
            if (cleanup) cleanup()
          }
        }, 15000)

        // 6. Cleanup function
        cleanup = async () => {
          clearInterval(heartbeat)

          // Unsubscribe from workflow events using RedisEventRouter
          if (router && handlerId) {
            try {
              await router.unsubscribe(handlerId)
              logger.info('Redis event subscription cleaned up', { handlerId })
            } catch (error) {
              logger.error('Error cleaning up Redis event subscription', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
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

        // Handle abort
        request.signal.addEventListener('abort', () => {
          if (cleanup) cleanup()
        })
      } catch (error) {
        logger.error('Failed to start workflow', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          workflowId,
        })

        send({
          event: WorkflowEventType.ERROR,
          workflowRunId: 'unknown',
          timestamp: new Date().toISOString(),
          data: {
            message: error instanceof Error ? error.message : 'Failed to start workflow',
            code: 'WORKFLOW_START_ERROR',
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
      'X-Accel-Buffering': 'no',
    },
  })
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ workflowId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { workflowId } = await context.params
  const { searchParams } = new URL(request.url)
  const runId = searchParams.get('runId')

  if (!runId) {
    return new Response('Missing runId parameter', { status: 400 })
  }

  const organizationId = (session.user as any).defaultOrganizationId
  const userId = session.user.id

  logger.info('DELETE workflow run request', { workflowId, runId, userId })

  try {
    const workflowExecutionService = new WorkflowExecutionService(db)

    // Create reporter for SSE events during stop
    const reporter = new RedisWorkflowExecutionReporter(runId)

    const result = await workflowExecutionService.stopWorkflowRun({
      runId,
      userId,
      organizationId,
      reporter,
    })

    logger.info('Workflow run stopped successfully', { runId, userId })
    return Response.json(result)
  } catch (error) {
    logger.error('Failed to stop workflow run', {
      runId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return new Response(
      safeJsonStringify({
        error: error instanceof Error ? error.message : 'Failed to stop workflow',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
