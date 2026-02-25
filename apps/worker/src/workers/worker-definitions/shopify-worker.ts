import {
  customerWebhookJob,
  orderWebhookJob,
  productWebhookJob,
  syncCustomersJob,
  syncOrdersJob,
  syncProductsJob,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  syncCustomersJob,
  syncOrdersJob,
  syncProductsJob,
  productWebhookJob,
  customerWebhookJob,
  orderWebhookJob,
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
