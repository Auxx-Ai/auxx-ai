// apps/api/src/routes/webhooks.ts

import { decryptValue } from '@auxx/credentials'
import { database, schema } from '@auxx/database'
import { invokeLambdaExecutor, prepareLambdaContext } from '@auxx/lib/apps'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import {
  dedupeWebhookEvent,
  normalizeHeaders,
  timingSafeStringEqual,
  verifyHmacSignature,
} from '@auxx/lib/webhooks'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { getWebhookHandler } from '@auxx/services/app-webhook-handlers'
import { getByPath } from '@auxx/utils'
import { createHash, randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { errorResponse } from '../lib/response'
import type { AppContext } from '../types/context'

const log = createScopedLogger('webhooks-receiver')

const webhooks = new Hono<AppContext>()

/** Reject deliveries larger than this — public, unauthenticated endpoint. */
const MAX_BODY_BYTES = 1_000_000 // 1 MB
/** Fixed-window rate limit per endpoint. */
const RATE_LIMIT_PER_MIN = 60

/**
 * Provider-agnostic inbound webhook ingress. ONE public URL per `WebhookEndpoint`
 * (bound to no app/connection — the id IS the capability). Verify over the RAW body
 * with the endpoint's own secret (none | token | hmac), dedupe ONCE, then fan the
 * single delivery to workflows + agents and return 200 fast. (Connector sink = phase 4.)
 */
async function handleWebhookEndpoint(c: any) {
  const endpointId = c.req.param('endpointId')

  // 0. Body cap on the declared length before reading (arbitrary public POST).
  const declaredLength = Number(c.req.header('content-length') ?? '0')
  if (declaredLength > MAX_BODY_BYTES) {
    return c.json(errorResponse('PAYLOAD_TOO_LARGE', 'Body exceeds 1 MB'), 413)
  }

  // 1. Read the raw body ONCE, before any parse — HMAC is over the raw bytes.
  const rawBody = await c.req.text()
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    return c.json(errorResponse('PAYLOAD_TOO_LARGE', 'Body exceeds 1 MB'), 413)
  }
  const headers = normalizeHeaders(c.req.raw.headers)

  try {
    // 2. Load the endpoint — the id resolves to exactly one org (no wrong-org check needed).
    const endpoint = await database.query.WebhookEndpoint.findFirst({
      where: (we, { eq }) => eq(we.id, endpointId),
      columns: {
        id: true,
        organizationId: true,
        verification: true,
        secret: true,
        signatureHeader: true,
        signaturePrefix: true,
        signatureEncoding: true,
        topicSource: true,
      },
    })
    if (!endpoint) {
      log.warn('Webhook endpoint: not found', { endpointId })
      return c.json(errorResponse('NOT_FOUND', 'Webhook endpoint not found'), 404)
    }

    // 3. Rate-limit per endpoint.
    if (await isEndpointRateLimited(endpointId)) {
      log.warn('Webhook endpoint: rate limited', { endpointId })
      return c.json(errorResponse('RATE_LIMITED', 'Too many requests'), 429)
    }

    // 4-5. Verify authenticity over the raw bytes (none | token | hmac).
    const queryToken = c.req.query('token')
    if (!verifyEndpointDelivery(endpoint, rawBody, headers, queryToken)) {
      log.warn('Webhook endpoint: verification failed', { endpointId })
      return c.json(errorResponse('UNAUTHORIZED', 'Invalid signature'), 401)
    }

    // 6. Idempotency — hash the raw body (no configured id header). Dedupe 5-min.
    const eventId = createHash('sha256').update(rawBody).digest('hex')
    const deduped = await dedupeWebhookEvent(
      'webhook-endpoint-dedup',
      `${endpointId}:${eventId}`,
      300
    )
    if (deduped) {
      log.info('Webhook endpoint: duplicate delivery, dropping', { endpointId, eventId })
      return c.json({ ok: true, duplicate: true }, 200)
    }

    // 7. Parse the verified body (non-JSON → keep the raw string).
    let payload: unknown
    try {
      payload = rawBody ? JSON.parse(rawBody) : null
    } catch {
      payload = rawBody
    }

    // 8. Optional topic extraction (header or JSON path) so one endpoint can multiplex.
    const topic = resolveEndpointTopic(endpoint.topicSource, headers, payload)

    // 9. Push to the inspector stream (per endpoint+topic), then fan out.
    await pushWebhookEndpointEvent(endpointId, topic, payload, eventId)
    const dispatched = await fanOutWebhookEndpoint({
      endpointId,
      organizationId: endpoint.organizationId,
      topic,
      triggerData: payload,
      eventId,
    })

    // 10/11. Stamp liveness (throttled to ≤1/min).
    await stampWebhookEndpointEvent(endpointId)

    log.info('Webhook endpoint accepted', { endpointId, eventId, topic, dispatched })
    return c.json({ ok: true, topic, dispatched }, 200)
  } catch (error: any) {
    log.error('Webhook endpoint receiver error', { error: error.message, endpointId })
    return c.json(errorResponse('INTERNAL_ERROR', 'Internal server error'), 500)
  }
}

/** Fixed-window per-endpoint rate limit. Redis down → allow (fail-open). */
async function isEndpointRateLimited(endpointId: string): Promise<boolean> {
  try {
    const redis = await getRedisClient(false)
    if (!redis) return false
    const key = `webhook-endpoint-rate:${endpointId}`
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, 60)
    return count > RATE_LIMIT_PER_MIN
  } catch {
    return false
  }
}

