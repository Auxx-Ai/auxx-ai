// apps/api/src/routes/webhooks.ts

import { database } from '@auxx/database'
import { invokeLambdaExecutor, prepareLambdaContext } from '@auxx/lib/apps'
import {
  enqueueConnectorWebhook,
  resolveConnectionWebhookCapability,
  type WebhookAction,
} from '@auxx/lib/data-connectors'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import { dedupeWebhookEvent, normalizeHeaders } from '@auxx/lib/webhooks'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { getConnectionWebhookHandler, getWebhookHandler } from '@auxx/services/app-webhook-handlers'
import { createHash, randomUUID, timingSafeEqual } from 'crypto'
import { Hono } from 'hono'
import { errorResponse } from '../lib/response'
import type { AppContext } from '../types/context'

const log = createScopedLogger('webhooks-receiver')

const webhooks = new Hono<AppContext>()

/**
 * Unified connection webhook ingress (Direction 2). ONE endpoint per connection;
 * every provider delivery (Shopify `orders/create`, Stripe `customer.updated`) lands
 * here. Verify (HMAC over the RAW body) + dedupe ONCE, then fan the single delivery
 * to every bound consumer — the data-connector sink, workflows, and agents — and
 * return 200 fast (W2). The capability resolves from the CONNECTION's provider, so a
 * connection can carry triggers with no data connector.
 */
async function handleConnectionWebhook(c: any) {
  const connectionId = c.req.param('connectionId')

  // Read the raw body ONCE, before any parse — HMAC is computed over raw bytes (W1).
  const rawBody = await c.req.text()
  const headers = normalizeHeaders(c.req.raw.headers)

  try {
    const connection = await database.query.Credential.findFirst({
      where: (cred, { eq }) => eq(cred.id, connectionId),
      columns: { id: true, type: true, organizationId: true },
    })
    if (!connection) {
      log.warn('Connection webhook: connection not found', { connectionId })
      return c.json(errorResponse('NOT_FOUND', 'Connection not found'), 404)
    }

    const handlerResult = await getConnectionWebhookHandler({ connectionId })
    if (handlerResult.isErr()) {
      log.warn('Connection webhook: no handler registered', { connectionId })
      return c.json(errorResponse('NOT_FOUND', 'Webhook not registered'), 404)
    }
    const secret = parseWebhookSecret(handlerResult.value.metadata)

    const capability = resolveConnectionWebhookCapability({ type: connection.type })
    if (!capability) {
      log.warn('Connection webhook: connection provider has no webhook capability', {
        connectionId,
        provider: connection.type,
      })
      return c.json(errorResponse('NOT_FOUND', 'No webhook capability'), 404)
    }

    // 1. Verify authenticity over the raw bytes.
    if (!capability.verify({ rawBody, headers, secret })) {
      log.warn('Connection webhook: signature verification failed', { connectionId })
      return c.json(errorResponse('UNAUTHORIZED', 'Invalid signature'), 401)
    }

    // 2. Dedupe ONCE at the connection level (fallback: a hash of the body). The sink
    //    job + trigger dispatch jobs keep their own dedupe (defense in depth).
    const eventId =
      capability.eventId({ rawBody, headers }) ?? createHash('sha256').update(rawBody).digest('hex')
    const deduped = await dedupeWebhookEvent(
      'connection-webhook-dedup',
      `${connectionId}:${eventId}`
    )
    if (deduped) {
      log.info('Connection webhook: duplicate delivery, dropping', { connectionId, eventId })
      return c.json({ ok: true, duplicate: true }, 200)
    }

    // 3. Parse the verified body; resolve the topic + sink actions (pure, one source).
    let payload: unknown = null
    try {
      payload = rawBody ? JSON.parse(rawBody) : null
    } catch {
      payload = null
    }
    const topic = capability.resolveTopic({ headers, payload })
    const actions = capability.resolveWebhook({ headers, payload })

    // 4. Push the delivery to the inspector stream (per connection+topic), then fan out.
    await pushConnectionWebhookEvent(connectionId, topic, payload, eventId)
    const counts = await fanOutConnectionWebhook({
      connectionId,
      organizationId: connection.organizationId,
      topic,
      payload,
      actions,
      eventId,
    })

    log.info('Connection webhook accepted', { connectionId, eventId, topic, ...counts })
    return c.json({ ok: true, topic, ...counts }, 200)
  } catch (error: any) {
    log.error('Connection webhook receiver error', { error: error.message, connectionId })
    return c.json(errorResponse('INTERNAL_ERROR', 'Internal server error'), 500)
  }
}

/** Read the signing secret out of a webhook handler row's `{ secret }` metadata. */
function parseWebhookSecret(metadata: string | null): string | null {
  if (!metadata) return null
  try {
    return (JSON.parse(metadata) as { secret?: string }).secret ?? null
  } catch {
    return null
  }
}

