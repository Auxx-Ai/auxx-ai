import { database as db } from '@auxx/database'
import { ShopifyIntegrationModel } from '@auxx/database/models'
import type { Job } from 'bullmq'
import { createShopifyAdminClient } from '../../shopify/shopify-webhooks'
import { ProductSync } from '../../shopify/sync-products'
import { SyncManager } from '../../sync-manager'

export type SyncProductsJobProps = { syncId: string; organizationId: string; integrationId: string }

export const syncProductsJob = async (job: Job<SyncProductsJobProps>) => {
  const { syncId, organizationId, integrationId } = job.data
  const syncJob = await SyncManager.start(syncId)

  const intModel = new ShopifyIntegrationModel()
  const intRes = await intModel.findByIdGlobal(integrationId)
  const integration = intRes.ok ? intRes.value : null
  if (integration && integration.organizationId !== organizationId) {
    throw new Error('Integration does not belong to organization')
  }
  if (!integration) {
    throw new Error('No active Shopify integration found')
  }

  const client = createShopifyAdminClient(integration)

  const syncer = new ProductSync(client, db, organizationId, integrationId)
  try {
    const products = await syncer.sync()

    await SyncManager.complete(syncJob.id, products.length || 0)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    await SyncManager.fail(syncJob.id, msg)

    throw error
  }
}
