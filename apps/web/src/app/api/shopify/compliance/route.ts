// apps/web/src/app/api/shopify/compliance/route.ts
//
// Shopify's three mandatory compliance webhooks, wired onto the same
// `DataDeletionRequest` module that backs the Meta deletion/deauthorize
// callbacks (plans/channels/meta-data-deletion-callback.md §6).
//
// ⚠️ SCOPE: this is the TRANSPORT half only — the request is recorded, a job is
// enqueued, and the `status` column makes the outstanding obligation auditable.
// The actual redaction bodies are NOT implemented; see the
// `TODO(shopify-redact)` block in `@auxx/lib/data-deletion`'s `execute.ts`,
// which parks these three kinds in `processing` rather than `completed` so an
// auditor sees an open obligation instead of a false claim that we handled it.

import { configService } from '@auxx/credentials'
import { database as db } from '@auxx/database'
import { createDeletionRequest, type DataDeletionKind } from '@auxx/lib/data-deletion'
import { enqueueDataDeletionJob } from '@auxx/lib/jobs'
import { shopifyPreset, verifyWebhook } from '@auxx/lib/webhooks'
import { createScopedLogger } from '@auxx/logger'
import type { NextRequest } from 'next/server'

const logger = createScopedLogger('shopify/compliance')

type ComplianceTopic = 'customers/data_request' | 'customers/redact' | 'shop/redact'

const COMPLIANCE_TOPICS: ComplianceTopic[] = [
  'customers/data_request',
  'customers/redact',
  'shop/redact',
]

interface CustomerDataRequestPayload {
  shop_id: number
  shop_domain: string
  orders_requested: number[]
  customer: { id: number; email: string; phone: string }
  data_request: { id: number }
}

interface CustomerRedactPayload {
  shop_id: number
  shop_domain: string
  customer: { id: number; email: string; phone: string }
  orders_to_redact: number[]
}

interface ShopRedactPayload {
  shop_id: number
  shop_domain: string
}

export const POST = async (req: NextRequest) => {
  try {
    const topic = req.headers.get('x-shopify-topic') as ComplianceTopic | null
    const hmacHeader = req.headers.get('x-shopify-hmac-sha256')
    const shopDomain = req.headers.get('x-shopify-shop-domain')

    if (!topic || !hmacHeader || !shopDomain) {
      logger.error('Missing required headers', { topic, shopDomain, hasHmac: !!hmacHeader })
      return new Response(null, { status: 401 })
    }

    if (!COMPLIANCE_TOPICS.includes(topic)) {
      logger.error('Unknown compliance topic', { topic })
      return new Response(null, { status: 401 })
    }

    const body = await req.text()

    const shopifySecret = configService.get<string>('SHOPIFY_API_SECRET') as string
    if (!shopifySecret) {
      logger.error('SHOPIFY_API_SECRET not configured')
      return new Response(null, { status: 401 })
    }

    const verified = verifyWebhook(shopifyPreset, {
      rawBody: body,
      headers: { 'x-shopify-hmac-sha256': hmacHeader },
      secret: shopifySecret,
    })
    if (!verified) {
      logger.error('HMAC verification failed', { topic, shopDomain })
      return new Response(null, { status: 401 })
    }

    const payload = JSON.parse(body)

    // Awaited deliberately, where the old handlers were fire-and-forget. Both
    // steps are a single insert plus one Redis `add` — milliseconds — while an
    // un-awaited promise in a serverless request can be torn down the moment we
    // return, losing the row entirely. Acking a redaction we never recorded is
    // precisely the bug this route is fixing, so the ack now waits for the
    // durable write. `recordComplianceRequest` never throws.
    let recorded: boolean
    switch (topic) {
      case 'customers/data_request':
        recorded = await handleCustomerDataRequest(
          shopDomain,
          payload as CustomerDataRequestPayload
        )
        break
      case 'customers/redact':
        recorded = await handleCustomerRedact(shopDomain, payload as CustomerRedactPayload)
        break
      case 'shop/redact':
        recorded = await handleShopRedact(shopDomain, payload as ShopRedactPayload)
        break
    }

    // A failed row write is the one case we must NOT ack: 200 would tell Shopify
    // the obligation is ours and then drop it. Non-2xx makes Shopify redeliver.
    if (!recorded) return new Response(null, { status: 500 })

    return new Response(null, { status: 200 })
  } catch (error) {
    logger.error('Unhandled error in compliance webhook', { error })
    return new Response(null, { status: 401 })
  }
}

