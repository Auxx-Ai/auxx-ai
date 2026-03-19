// packages/lib/src/jobs/maintenance/demo-seed-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { isDemoEnabled } from '../../demo'

const logger = createScopedLogger('demo-seed')

export interface DemoSeedJobData {
  organizationId: string
  userId: string
  userEmail: string
}

/**
 * Job handler for seeding demo-specific data (customers, tickets, etc.) asynchronously.
 *
 * NOTE: The base org seeding (tags, inboxes, templates, etc.) is already handled by
 * the better-auth user.create hook → seedNewUserDatabase → OrganizationSeeder.seedNewOrganization.
 * This job only seeds additional demo-specific data on top of that.
 *
 * TODO: Wire up packages/seed OrganizationSeeder to populate demo customers, tickets,
 * products, orders, and workflows here.
 */
export const demoSeedJob = async (job: Job<DemoSeedJobData>) => {
  if (!isDemoEnabled()) {
    logger.info('Demo disabled, skipping seed')
    return { success: false, reason: 'demo_disabled' }
  }

  const { organizationId, userId } = job.data

  logger.info('Starting demo-specific data seed', { organizationId, userId })

  try {
    // TODO: Seed demo-specific data (customers, tickets, products, workflows)
    // from packages/seed scenarios once available.
    // e.g.:
    // const { OrganizationSeeder: ScenarioSeeder } = await import('@auxx/seed')
    // await scenarioSeeder.seedOrganization(organizationId, 'demo')

    logger.info('Demo-specific data seed completed', { organizationId })
    return { success: true, organizationId }
  } catch (error) {
    logger.error('Failed to seed demo-specific data', { organizationId, error })
    throw error
  }
}
