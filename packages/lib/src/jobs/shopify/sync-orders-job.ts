// packages/lib/src/jobs/shopify/sync-orders-job.ts
import { database as db, schema } from '@auxx/database'
import type { Job } from 'bullmq'
import { eq } from 'drizzle-orm'
import { createShopifyAdminClient } from '../../shopify/shopify-webhooks'
import { OrderSync } from '../../shopify/sync-orders'
import { SyncManager } from '../../sync-manager'

export type SyncOrdersJobProps = { syncId: string; organizationId: string; integrationId: string }

export const syncOrdersJob = async (job: Job<SyncOrdersJobProps>) => {
  const { syncId, organizationId, integrationId } = job.data
  const syncJob = await SyncManager.start(syncId)

  const [integration = null] = await db
    .select()
    .from(schema.ShopifyIntegration)
    .where(eq(schema.ShopifyIntegration.id, integrationId))
    .limit(1)
  if (integration && integration.organizationId !== organizationId) {
    throw new Error('Integration does not belong to organization')
  }
  if (!integration) {
    throw new Error('No active Shopify integration found')
  }
  const client = createShopifyAdminClient(integration)

  const syncer = new OrderSync(client, db, organizationId, integrationId)

  try {
    const orders = await syncer.sync()

    await SyncManager.complete(syncJob.id, orders?.length || 0)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    await SyncManager.fail(syncJob.id, msg)

    throw error
  }
}
