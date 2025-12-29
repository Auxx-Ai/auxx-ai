// apps/web/src/app/api/workflows/[workflowId]/webhook/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createScopedLogger } from '@auxx/logger'
import { database as db, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import {
  WorkflowNodeType,
  WorkflowTriggerType,
  type WorkflowTriggerEvent,
} from '@auxx/lib/workflow-engine/types'
import { WorkflowEngine } from '@auxx/lib/workflow-engine'
import { getRedisClient } from '@auxx/redis'
import { filterSensitiveHeaders } from '@auxx/lib/utils'
import { v4 as uuidv4 } from 'uuid'
import { validateAgainstSchema } from '~/components/workflow/utils/schema-to-variable'
import type { WebhookTestEvent } from '~/components/workflow/nodes/core/webhook/types'

const logger = createScopedLogger('api.webhook')

// Initialize workflow engine
const workflowEngine = new WorkflowEngine()
const engineInitPromise = workflowEngine.getNodeRegistry().initializeWithDefaults()

/**
 * Common webhook handler for both GET and POST requests
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

          await redis.lpush(`webhook:test:${workflowId}:events`, JSON.stringify(webhookTestEvent))
          await redis.ltrim(`webhook:test:${workflowId}:events`, 0, 49)
          await redis.expire(`webhook:test:${workflowId}:events`, 300)
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

            await redis.lpush(`webhook:test:${workflowId}:events`, JSON.stringify(webhookTestEvent))
            await redis.ltrim(`webhook:test:${workflowId}:events`, 0, 49)
            await redis.expire(`webhook:test:${workflowId}:events`, 300)
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

    // Transform the workflow for the engine
    const engineWorkflow = {
      id: workflow.id,
      organizationId: workflowApp.organizationId,
      name: workflow.name,
      version: workflow.version,
      triggerType: WorkflowTriggerType.WEBHOOK,
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

        await redis.lpush(`webhook:test:${workflowId}:events`, JSON.stringify(webhookTestEvent))
        await redis.ltrim(`webhook:test:${workflowId}:events`, 0, 49)
        await redis.expire(`webhook:test:${workflowId}:events`, 300)
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

        await redis.lpush(
          `webhook:test:${params.workflowId}:events`,
          JSON.stringify(webhookTestEvent)
        )
        await redis.ltrim(`webhook:test:${params.workflowId}:events`, 0, 49)
        await redis.expire(`webhook:test:${params.workflowId}:events`, 300)
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