/**
 * Verify an inbound delivery against the endpoint's own secret. Reuses the canonical
 * timing-safe helpers (`verifyHmacSignature`, `timingSafeStringEqual`).
 *   none  → accept (open endpoint — the UI flags it)
 *   token → constant-time compare of a Bearer header / `?token=` against the secret
 *   hmac  → HMAC over the raw body, compared to the configured signature header
 */
function verifyEndpointDelivery(
  endpoint: {
    verification: 'none' | 'token' | 'hmac'
    secret: string | null
    signatureHeader: string | null
    signaturePrefix: string | null
    signatureEncoding: 'hex' | 'base64'
  },
  rawBody: string,
  headers: Record<string, string>,
  queryToken?: string
): boolean {
  if (endpoint.verification === 'none') return true

  const secret = decryptValue(endpoint.secret)
  if (!secret) return false

  if (endpoint.verification === 'token') {
    const auth = headers.authorization ?? ''
    const provided = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : (queryToken ?? '')
    return timingSafeStringEqual(provided, secret)
  }

  // hmac
  const header = (endpoint.signatureHeader ?? 'x-signature').toLowerCase()
  return verifyHmacSignature({
    rawBody,
    secret,
    signature: headers[header],
    prefix: endpoint.signaturePrefix ?? undefined,
    encoding: endpoint.signatureEncoding,
  })
}

/** Extract the topic from a header or a JSON path (absent ⇒ '' ⇒ matches every filter). */
function resolveEndpointTopic(
  topicSource: { kind: 'header' | 'path'; value: string } | null,
  headers: Record<string, string>,
  payload: unknown
): string {
  if (!topicSource) return ''
  if (topicSource.kind === 'header') return headers[topicSource.value.toLowerCase()] ?? ''
  const value = getByPath(payload, topicSource.value)
  if (value == null) return ''
  return typeof value === 'string' ? value : String(value)
}

/**
 * Fan one verified delivery to the workflow + agent + connector-sink dispatch jobs on
 * the app-trigger queue. Keyed on `(endpointId, topic)`.
 */
async function fanOutWebhookEndpoint(input: {
  endpointId: string
  organizationId: string
  topic: string
  triggerData: unknown
  eventId: string
}): Promise<boolean> {
  const { endpointId, organizationId, topic, triggerData, eventId } = input
  const dispatchPayload = { endpointId, topic, triggerData, eventId, organizationId }
  try {
    const appTriggerQueue = getQueue(Queues.appTriggerQueue)
    await appTriggerQueue.add('dispatchWebhookEndpoint', dispatchPayload)
    await appTriggerQueue.add('dispatchWebhookEndpointToAgents', dispatchPayload)
    await appTriggerQueue.add('dispatchWebhookEndpointToConnectors', dispatchPayload)
  } catch (dispatchError: any) {
    log.error('Failed to enqueue webhook endpoint dispatch', {
      error: dispatchError.message,
      endpointId,
      topic,
    })
    return false
  }
  return true
}

/** Store a delivery in Redis for the webhook-endpoint delivery inspector (SSE). */
async function pushWebhookEndpointEvent(
  endpointId: string,
  topic: string,
  payload: unknown,
  eventId: string
): Promise<void> {
  try {
    const redis = await getRedisClient(false)
    if (!redis) return
    const redisKey = `webhook-endpoint:${endpointId}:${topic}:events`
    const event = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      source: 'webhook',
      topic,
      triggerData: payload,
      eventId,
    }
    await redis.lpush(redisKey, JSON.stringify(event))
    await redis.ltrim(redisKey, 0, 49)
    await redis.expire(redisKey, 300)
  } catch (redisError: any) {
    log.warn('Failed to store webhook endpoint event in Redis', {
      error: redisError.message,
      endpointId,
      topic,
    })
  }
}

/** Stamp `lastEventAt` on the endpoint, throttled to ≤1/min per endpoint via Redis NX. */
async function stampWebhookEndpointEvent(endpointId: string): Promise<void> {
  try {
    const redis = await getRedisClient(false)
    if (redis) {
      const fresh = await redis.set(`webhook-endpoint-stamp:${endpointId}`, '1', 'EX', 60, 'NX')
      if (!fresh) return
    }
    await database
      .update(schema.WebhookEndpoint)
      .set({ lastEventAt: new Date() })
      .where(eq(schema.WebhookEndpoint.id, endpointId))
  } catch (error: any) {
    log.warn('Failed to stamp webhook endpoint lastEventAt', { error: error.message, endpointId })
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
        // Third consumer (sync bridge): fan to webhook-sync data connectors bound
        // to this (connection, trigger). plans/data-connectors/v4.
        await appTriggerQueue.add('dispatchAppTriggerToConnectors', dispatchPayload)

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

// Provider-agnostic inbound webhook endpoint — registered first so `endpoint`
// is never captured as an `:installationId`.
webhooks.post('/endpoint/:endpointId', handleWebhookEndpoint)

// Support both POST and GET (for webhook verification)
// Connection-scoped routes (must be registered first to avoid ambiguity)
webhooks.post('/:installationId/:handlerId/:connectionId', handleWebhookRequest)
webhooks.get('/:installationId/:handlerId/:connectionId', handleWebhookRequest)
// Legacy routes (no connectionId)
webhooks.post('/:installationId/:handlerId', handleWebhookRequest)
webhooks.get('/:installationId/:handlerId', handleWebhookRequest)

export default webhooks
