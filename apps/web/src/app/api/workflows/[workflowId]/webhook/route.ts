// apps/web/src/app/api/workflows/[workflowId]/webhook/route.ts

import { database as db } from '@auxx/database'
import { WorkflowTriggerSource } from '@auxx/database/enums'
import { UsageLimitError } from '@auxx/lib/errors'
import { RedisWorkflowExecutionReporter } from '@auxx/lib/workflow-engine'
import { WorkflowNodeType } from '@auxx/lib/workflow-engine/types'
import { WorkflowExecutionService } from '@auxx/lib/workflows'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { filterSensitiveHeaders } from '@auxx/utils/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import type { WebhookTestEvent } from '~/components/workflow/nodes/core/webhook/types'
import { validateAgainstSchema } from '~/components/workflow/utils/schema-to-variable'
import {
  isWebhookTestWindowArmed,
  WEBHOOK_TEST_WINDOW_TTL_SECONDS,
  webhookTestEventsKey,
} from '~/server/lib/webhook-test-window'

const logger = createScopedLogger('api.webhook')

/**
 * Common webhook handler for both GET and POST requests.
 *
 * The PRODUCTION path is intentionally unauthenticated — URL secrecy is the
 * normal webhook contract and external callers have no session. The `?test=true`
 * path is different: it resolves the org's **draft** graph, answers from that
 * unpublished node's response config, and appends the caller's headers/query/body
 * to the author's live event log. That is only allowed while an editor-armed
 * listening window is open (see `webhook-test-window.ts` and the
 * `workflow.armWebhookTest` mutation that opens it).
 */