/**
 * Fan one verified delivery to every bound consumer on the connection:
 *   • SINK     — each webhook DataConnector on the connection (the sink job drops
 *                actions for streams it doesn't map, so fanning to N is safe).
 *   • WORKFLOW — the `(connectionId, topic)` webhook-trigger dispatch job.
 *   • AGENT    — the `(connectionId, topic)` agent webhook-trigger dispatch job.
 */
async function fanOutConnectionWebhook(input: {
  connectionId: string
  organizationId: string
  topic: string
  payload: unknown
  actions: WebhookAction[]
  eventId: string
}): Promise<{ sinkJobs: number; dispatched: boolean }> {
  const { connectionId, organizationId, topic, payload, actions, eventId } = input

  // SINK — bound webhook connectors on this connection.
  let sinkJobs = 0
  if (actions.length > 0) {
    const connectors = await database.query.DataConnector.findMany({
      where: (dc, { and, eq }) =>
        and(
          eq(dc.organizationId, organizationId),
          eq(dc.credentialId, connectionId),
          eq(dc.syncBehavior, 'webhook')
        ),
      columns: { id: true },
    })
    for (const connector of connectors) {
      await enqueueConnectorWebhook({ connectorId: connector.id, organizationId, actions, eventId })
      sinkJobs++
    }
  }

  // WORKFLOW + AGENT — reuse the app-trigger fan-out queue with sibling job names.
  const dispatchPayload = { connectionId, topic, triggerData: payload, eventId, organizationId }
  try {
    const appTriggerQueue = getQueue(Queues.appTriggerQueue)
    await appTriggerQueue.add('dispatchConnectionWebhook', dispatchPayload)
    await appTriggerQueue.add('dispatchConnectionWebhookToAgents', dispatchPayload)
  } catch (dispatchError: any) {
    log.error('Failed to enqueue connection webhook dispatch', {
      error: dispatchError.message,
      connectionId,
      topic,
    })
    return { sinkJobs, dispatched: false }
  }
  return { sinkJobs, dispatched: true }
}

/** Store a delivery in Redis for the connection-webhook delivery inspector (SSE). */
async function pushConnectionWebhookEvent(
  connectionId: string,
  topic: string,
  payload: unknown,
  eventId: string
): Promise<void> {
  try {
    const redis = await getRedisClient(false)
    if (!redis) return
    const redisKey = `connection-webhook:${connectionId}:${topic}:events`
    const testEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      source: 'webhook',
      topic,
      triggerData: payload,
      eventId,
    }
    await redis.lpush(redisKey, JSON.stringify(testEvent))
    await redis.ltrim(redisKey, 0, 49)
    await redis.expire(redisKey, 300)
  } catch (redisError: any) {
    log.warn('Failed to store connection webhook event in Redis', {
      error: redisError.message,
      connectionId,
      topic,
    })
  }
}

/**
 * Handle webhook request (both POST and GET for verification)
 */
