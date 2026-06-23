// apps/api/src/routes/webhooks.ts

import { database } from '@auxx/database'
import { invokeLambdaExecutor, prepareLambdaContext } from '@auxx/lib/apps'
import {
  connectorFor,
  type DataConnectorConfig,
  enqueueConnectorWebhook,
  resolveWebhookCapability,
} from '@auxx/lib/data-connectors'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { getConnectorWebhookHandler, getWebhookHandler } from '@auxx/services/app-webhook-handlers'
import { createHash, randomUUID, timingSafeEqual } from 'crypto'
import { Hono } from 'hono'
import { errorResponse } from '../lib/response'
import type { AppContext } from '../types/context'

const log = createScopedLogger('webhooks-receiver')

const webhooks = new Hono<AppContext>()

/**
 * Data-connector webhook ingress (Step 8A). Built-in connectors (generic-rest /
 * Shopify / Stripe) push here. Verify (connector-driven HMAC over the RAW body),
 * dedupe by the provider event id, resolve the delivery into sink actions, enqueue,
 * and return 200 fast — the entity writes happen in the worker (W2), so a slow sink
 * never makes the provider retry.
 */
async function handleConnectorWebhook(c: any) {
  const connectorId = c.req.param('connectorId')

  // Read the raw body ONCE, before any parse — HMAC is computed over raw bytes (W1).
  const rawBody = await c.req.text()
  const headers: Record<string, string> = {}
  c.req.raw.headers.forEach((value: string, key: string) => {
    headers[key.toLowerCase()] = value
  })

  try {
    const connector = await database.query.DataConnector.findFirst({
      where: (dc, { eq }) => eq(dc.id, connectorId),
    })
    if (!connector) {
      log.warn('Connector webhook: connector not found', { connectorId })
      return c.json(errorResponse('NOT_FOUND', 'Connector not found'), 404)
    }

    // App-connector webhooks (verify/resolve in the app lambda) aren't handled here.
    if (connector.type.startsWith('app:')) {
      log.warn('Connector webhook: app-connector ingress not supported on this route', {
        connectorId,
      })
      return c.json(errorResponse('NOT_FOUND', 'Unsupported connector webhook'), 404)
    }

    const handlerResult = await getConnectorWebhookHandler({ dataConnectorId: connectorId })
    if (handlerResult.isErr()) {
      log.warn('Connector webhook: no handler registered', { connectorId })
      return c.json(errorResponse('NOT_FOUND', 'Webhook not registered'), 404)
    }
    const secret = parseConnectorSecret(handlerResult.value.metadata)

    const definition = connectorFor(connector.type)
    const capability = resolveWebhookCapability(connector.config as DataConnectorConfig, definition)
    if (!capability) {
      log.warn('Connector webhook: connector has no webhook capability', { connectorId })
      return c.json(errorResponse('NOT_FOUND', 'No webhook capability'), 404)
    }

    // 1. Verify authenticity over the raw bytes.
    if (!capability.verify({ rawBody, headers, secret })) {
      log.warn('Connector webhook: signature verification failed', { connectorId })
      return c.json(errorResponse('UNAUTHORIZED', 'Invalid signature'), 401)
    }

    // 2. Dedupe by the provider event id (fallback: a hash of the body).
    const eventId =
      capability.eventId({ rawBody, headers }) ?? createHash('sha256').update(rawBody).digest('hex')
    const deduped = await dedupeWebhook(connectorId, eventId)
    if (deduped) {
      log.info('Connector webhook: duplicate delivery, dropping', { connectorId, eventId })
      return c.json({ ok: true, duplicate: true }, 200)
    }

    // 3. Resolve into sink actions (pure). Parse the body now that it's verified.
    let payload: unknown = null
    try {
      payload = rawBody ? JSON.parse(rawBody) : null
    } catch {
      payload = null
    }
    const actions = capability.resolveWebhook({ headers, payload })

    // 4. Enqueue the sink work; return 200 immediately (W2).
    if (actions.length > 0) {
      await enqueueConnectorWebhook({
        connectorId,
        organizationId: connector.organizationId,
        actions,
        eventId,
      })
    }
    log.info('Connector webhook accepted', { connectorId, eventId, actions: actions.length })
    return c.json({ ok: true, actions: actions.length }, 200)
  } catch (error: any) {
    log.error('Connector webhook receiver error', { error: error.message, connectorId })
    return c.json(errorResponse('INTERNAL_ERROR', 'Internal server error'), 500)
  }
}

/** Read the signing secret out of the connector handler row's `{ secret }` metadata. */
function parseConnectorSecret(metadata: string | null): string | null {
  if (!metadata) return null
  try {
    return (JSON.parse(metadata) as { secret?: string }).secret ?? null
  } catch {
    return null
  }
}

/** Receiver-level idempotency: SET NX with a TTL. Returns true when already seen. */
async function dedupeWebhook(connectorId: string, eventId: string): Promise<boolean> {
  try {
    const redis = await getRedisClient(false)
    if (!redis) return false // Redis down → process (better a dup than a miss; sink dedupes too)
    const key = `data-connector-webhook-dedup:${connectorId}:${eventId}`
    const set = await redis.set(key, '1', 'EX', 600, 'NX')
    return !set
  } catch {
    return false
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

// Data-connector webhook ingress (Step 8A) — registered first so `data-connector`
// is never captured as an `:installationId`.
webhooks.post('/data-connector/:connectorId', handleConnectorWebhook)

// Support both POST and GET (for webhook verification)
// Connection-scoped routes (must be registered first to avoid ambiguity)
webhooks.post('/:installationId/:handlerId/:connectionId', handleWebhookRequest)
webhooks.get('/:installationId/:handlerId/:connectionId', handleWebhookRequest)
// Legacy routes (no connectionId)
webhooks.post('/:installationId/:handlerId', handleWebhookRequest)
webhooks.get('/:installationId/:handlerId', handleWebhookRequest)

export default webhooks
