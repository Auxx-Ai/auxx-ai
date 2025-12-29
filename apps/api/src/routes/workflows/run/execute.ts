// apps/api/src/routes/workflows/run/execute.ts

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { getWorkflowByApiKey } from '@auxx/services/workflow-share'
import { WorkflowExecutionService } from '@auxx/lib/workflows'
import {
  RedisWorkflowExecutionReporter,
  WorkflowEventType,
  validateFormInputs,
} from '@auxx/lib/workflow-engine'
import { safeJsonStringify } from '@auxx/lib/workflow-engine/utils/serialization'
import { RedisEventRouter } from '@auxx/redis'
import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { successResponse, errorResponse } from '../../../lib/response'

const logger = createScopedLogger('workflow-run-execute')

/**
 * Execute route for programmatic workflow execution
 * POST /api/v1/workflows/run
 */
const executeRoute = new Hono()

/**
 * Extract API key from Authorization header
 * Expects: Authorization: Bearer {api_key}
 */
function extractApiKey(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }
  return authHeader.slice(7)
}

/**
 * POST /api/v1/workflows/run
 * Execute a workflow with provided inputs
 * Requires API key authentication - workflow is identified by the API key
 */
executeRoute.post('/', async (c) => {
  const authHeader = c.req.header('Authorization')
  const apiKey = extractApiKey(authHeader)

  if (!apiKey) {
    return c.json(
      errorResponse('UNAUTHORIZED', 'Missing Authorization header. Expected: Bearer {api_key}'),
      401
    )
  }

  // Parse request body
  let body: {
    inputs?: Record<string, unknown>
    response_mode?: 'blocking' | 'streaming'
    user?: string
  }

  try {
    body = await c.req.json()
  } catch {
    return c.json(errorResponse('INVALID_REQUEST', 'Invalid JSON body'), 400)
  }

  const { inputs = {}, response_mode = 'blocking', user } = body

  // Get workflow by API key (validates key and checks apiEnabled)
  const workflowResult = await getWorkflowByApiKey({
    apiKey,
    includeGraph: true,
  })

  if (workflowResult.isErr()) {
    const error = workflowResult.error
    logger.warn('Failed to get workflow by API key for run', { error: error.code })

    if (error.code === 'INVALID_API_KEY') {
      return c.json(errorResponse(error.code, error.message), 401)
    }
    if (error.code === 'API_ACCESS_DISABLED') {
      return c.json(errorResponse(error.code, error.message), 403)
    }
    if (error.code === 'WORKFLOW_NOT_FOUND') {
      return c.json(errorResponse(error.code, error.message), 404)
    }
    if (error.code === 'WORKFLOW_DISABLED') {
      return c.json(errorResponse(error.code, error.message), 410)
    }
    return c.json(errorResponse('INTERNAL_ERROR', 'Failed to fetch workflow'), 500)
  }

  const workflow = workflowResult.value

  logger.info('API key validated for run', {
    workflowAppId: workflow.id,
    apiKeyId: workflow.apiKeyId,
  })

  // Validate inputs against form input configs if graph is available
  if (workflow.graph) {
    const validationResult = validateFormInputs(workflow.graph, inputs as Record<string, any>)
    if (!validationResult.valid) {
      return c.json(
        errorResponse('VALIDATION_ERROR', 'Input validation failed', {
          errors: validationResult.errors,
        }),
        400
      )
    }
  }

  // Check if workflow has a published version
  if (!workflow.publishedWorkflowId) {
    return c.json(
      errorResponse('WORKFLOW_NOT_PUBLISHED', 'Workflow has no published version'),
      400
    )
  }

  // Create execution service
  const executionService = new WorkflowExecutionService(database)

  try {
    // Create workflow run record
    const workflowRun = await executionService.createRun({
      workflowId: workflow.publishedWorkflowId,
      inputs: inputs as Record<string, any>,
      mode: 'production',
      userId: '', // No authenticated user for API access
      organizationId: workflow.organizationId,
    })

    logger.info('Workflow run created via API', {
      workflowRunId: workflowRun.id,
      workflowAppId: workflow.id,
      externalUserId: user,
    })

    // Execute workflow
    if (response_mode === 'streaming') {
      return handleStreamingExecution(c, workflowRun, executionService)
    }

    // Blocking mode - execute and wait for result
    return handleBlockingExecution(c, workflowRun, executionService)
  } catch (error) {
    logger.error('Failed to create or execute workflow run', {
      error: error instanceof Error ? error.message : String(error),
      workflowAppId: workflow.id,
    })
    return c.json(
      errorResponse('EXECUTION_ERROR', 'Failed to execute workflow'),
      500
    )
  }
})