async function handleWebhookRequest(c: any) {
  const installationId = c.req.param('installationId')
  const handlerId = c.req.param('handlerId')
  const connectionId = c.req.param('connectionId') as string | undefined

  log.info('Webhook request received', { installationId, handlerId, method: c.req.method })

  try {
    // 1. Validate webhook handler exists
    const handlerResult = await getWebhookHandler({
      appInstallationId: installationId,
      handlerId,
      connectionId,
    })

    if (handlerResult.isErr()) {
      log.warn('Webhook handler not found', { installationId, handlerId })
      return c.json(errorResponse('NOT_FOUND', 'Webhook handler not found'), 404)
    }

    // 2. Validate webhook secret if present in handler metadata
    const handler = handlerResult.value
    let metadata: Record<string, unknown> | undefined
    if (handler.metadata) {
      try {
        metadata =
          typeof handler.metadata === 'string' ? JSON.parse(handler.metadata) : handler.metadata
      } catch {
        log.warn('Failed to parse webhook handler metadata', { handlerId })
      }
    }

    if (metadata?.secretToken) {
      const headerToken = c.req.header('x-telegram-bot-api-secret-token')
      const expected = Buffer.from(String(metadata.secretToken))
      const received = Buffer.from(headerToken ?? '')

      if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        log.warn('Webhook secret token mismatch', { installationId, handlerId })
        return c.json(errorResponse('UNAUTHORIZED', 'Invalid secret token'), 401)
      }
    }

    // 3. Get app installation with current deployment and bundles
    const installation = await database.query.AppInstallation.findFirst({
      where: (inst, { eq }) => eq(inst.id, installationId),
      with: {
        organization: {
          columns: {
            id: true,
            handle: true,
          },
        },
        currentDeployment: {
          with: {
            serverBundle: true,
          },
        },
      },
    })

    if (!installation || !installation.currentDeployment) {
      log.error('Installation not found or no active deployment', { installationId })
      return c.json(errorResponse('NOT_FOUND', 'Installation not found'), 404)
    }

    const { currentDeployment } = installation
    const serverBundleSha = currentDeployment.serverBundle.sha256

    // 4. Convert request to serializable format
    const body = await c.req.text()
    const headers: Record<string, string> = {}
    c.req.raw.headers.forEach((value: string, key: string) => {
      headers[key] = value
    })

    const webRequest = {
      method: c.req.method,
      url: c.req.url,
      headers,
      body,
    }

    log.info('Invoking Lambda for webhook execution', { handlerId })

    // 5. Build context and invoke Lambda via shared helper
    const context = prepareLambdaContext({
      appId: installation.appId,
      installationId,
      organizationId: installation.organizationId,
      organizationHandle: installation.organization.handle,
      userId: 'system',
      userEmail: null,
      userName: null,
    })

    const lambdaResult = await invokeLambdaExecutor({
      caller: 'webhook-route',
      payload: {
        type: 'webhook',
        serverBundleSha,
        appId: installation.appId,
        handlerId,
        request: webRequest,
        context,
      },
    })

    if (lambdaResult.isErr()) {
      const error = lambdaResult.error
      log.error('Webhook execution failed', { error, installationId, handlerId })
      return c.json(errorResponse('EXECUTION_ERROR', 'Webhook execution failed'), 500)
    }

    const result = lambdaResult.value

    // 6. Return handler's response to third-party service
    const handlerExecutionResult = result.execution_result

    log.info('Webhook execution completed', {
      status: handlerExecutionResult.status,
      installationId,
      handlerId,
    })

    // 7. If handler returned trigger data and handler has a triggerId, enqueue
    //    dispatch jobs. One emit → two consumers (workflows + agents). Mirrors
    //    the polling-trigger-job side; see plans/kopilot/apps/app-triggers-brainstorm.md §2.
    if (handlerExecutionResult.triggerData && handler.triggerId) {
      const dispatchPayload = {
        appInstallationId: installationId,
        appId: installation.appId,
        triggerId: handler.triggerId,
        connectionId: handler.connectionId ?? undefined,
        triggerData: handlerExecutionResult.triggerData,
        eventId: handlerExecutionResult.eventId || randomUUID(),
        organizationId: installation.organizationId,
      }

      try {
        const appTriggerQueue = getQueue(Queues.appTriggerQueue)
        await appTriggerQueue.add('dispatchAppTrigger', dispatchPayload)
        await appTriggerQueue.add('dispatchAppTriggerToAgents', dispatchPayload)

        log.info('Enqueued app trigger dispatch', {
          installationId,
          appId: installation.appId,
          triggerId: handler.triggerId,
          eventId: handlerExecutionResult.eventId,
        })
      } catch (dispatchError: any) {
        // Don't fail the webhook response if dispatch fails — log and continue
        log.error('Failed to enqueue app trigger dispatch', {
          error: dispatchError.message,
          installationId,
          handlerId,
          triggerId: handler.triggerId,
        })
      }

      // Store trigger event in Redis for the test event SSE stream
      try {
        const redis = await getRedisClient(false)
        if (redis) {
          const redisKey = `app-trigger-test:${installationId}:${handler.triggerId}:events`
          const testEvent = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            source: 'webhook',
            triggerData: handlerExecutionResult.triggerData,
            eventId: handlerExecutionResult.eventId,
          }
          await redis.lpush(redisKey, JSON.stringify(testEvent))
          await redis.ltrim(redisKey, 0, 49)
          await redis.expire(redisKey, 300)
        }
      } catch (redisError: any) {
        // Don't fail the webhook response if Redis write fails
        log.warn('Failed to store trigger test event in Redis', {
          error: redisError.message,
          installationId,
          triggerId: handler.triggerId,
        })
      }
    }

    return new Response(handlerExecutionResult.body, {
      status: handlerExecutionResult.status,
      headers: handlerExecutionResult.headers || {},
    })
  } catch (error: any) {
    log.error('Webhook receiver error', { error: error.message, installationId, handlerId })
    return c.json(errorResponse('INTERNAL_ERROR', 'Internal server error'), 500)
  }
}

// Unified connection webhook ingress (Direction 2) — registered first so `connection`
// is never captured as an `:installationId`.
webhooks.post('/connection/:connectionId', handleConnectionWebhook)

// Support both POST and GET (for webhook verification)
// Connection-scoped routes (must be registered first to avoid ambiguity)
webhooks.post('/:installationId/:handlerId/:connectionId', handleWebhookRequest)
webhooks.get('/:installationId/:handlerId/:connectionId', handleWebhookRequest)
// Legacy routes (no connectionId)
webhooks.post('/:installationId/:handlerId', handleWebhookRequest)
webhooks.get('/:installationId/:handlerId', handleWebhookRequest)

export default webhooks
