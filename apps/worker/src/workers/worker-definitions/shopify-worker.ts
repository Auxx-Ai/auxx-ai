import { Queues } from '@auxx/lib/queues/types'
import * as jobs from '@auxx/lib/jobs/definitions'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  syncCustomersJob: jobs.syncCustomersJob,
  syncOrdersJob: jobs.syncOrdersJob,
  syncProductsJob: jobs.syncProductsJob,
  productWebhookJob: jobs.productWebhookJob,
  customerWebhookJob: jobs.customerWebhookJob,
  orderWebhookJob: jobs.orderWebhookJob,
}

export function startShopifyWorker() {
  return createWorker(Queues.shopifyQueue, jobMappings)
}

/**
 *
 * How to add the job to the queue:
 *
 * shopifyQueue.add('syncCustomersJob', {
 *    syncId: 'syncId',
 *    organizationId: 'organizationId',
 *    integrationId: 'integrationId',
 *})
 *
 */
