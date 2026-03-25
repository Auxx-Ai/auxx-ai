// apps/web/src/app/api/shopify/compliance/route.ts

import { configService } from '@auxx/credentials'
import { createScopedLogger } from '@auxx/logger'
import { createHmac, timingSafeEqual } from 'crypto'
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

function verifyHmac(body: string, hmacHeader: string, secret: string): boolean {
  const calculatedHmac = createHmac('sha256', secret).update(body).digest('base64')
  if (calculatedHmac.length !== hmacHeader.length) return false
  return timingSafeEqual(Buffer.from(calculatedHmac), Buffer.from(hmacHeader))
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

    if (!verifyHmac(body, hmacHeader, shopifySecret)) {
      logger.error('HMAC verification failed', { topic, shopDomain })
      return new Response(null, { status: 401 })
    }

    const payload = JSON.parse(body)

    switch (topic) {
      case 'customers/data_request':
        handleCustomerDataRequest(shopDomain, payload as CustomerDataRequestPayload)
        break
      case 'customers/redact':
        handleCustomerRedact(shopDomain, payload as CustomerRedactPayload)
        break
      case 'shop/redact':
        handleShopRedact(shopDomain, payload as ShopRedactPayload)
        break
    }

    return new Response(null, { status: 200 })
  } catch (error) {
    logger.error('Unhandled error in compliance webhook', { error })
    return new Response(null, { status: 401 })
  }
}

function handleCustomerDataRequest(shopDomain: string, payload: CustomerDataRequestPayload) {
  logger.info('Customer data request received', {
    shopDomain,
    shopId: payload.shop_id,
    customerId: payload.customer.id,
    customerEmail: payload.customer.email,
    ordersRequested: payload.orders_requested,
    dataRequestId: payload.data_request.id,
  })
  // TODO: Queue job to compile customer data and provide to merchant
}

function handleCustomerRedact(shopDomain: string, payload: CustomerRedactPayload) {
  logger.info('Customer redact request received', {
    shopDomain,
    shopId: payload.shop_id,
    customerId: payload.customer.id,
    customerEmail: payload.customer.email,
    ordersToRedact: payload.orders_to_redact,
  })
  // TODO: Queue job to anonymize/delete customer PII from:
  // - Workflow execution node outputs
  // - Old sync tables (ShopifyCustomer, Order, Address)
  // - Trigger data in workflow executions
}

function handleShopRedact(shopDomain: string, payload: ShopRedactPayload) {
  logger.info('Shop redact request received', {
    shopDomain,
    shopId: payload.shop_id,
  })
  // TODO: Queue job to delete all data for this shop:
  // - Workflow executions tied to this shop
  // - Old sync tables (ShopifyCustomer, Product, Order, Address)
  // - Webhook handlers, subscriptions, connection data
}
