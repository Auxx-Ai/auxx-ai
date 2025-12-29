import { createShopifyAdminClient, OrderSync, SyncManager } from '@auxx/lib/shopify'
import { database as db } from '@auxx/database'
import { ShopifyIntegrationModel } from '@auxx/database/models'
import type { Job } from 'bullmq'

export type SyncOrdersJobProps = { syncId: string; organizationId: string; integrationId: string }

export const syncOrdersJob = async (job: Job<SyncOrdersJobProps>) => {
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
