import { database as db } from '@auxx/database'
import { ShopifyIntegrationModel } from '@auxx/database/models'
import { CustomerSync, createShopifyAdminClient, SyncManager } from '@auxx/lib/shopify'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'

const logger = createScopedLogger('sync-customers')

export type SyncCustomersJobProps = {
  syncId: string
  organizationId: string
  integrationId: string
}

export const syncCustomersJob = async (job: Job<SyncCustomersJobProps>) => {
  const { syncId, organizationId, integrationId } = job.data
  const syncJob = await SyncManager.start(syncId)

  const intModel = new ShopifyIntegrationModel()
  const intRes = await intModel.findByIdGlobal(integrationId)
  const integration = intRes.ok ? intRes.value : null
  if (integration && integration.organizationId !== organizationId) {
    logger.error('Integration does not belong to organization', { organizationId, integrationId })
    throw new Error('Integration does not belong to organization')
  }
  if (!integration) {
    logger.error('No active Shopify integration found for organization', {
      organizationId,
      integrationId,
    })
    throw new Error('No active Shopify integration found')
  }
  const client = createShopifyAdminClient(integration)
  const syncer = new CustomerSync(client, db, organizationId, integrationId)

  try {
    const customers = await syncer.sync()

    await SyncManager.complete(syncJob.id, customers?.length || 0)
    // return { result: 'success', records: customers?.length }
  } catch (error: unknown) {
    let msg: string = 'Unknown error'
    if (typeof error === 'string') {
      msg = error
    } else if (error instanceof Error) {
      msg = error.message
    }
    await SyncManager.fail(syncJob.id, msg)

    logger.error('Error syncing customers:', { msg })
    throw error
  }
}