/**
 * Handle blocking execution mode
 */
async function handleBlockingExecution(
  c: any,
  workflowRun: any,
  executionService: WorkflowExecutionService
) {
  const startTime = Date.now()
  const reporter = new RedisWorkflowExecutionReporter(workflowRun.id)

  try {
    await executionService.executeWorkflowAsync(workflowRun, reporter)

    // Wait for workflow to complete by polling the run status
    const maxWaitMs = 120000 // 2 minutes max wait
    const pollIntervalMs = 500

    let finalRun = workflowRun
    let elapsed = 0

    while (elapsed < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      elapsed += pollIntervalMs

      // Get updated run status
      const updatedRun = await database.query.WorkflowRun.findFirst({
        where: (runs, { eq }) => eq(runs.id, workflowRun.id),
      })

      if (!updatedRun) break

      finalRun = updatedRun

      // Check if workflow completed
      if (
        updatedRun.status === 'completed' ||
        updatedRun.status === 'failed' ||
        updatedRun.status === 'cancelled'
      ) {
        break
      }
    }

    const durationMs = Date.now() - startTime

    return c.json(
      successResponse({
        executionId: finalRun.id,
        status: finalRun.status,
        outputs: finalRun.output,
        duration_ms: durationMs,
      })
    )
  } catch (error) {
    logger.error('Blocking execution failed', {
      workflowRunId: workflowRun.id,
      error: error instanceof Error ? error.message : String(error),
    })

    return c.json(
      errorResponse('EXECUTION_ERROR', 'Workflow execution failed'),
      500
    )
  }
}

/**
 * Handle streaming execution mode with SSE
 */
async function handleStreamingExecution(
  c: any,
  workflowRun: any,
  executionService: WorkflowExecutionService
) {
  return streamSSE(c, async (stream) => {
    const router = RedisEventRouter.getInstance('workflow-api-sse')
    let handlerId: string | null = null

    try {
      // Send initial event
      await stream.writeSSE({
        event: 'started',
        data: safeJsonStringify({
          executionId: workflowRun.id,
          timestamp: new Date().toISOString(),
        }),
      })

      // Subscribe to workflow events
      handlerId = await router.subscribeToWorkflowEvents(workflowRun.id, async (event: any) => {
        try {
          await stream.writeSSE({
            event: event.event || event.type,
            data: safeJsonStringify(event.data || event),
          })

          // Close stream on terminal events
          if (
            [
              WorkflowEventType.WORKFLOW_FINISHED,
              WorkflowEventType.WORKFLOW_FAILED,
              WorkflowEventType.WORKFLOW_CANCELLED,
            ].includes(event.event || event.type)
          ) {
            // Wait a bit before closing to ensure event is sent
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
        } catch (error) {
          logger.error('Error writing SSE event', {
            error: error instanceof Error ? error.message : String(error),
            workflowRunId: workflowRun.id,
          })
        }
      })

      // Execute workflow with Redis reporter for events
      const reporter = new RedisWorkflowExecutionReporter(workflowRun.id)
      await executionService.executeWorkflowAsync(workflowRun, reporter)

      // Keep stream open for events (with timeout)
      const maxWaitMs = 300000 // 5 minutes max for streaming
      const startTime = Date.now()

      while (Date.now() - startTime < maxWaitMs) {
        // Check if workflow completed
        const run = await database.query.WorkflowRun.findFirst({
          where: (runs, { eq }) => eq(runs.id, workflowRun.id),
          columns: { status: true },
        })

        if (
          run?.status === 'completed' ||
          run?.status === 'failed' ||
          run?.status === 'cancelled'
        ) {
          break
        }

        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    } catch (error) {
      logger.error('Streaming execution error', {
        workflowRunId: workflowRun.id,
        error: error instanceof Error ? error.message : String(error),
      })

      await stream.writeSSE({
        event: 'error',
        data: safeJsonStringify({
          message: error instanceof Error ? error.message : 'Execution failed',
          code: 'EXECUTION_ERROR',
        }),
      })
    } finally {
      // Cleanup subscription
      if (handlerId && router) {
        try {
          await router.unsubscribe(handlerId)
        } catch (error) {
          logger.error('Error cleaning up event subscription', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
  })
}

export default executeRoute
