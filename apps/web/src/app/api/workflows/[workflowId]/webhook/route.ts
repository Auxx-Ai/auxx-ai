// apps/web/src/app/api/workflows/[workflowId]/webhook/route.ts

import { database as db } from '@auxx/database'
import { WorkflowEngine } from '@auxx/lib/workflow-engine'
import {
  WorkflowNodeType,
  type WorkflowTriggerEvent,
  WorkflowTriggerType,
} from '@auxx/lib/workflow-engine/types'
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

// Initialize workflow engine
const workflowEngine = new WorkflowEngine()
const engineInitPromise = workflowEngine.getNodeRegistry().initializeWithDefaults()

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

    // Ensure the workflow engine is initialized
    await engineInitPromise

    // Prepare trigger data - the data that will be available in the workflow
    const webhookData = {
      method,
      ...(method === 'POST' ? { body } : {}),
      query: Object.fromEntries(searchParams),
      headers: Object.fromEntries(req.headers.entries()),
    }

    // Create trigger event with webhook data
    const triggerEvent: WorkflowTriggerEvent = {
      type: WorkflowTriggerType.WEBHOOK,
      data: webhookData,
      timestamp: new Date(),
      organizationId: workflowApp.organizationId,
      userId: workflowApp.createdById || undefined,
    }

    // Transform the workflow for the engine.
    //
    // `graph` is the load-bearing key: `WorkflowGraphBuilder.buildGraph` reads
    // `workflow.graph || { nodes: [], edges: [] }` and NOTHING else. Passing
    // only the top-level `nodes`/`edges` (as this did) built an empty graph, so
    // `findEntryNode` returned undefined, the engine threw "No entry point found
    // in workflow", and the caller still got the configured 200 back — every
    // published webhook workflow was a silent no-op. `executeWorkflow` takes
    // `any` ("accept raw database format"), so nothing caught it at build time.
    // The top-level pair stays because `toEngineFormat` sets both.
    const engineWorkflow = {
      id: workflow.id,
      organizationId: workflowApp.organizationId,
      name: workflow.name,
      version: workflow.version,
      triggerType: WorkflowTriggerType.WEBHOOK,
      graph: { nodes: workflowGraph.nodes, edges: workflowGraph.edges || [] },
      nodes: workflowGraph.nodes,
      edges: workflowGraph.edges || [],
      enabled: true,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
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

    // Production mode - execute workflow
    const result = await workflowEngine.executeWorkflow(engineWorkflow, triggerEvent, {
      debug: false,
      variables: { workflowId: workflow.id, workflowAppId: workflowApp.id },
    })

    logger.info('Webhook workflow executed', {
      workflowId,
      executionId: result.executionId,
      status: result.status,
    })

    // Return configured response or default
    const responseConfig = webhookNode.data?.responseConfig
    const responseStatus = responseConfig?.statusCode || 200
    return new NextResponse(responseConfig?.body || 'OK', {
      status: responseStatus,
      headers: responseConfig?.headers || {},
    })
  } catch (error) {
    logger.error(`Error handling webhook ${method} request`, { error })

    // Store error event for test mode
    const { searchParams } = new URL(req.url)
    const isTest = searchParams.get('test') === 'true'

    if (isTest) {
      const redis = await getRedisClient(true)
      if (redis) {
        // Update event with error response
        webhookTestEvent.responseStatus = 500
        webhookTestEvent.responseTime = Date.now() - startTime

        await redis.lpush(webhookTestEventsKey(workflowId), JSON.stringify(webhookTestEvent))
        await redis.ltrim(webhookTestEventsKey(workflowId), 0, 49)
        await redis.expire(webhookTestEventsKey(workflowId), WEBHOOK_TEST_WINDOW_TTL_SECONDS)
      }
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
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