/**
 * Record one compliance request and hand the teardown to the worker.
 *
 * Returns `false` only when the audit row could not be written — the caller
 * turns that into a non-2xx so Shopify redelivers. A failed *enqueue* is not
 * fatal: the row is the durable obligation and the job can be re-driven from
 * it, so we ack and log loudly instead of forcing a duplicate row.
 */
async function recordComplianceRequest(
  kind: DataDeletionKind,
  externalId: string,
  context: Record<string, unknown>
): Promise<boolean> {
  const created = await createDeletionRequest(db, { provider: 'shopify', externalId, kind })
  if (created.isErr()) {
    logger.error('Failed to record Shopify compliance request', {
      ...context,
      kind,
      externalId,
      error: created.error.message,
    })
    return false
  }

  const { id, confirmationCode } = created.value
  logger.info('Recorded Shopify compliance request', {
    ...context,
    kind,
    externalId,
    requestId: id,
    confirmationCode,
  })

  try {
    await enqueueDataDeletionJob({ requestId: id })
  } catch (error) {
    logger.error('Recorded Shopify compliance request but failed to enqueue teardown', {
      requestId: id,
      kind,
      error,
    })
  }

  return true
}

/**
 * `customers/data_request` — the merchant's customer asked what we hold.
 *
 * TODO(shopify-redact): compile the data we hold for that customer and provide
 * it to the merchant. Not implemented; the row stays `processing`.
 */
async function handleCustomerDataRequest(
  shopDomain: string,
  payload: CustomerDataRequestPayload
): Promise<boolean> {
  return recordComplianceRequest('customer_data_request', String(payload.customer.id), {
    shopDomain,
    shopId: payload.shop_id,
    customerEmail: payload.customer.email,
    ordersRequested: payload.orders_requested,
    dataRequestId: payload.data_request.id,
  })
}

/**
 * `customers/redact` — erase one customer's PII.
 *
 * TODO(shopify-redact): anonymize/delete that customer's PII from
 * - Workflow execution node outputs
 * - Old sync tables (ShopifyCustomer, Order, Address)
 * - Trigger data in workflow executions
 *
 * That list names three areas and does NOT claim to be complete — the real work
 * needs an inventory of every table holding Shopify PII (plan §6, open question
 * §9.3). Not implemented; the row stays `processing`.
 */
async function handleCustomerRedact(
  shopDomain: string,
  payload: CustomerRedactPayload
): Promise<boolean> {
  return recordComplianceRequest('customer_redact', String(payload.customer.id), {
    shopDomain,
    shopId: payload.shop_id,
    customerEmail: payload.customer.email,
    ordersToRedact: payload.orders_to_redact,
  })
}

/**
 * `shop/redact` — the shop uninstalled 48h ago; erase everything.
 *
 * Keyed on `shop_domain`, not the numeric `shop_id`: the domain is what the
 * Shopify connection is identified by everywhere else.
 *
 * TODO(shopify-redact): delete all data for this shop
 * - Workflow executions tied to this shop
 * - Old sync tables (ShopifyCustomer, Product, Order, Address)
 * - Webhook handlers, subscriptions, connection data
 *
 * Not implemented; the row stays `processing`.
 */
async function handleShopRedact(shopDomain: string, payload: ShopRedactPayload): Promise<boolean> {
  return recordComplianceRequest('shop_redact', payload.shop_domain, {
    shopDomain,
    shopId: payload.shop_id,
  })
}
