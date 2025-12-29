// apps/web/src/app/api/workflows/shared/[shareToken]/run/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { eq, desc } from 'drizzle-orm'
import { database, schema } from '@auxx/database'
import type { WorkflowShareConfig } from '@auxx/database'
import { RedisEventRouter } from '@auxx/redis'
import { createScopedLogger } from '@auxx/logger'
import {
  RedisWorkflowExecutionReporter,
  WorkflowEventType,
  WorkflowGraphBuilder,
  WorkflowEngine,
  checkWorkflowRateLimit,
  safeJsonStringify,
  WorkflowExecutionStatus,
  validateFormInputs,
  type WorkflowRateLimitConfig,
  type WorkflowTriggerEvent,
} from '@auxx/lib/workflow-engine'
import { WorkflowTriggerSource, WorkflowRunStatus } from '@auxx/database/enums'
import {
  getSharedWorkflowByToken,
  verifyWorkflowPassport,
  incrementEndUserRunCount,
} from '@auxx/services/workflow-share'
import { SystemUserService } from '@auxx/lib/users'
import { WorkflowTriggerType } from '@auxx/lib/workflow-engine'

const logger = createScopedLogger('shared-workflow-run-api')

/**
 * POST /api/workflows/shared/[shareToken]/run
 * Execute a shared workflow and stream results via SSE
 *
 * Requires a valid passport token in Authorization header
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ shareToken: string }> }
) {
  const { shareToken } = await context.params

  // Get passport from header
  const authHeader = request.headers.get('authorization')
  const passportToken = authHeader?.replace('Bearer ', '')

  if (!passportToken) {
    return NextResponse.json({ error: 'Passport token required' }, { status: 401 })
  }

  // Verify passport
  const passportResult = await verifyWorkflowPassport(passportToken)

  if (passportResult.isErr()) {
    logger.warn('Invalid passport token', { error: passportResult.error })
    return NextResponse.json({ error: passportResult.error.message }, { status: 401 })
  }

  const passport = passportResult.value

  // Verify passport matches the requested share token
  if (passport.shareToken !== shareToken) {
    return NextResponse.json({ error: 'Invalid passport for this workflow' }, { status: 401 })
  }

  // Get shared workflow with published workflow data
  const workflowResult = await getSharedWorkflowByToken({
    shareToken,
    requireEnabled: true,
    includeGraph: false,
  })

  if (workflowResult.isErr()) {
    logger.warn('Shared workflow not found', { shareToken, error: workflowResult.error })
    return NextResponse.json({ error: workflowResult.error.message }, { status: 404 })
  }

  const sharedWorkflow = workflowResult.value

  // Get the published workflow from WorkflowApp
  const workflowApp = await database.query.WorkflowApp.findFirst({
    where: eq(schema.WorkflowApp.id, sharedWorkflow.id),
    with: {
      publishedWorkflow: true,
    },
  })

  if (!workflowApp?.publishedWorkflow) {
    return NextResponse.json({ error: 'Workflow has no published version' }, { status: 404 })
  }

  const publishedWorkflow = workflowApp.publishedWorkflow

  // Check rate limit
  const rateLimitResult = await checkWorkflowRateLimit({
    workflowAppId: sharedWorkflow.id,
    endUserId: passport.endUserId,
    rateLimit: sharedWorkflow.rateLimit as WorkflowRateLimitConfig | null,
  })

  if (rateLimitResult.isOk() && rateLimitResult.value.isLimited) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        retryAfterMs: rateLimitResult.value.remainingMs,
      },
      { status: 429 }
    )
  }

  // Parse inputs from request body
  const body = await request.json().catch(() => ({}))
  const { inputs = {} } = body

  // Validate inputs against form-input configurations before execution
  const validation = validateFormInputs(publishedWorkflow.graph, inputs)
  if (!validation.valid) {
    logger.warn('Form input validation failed', {
      shareToken,
      errors: validation.errors,
    })
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid inputs',
          details: validation.errors,
        },
      },
      { status: 400 }
    )
  }

  // Get next sequence number for workflow runs
  const [lastRun] = await database
    .select({ sequenceNumber: schema.WorkflowRun.sequenceNumber })
    .from(schema.WorkflowRun)
    .where(eq(schema.WorkflowRun.workflowAppId, sharedWorkflow.id))
    .orderBy(desc(schema.WorkflowRun.sequenceNumber))
    .limit(1)
  const sequenceNumber = (lastRun?.sequenceNumber ?? 0) + 1

  // Build graph to count nodes for progress tracking
  const graph = WorkflowGraphBuilder.buildGraph(publishedWorkflow)
  const nodeCount = graph.nodes.size

  // Get system user for this organization (public runs don't have authenticated users)
  const systemUserId = await SystemUserService.getSystemUserForActions(
    sharedWorkflow.organizationId
  )

  // Create workflow run record with PUBLIC_SHARE trigger source
  const [workflowRun] = await database
    .insert(schema.WorkflowRun)
    .values({
      organizationId: sharedWorkflow.organizationId,
      workflowAppId: sharedWorkflow.id,
      workflowId: publishedWorkflow.id,
      sequenceNumber,
      type: publishedWorkflow.triggerType || WorkflowTriggerType.MANUAL,
      triggeredFrom: WorkflowTriggerSource.PUBLIC_SHARE,
      version: publishedWorkflow.version.toString(),
      graph: publishedWorkflow.graph || {},
      inputs,
      status: WorkflowRunStatus.RUNNING,
      totalTokens: 0,
      totalSteps: nodeCount,
      createdBy: systemUserId,
      endUserId: passport.endUserId,
    })
    .returning()

  logger.info('Created shared workflow run', {
    workflowRunId: workflowRun!.id,
    workflowAppId: sharedWorkflow.id,
    endUserId: passport.endUserId,
    shareToken,
  })

  // Increment end user run count
  await incrementEndUserRunCount({ endUserId: passport.endUserId })

  // Update workflow app stats
  await database
    .update(schema.WorkflowApp)
    .set({
      totalRuns: (workflowApp.totalRuns || 0) + 1,
      lastRunAt: new Date(),
    })
    .where(eq(schema.WorkflowApp.id, sharedWorkflow.id))

  // Get showWorkflowDetails setting from config (default false for privacy)
  const showWorkflowDetails =
    (sharedWorkflow.config as WorkflowShareConfig | null)?.showWorkflowDetails ?? false

  /**
   * Filter and transform events for public consumption
   * When showWorkflowDetails is false:
   * - Only allow workflow-level events and end node events
   * - Strip outputs from WORKFLOW_FINISHED (contains all node variables for privacy)
   */
  const filterEventForPublic = (event: any): any | null => {
    // Always send these workflow-level events
    const alwaysAllowedEvents = [
      WorkflowEventType.RUN_CREATED,
      WorkflowEventType.WORKFLOW_STARTED,
      WorkflowEventType.WORKFLOW_FAILED,
      WorkflowEventType.WORKFLOW_CANCELLED,
      WorkflowEventType.WORKFLOW_PAUSED,
      WorkflowEventType.WORKFLOW_RESUMED,
      WorkflowEventType.ERROR,
    ]

    if (alwaysAllowedEvents.includes(event.event)) {
      return event
    }

    // WORKFLOW_FINISHED: Strip outputs (contains ALL node variables)
    if (event.event === WorkflowEventType.WORKFLOW_FINISHED) {
      return {
        ...event,
        data: {
          ...event.data,
          outputs: undefined, // Remove sensitive data
        },
      }
    }

    // If showWorkflowDetails is true, send all events unchanged
    if (showWorkflowDetails) {
      return event
    }

    // For NODE_STARTED / NODE_COMPLETED / NODE_FAILED, only send if it's an 'end' node
    if (
      event.event === WorkflowEventType.NODE_STARTED ||
      event.event === WorkflowEventType.NODE_COMPLETED ||
      event.event === WorkflowEventType.NODE_FAILED
    ) {
      const nodeType = event.data?.nodeType
      if (nodeType === 'end') {
        return event
      }
      return null // Filter out non-end node events
    }

    // Filter out other events (LOOP_*, etc.)
    return null
  }

  // Set up SSE streaming
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      /**
       * Send SSE event to client
       */
      const send = (event: any) => {
        controller.enqueue(
          encoder.encode(`event: ${event.event}\n` + `data: ${safeJsonStringify(event)}\n\n`)
        )
      }

      let cleanup: (() => Promise<void>) | null = null
      let router: RedisEventRouter | null = null
      let handlerId: string | null = null

      try {
        // Send initial run-created event
        send({
          event: WorkflowEventType.RUN_CREATED,
          workflowRunId: workflowRun!.id,
          timestamp: new Date().toISOString(),
          data: {
            id: workflowRun!.id,
            status: workflowRun!.status,
            sequenceNumber: workflowRun!.sequenceNumber,
          },
        })

        // Set up Redis event subscription
        router = RedisEventRouter.getInstance('shared-workflow-sse')
        logger.info('Setting up Redis event subscription for shared workflow', {
          workflowRunId: workflowRun!.id,
        })

        handlerId = await router.subscribeToWorkflowEvents(workflowRun!.id, (event: any) => {
          try {
            // Filter events based on showWorkflowDetails setting
            const filteredEvent = filterEventForPublic(event)
            if (!filteredEvent) {
              return // Skip this event
            }

            send(filteredEvent)

            // Auto-close on terminal events
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
            logger.error('Error handling shared workflow event', {
              error: error instanceof Error ? error.message : String(error),
              workflowRunId: workflowRun!.id,
            })
          }
        })

        // Create reporter for SSE events
        const reporter = new RedisWorkflowExecutionReporter(workflowRun!.id)

        // Initialize and execute workflow engine
        const workflowEngine = new WorkflowEngine()
        await workflowEngine.getNodeRegistry().initializeWithDefaults()

        // Create trigger event for execution
        const triggerEvent: WorkflowTriggerEvent = {
          type: (publishedWorkflow.triggerType ||
            WorkflowTriggerType.MANUAL) as WorkflowTriggerType,
          data: inputs,
          timestamp: new Date(),
          organizationId: sharedWorkflow.organizationId,
          userId: systemUserId,
        }

        // Execute workflow asynchronously
        workflowEngine
          .executeWorkflow(publishedWorkflow, triggerEvent, {
            debug: false,
            organizationId: sharedWorkflow.organizationId,
            workflowRunId: workflowRun!.id,
            workflowAppId: sharedWorkflow.id,
            reporter,
          })
          .then(async (result) => {
            // Update workflow run with results
            await database
              .update(schema.WorkflowRun)
              .set({
                outputs: result.context?.variables || {},
                status:
                  result.status === WorkflowExecutionStatus.COMPLETED
                    ? WorkflowRunStatus.SUCCEEDED
                    : WorkflowRunStatus.FAILED,
                error: result.error,
                elapsedTime: (Date.now() - new Date(workflowRun!.createdAt).getTime()) / 1000,
                finishedAt: new Date(),
              })
              .where(eq(schema.WorkflowRun.id, workflowRun!.id))
          })
          .catch(async (error) => {
            logger.error('Shared workflow execution failed', {
              error: error instanceof Error ? error.message : String(error),
              workflowRunId: workflowRun!.id,
            })

            // Update workflow run with error
            await database
              .update(schema.WorkflowRun)
              .set({
                status: WorkflowRunStatus.FAILED,
                error: error instanceof Error ? error.message : 'Workflow execution failed',
                finishedAt: new Date(),
              })
              .where(eq(schema.WorkflowRun.id, workflowRun!.id))

            send({
              event: WorkflowEventType.ERROR,
              workflowRunId: workflowRun!.id,
              timestamp: new Date().toISOString(),
              data: {
                message: error instanceof Error ? error.message : 'Workflow execution failed',
                code: 'WORKFLOW_EXECUTION_ERROR',
              },
            })
          })

        // Heartbeat
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(':heartbeat\n\n'))
          } catch {
            if (cleanup) cleanup()
          }
        }, 15000)

        // Cleanup function
        cleanup = async () => {
          clearInterval(heartbeat)

          if (router && handlerId) {
            try {
              await router.unsubscribe(handlerId)
              logger.info('Redis event subscription cleaned up', { handlerId })
            } catch (error) {
              logger.error('Error cleaning up Redis event subscription', {
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

        // Handle abort
        request.signal.addEventListener('abort', () => {
          if (cleanup) cleanup()
        })
      } catch (error) {
        logger.error('Failed to start shared workflow', {
          error: error instanceof Error ? error.message : String(error),
          shareToken,
        })

        send({
          event: WorkflowEventType.ERROR,
          workflowRunId: workflowRun?.id || 'unknown',
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
      'X-Run-Id': workflowRun?.id || '',
    },
  })
}
