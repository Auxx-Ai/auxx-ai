// apps/web/src/app/api/sync/[...slug]/route.ts

import { database as db, schema } from '@auxx/database'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import { SyncManager } from '@auxx/lib/shopify'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { auth } from '~/auth/server'

// type Props = { params: Promise<{ type: string }> }

const PROVIDERS = ['shopify', 'google']

const jobTypes: { [key: string]: string } = {
  shopify_sync_customers: 'syncCustomersJob',
  shopify_sync_orders: 'syncOrdersJob',
  shopify_sync_products: 'syncProductsJob',
  // shopify_sync_all: 'syncAllJob'
}

/**
 * Handle sync trigger requests for various providers.
 * Starts background jobs for Shopify and others using SyncManager and queues.
 */
export const GET = async (req: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session?.user?.id
  const organizationId = session?.user?.defaultOrganizationId

  // const integrationId = null
  if (!userId || !organizationId) {
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  }

  const [integration] = await db
    .select()
    .from(schema.ShopifyIntegration)
    .where(eq(schema.ShopifyIntegration.organizationId, organizationId))
    .limit(1)

  const integrationId = integration?.id

  if (!integrationId) {
    return Response.json({ error: 'INTEGRATION_NOT_FOUND' }, { status: 404 })
  }

  const headerList = await headers()
  const searchParams = req.nextUrl.searchParams
  const query = searchParams.get('query')

  // const res = await req.json()

  const { slug } = await params

  // const type = slug[0] ?? 'shopify'
  const provider = slug[0] as string
  const action = slug[1] ?? 'all'
  if (!PROVIDERS.includes(provider)) {
    return Response.json({ error: 'INVALID_PROVIDER' }, { status: 400 })
  }

  // const syncId = await addToProcessOrderQueue(userId, provider, action)
  // e.g. shopify_sync_products
  const type = `${provider}_sync_${action}`
  //cm7l0yinl000110g65s4v7sgt
  try {
    const sync = await SyncManager.create({ organizationId, type, integrationId })
    const syncId = sync.id
    // const syncId = 'cm7l0yinl000110g65s4v7sgt'
    // await syncQueue.add(type, { syncId, userId })
    if (provider === 'shopify') {
      // sync
      // syncCustomersJob / syncOrdersJob / syncProductsJob
      const shopifyQueue = getQueue(Queues.shopifyQueue)
      shopifyQueue.add(jobTypes[type], { syncId, organizationId, integrationId })
    }

    return Response.json({ syncId, message: 'Sync started' }, { status: 200 })
  } catch (error) {
    console.error('error occured', error)
    return Response.json({ status: 400 })
  }
}