async function handleWebhookRequest(
  req: NextRequest,
  params: { workflowId: string },
  method: 'GET' | 'POST'
) {
  const startTime = Date.now()
  const { workflowId } = params
  const { searchParams } = new URL(req.url)
  const isTest = searchParams.get('test') === 'true'

  // Prepare webhook test event data early for error handling
  let body = null
  if (method === 'POST') {
    try {
      body = await req.json()
    } catch {
      body = null
    }
  }

  const eventId = uuidv4()
  const webhookTestEvent: WebhookTestEvent = {
    id: eventId,
    timestamp: new Date().toISOString(),
    method,
    headers: filterSensitiveHeaders(Object.fromEntries(req.headers.entries())),
    query: Object.fromEntries(searchParams),
    body,
    responseStatus: undefined, // Will be set after execution
    responseTime: undefined, // Will be set after execution
  }

  try {
    logger.info(`Webhook ${method} request received`, { workflowId, isTest })

    // Draft execution requires an open listening window. Answering with the
    // SAME 404 the missing-draft case already returns keeps the endpoint from
    // becoming an oracle for "this workflow id exists" — and it runs BEFORE the
    // workflow lookup, so an unarmed caller can neither execute the draft nor
    // push an entry into the author's event log.
    if (isTest && !(await isWebhookTestWindowArmed(workflowId))) {
      logger.warn('Webhook test request rejected — no listening window armed', { workflowId })
      return NextResponse.json({ error: 'No draft workflow found' }, { status: 404 })
    }

    // Find the workflow app with appropriate workflow (draft for test, published for production)
    const workflowApp = await db.query.WorkflowApp.findFirst({
      where: (workflowApp, { eq }) => eq(workflowApp.id, workflowId),
      with: {
        draftWorkflow: true,
        publishedWorkflow: true,
      },
    })

    if (!workflowApp) {
      logger.warn('Workflow app not found', { workflowId })
      return NextResponse.json({ error: 'Workflow app not found' }, { status: 404 })
    }

    // Use draft workflow for test mode, published for production
    const workflow = isTest ? workflowApp.draftWorkflow : workflowApp.publishedWorkflow

    if (!workflow) {
      logger.warn('No active workflow found', {
        workflowId,
        isTest,
        hasDraft: !!workflowApp.draftWorkflow,
        hasPublished: !!workflowApp.publishedWorkflow,
      })
      return NextResponse.json(
        { error: isTest ? 'No draft workflow found' : 'No published workflow found' },
        { status: 404 }
      )
    }

    // Get workflow graph which contains nodes and edges
    const workflowGraph = workflow.graph as any

    // Log the graph structure for debugging
    logger.info('Workflow graph structure', {
      workflowId,
      hasGraph: !!workflowGraph,
      graphType: typeof workflowGraph,
      graphKeys: workflowGraph ? Object.keys(workflowGraph) : null,
    })

    if (!workflowGraph?.nodes) {
      logger.error('Invalid workflow graph - missing nodes', { workflowId, graph: workflowGraph })

      // Store error event for test mode
      if (isTest) {
        const redis = await getRedisClient(true)
        if (redis) {
          webhookTestEvent.responseStatus = 500
          webhookTestEvent.responseTime = Date.now() - startTime

          await redis.lpush(webhookTestEventsKey(workflowId), JSON.stringify(webhookTestEvent))
          await redis.ltrim(webhookTestEventsKey(workflowId), 0, 49)
          await redis.expire(webhookTestEventsKey(workflowId), WEBHOOK_TEST_WINDOW_TTL_SECONDS)
        }
      }

      return NextResponse.json({ error: 'Invalid workflow definition' }, { status: 500 })
    }

    // Find webhook trigger node
    const webhookNode = workflowGraph.nodes.find(
      (node: any) => node.data.type === WorkflowNodeType.WEBHOOK
    )

    if (!webhookNode) {
      logger.warn('No webhook trigger found in workflow', { workflowId })
      return NextResponse.json({ error: 'No webhook trigger found' }, { status: 404 })
    }

    // Verify the correct HTTP method
    if (webhookNode.data?.method !== method) {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
    }

    // Validate request body against schema if configured (for POST)
    if (
      method === 'POST' &&
      webhookNode.data?.bodySchema?.enabled &&
      webhookNode.data?.bodySchema?.schema
    ) {
      const isValid = validateAgainstSchema(body, webhookNode.data.bodySchema.schema)
      if (!isValid) {
        logger.warn('Request body validation failed', {
          workflowId,
          isTest,
          body,
          schema: webhookNode.data.bodySchema.schema,
        })

        // Store validation error event for test mode
        if (isTest) {
          const redis = await getRedisClient(true)
          if (redis) {
            webhookTestEvent.responseStatus = 400
            webhookTestEvent.responseTime = Date.now() - startTime

            await redis.lpush(webhookTestEventsKey(workflowId), JSON.stringify(webhookTestEvent))
            await redis.ltrim(webhookTestEventsKey(workflowId), 0, 49)
            await redis.expire(webhookTestEventsKey(workflowId), WEBHOOK_TEST_WINDOW_TTL_SECONDS)
          }
        }

        return NextResponse.json(
          { error: 'Invalid request body - does not match schema' },
          { status: 400 }
        )
      }
    }

    // Prepare trigger data - the data that will be available in the workflow
    const webhookData = {
      method,
      ...(method === 'POST' ? { body } : {}),
      query: Object.fromEntries(searchParams),
      headers: Object.fromEntries(req.headers.entries()),
    }

    // In test mode, skip execution and just capture the event
    if (isTest) {
      const responseConfig = webhookNode.data?.responseConfig
      const responseStatus = responseConfig?.statusCode || 200

      // Store test event
      const redis = await getRedisClient(true)
      if (redis) {
        webhookTestEvent.responseStatus = responseStatus
        webhookTestEvent.responseTime = Date.now() - startTime

        await redis.lpush(webhookTestEventsKey(workflowId), JSON.stringify(webhookTestEvent))
        await redis.ltrim(webhookTestEventsKey(workflowId), 0, 49)
        await redis.expire(webhookTestEventsKey(workflowId), WEBHOOK_TEST_WINDOW_TTL_SECONDS)
      }

      return new NextResponse(responseConfig?.body || 'OK', {
        status: responseStatus,
        headers: responseConfig?.headers || {},
      })
    }

    // Production mode — execute through the same door every other headless
    // trigger uses. This route used to hand-build a workflow object and call
    // `WorkflowEngine.executeWorkflow` directly, so a webhook execution created
    // no `WorkflowRun` row: it never appeared in run history, never counted
    // against the org's `workflowRuns` quota, and a paused node (wait, human
    // confirmation) had no run to resume. `createRun` owns all three.
    const executionService = new WorkflowExecutionService(db)
    const workflowRun = await executionService.createRun({
      workflowId: workflow.id,
      inputs: webhookData,
      mode: 'production',
      // Headless: an external caller is not a user. `createWorkflowRun`
      // resolves the org's system user — never substitute an id here.
      userId: null,
      organizationId: workflowApp.organizationId,
      triggeredFrom: WorkflowTriggerSource.WEBHOOK,
    })

    // The reporter is what persists node executions and publishes progress; the
    // old direct call passed none, so a webhook run had no per-node trace either.
    const reporter = new RedisWorkflowExecutionReporter(workflowRun.id)

    // Awaited, as before — the caller's response has always been sent after the
    // workflow finished. A thrown execution error is recorded on the run row by
    // `executeWorkflowAsync` before it rethrows; the caller still gets the
    // author's configured response, because that response is the webhook's
    // contract with the sender and a non-2xx makes senders like Shopify or
    // Stripe retry a request that will fail again.
    await executionService.executeWorkflowAsync(workflowRun, reporter).catch((error) => {
      logger.error('Webhook workflow execution failed', {
        workflowId,
        workflowRunId: workflowRun.id,
        error: error instanceof Error ? error.message : String(error),
      })
    })

    logger.info('Webhook workflow executed', {
      workflowId,
      workflowRunId: workflowRun.id,
    })

    // Return configured response or default
    const responseConfig = webhookNode.data?.responseConfig
    const responseStatus = responseConfig?.statusCode || 200
    return new NextResponse(responseConfig?.body || 'OK', {
      status: responseStatus,
      headers: responseConfig?.headers || {},
    })
  } catch (error) {
    // A run the org has no quota for is a refusal, not a server fault. This
    // route creates runs now, so it is the first webhook path that can hit the
    // plan limit — answer with the error's own status so a sender can tell
    // "you are over your limit" from "we broke".
    const isUsageLimit = error instanceof UsageLimitError
    const status = isUsageLimit ? error.statusCode : 500

    if (isUsageLimit) {
      logger.warn('Webhook workflow run refused — plan limit reached', {
        workflowId,
        metric: error.metric,
        current: error.current,
        limit: error.limit,
      })
    } else {
      logger.error(`Error handling webhook ${method} request`, { error })
    }

    // Store error event for test mode
    const { searchParams } = new URL(req.url)
    const isTest = searchParams.get('test') === 'true'

    if (isTest) {
      const redis = await getRedisClient(true)
      if (redis) {
        // Update event with error response
        webhookTestEvent.responseStatus = status
        webhookTestEvent.responseTime = Date.now() - startTime

        await redis.lpush(webhookTestEventsKey(workflowId), JSON.stringify(webhookTestEvent))
        await redis.ltrim(webhookTestEventsKey(workflowId), 0, 49)
        await redis.expire(webhookTestEventsKey(workflowId), WEBHOOK_TEST_WINDOW_TTL_SECONDS)
      }
    }

    return NextResponse.json(
      { error: isUsageLimit ? error.message : 'Internal server error' },
      { status }
    )
  }
}

/**
 * Handle GET requests to webhook endpoint
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const resolvedParams = await params
  return handleWebhookRequest(req, resolvedParams, 'GET')
}

/**
 * Handle POST requests to webhook endpoint
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const resolvedParams = await params
  return handleWebhookRequest(req, resolvedParams, 'POST')
}
