// packages/lib/src/permissions/overage-handler.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { onCacheEvent } from '../cache'
import { createScopedLogger } from '../logger'
import { NotificationService } from '../notifications/notification-service'
import { type Overage, OverageDetectionService } from './overage-detection-service'

const logger = createScopedLogger('overage-handler')

/**
 * Shared handler called after any plan change that could result in overages.
 * Detects overages, notifies admins/owners, and invalidates caches.
 */
export async function handlePlanDowngrade(
  db: Database,
  organizationId: string,
  newPlanId: string
): Promise<void> {
  try {
    const service = new OverageDetectionService(db)
    const overages = await service.detectOverages(organizationId, newPlanId)

    if (overages.length === 0) {
      logger.debug('No overages detected after plan change', { organizationId, newPlanId })
      return
    }

    logger.info('Overages detected after plan change, notifying admins', {
      organizationId,
      newPlanId,
      overageCount: overages.length,
    })

    // Send notifications to all admins/owners in parallel with cache invalidation
    await Promise.all([
      sendOverageNotifications(db, organizationId, overages),
      onCacheEvent('plan.changed', { orgId: organizationId }),
    ])
  } catch (error) {
    // Don't let overage detection failures break the plan change flow
    logger.error('Failed to handle plan downgrade overages', {
      organizationId,
      newPlanId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Send overage notifications to all org admins and owners.
 */
async function sendOverageNotifications(
  db: Database,
  organizationId: string,
  overages: Overage[]
): Promise<void> {
  // Find all admins and owners
  const admins = await db
    .select({ userId: schema.OrganizationMember.userId })
    .from(schema.OrganizationMember)
    .where(
      and(
        eq(schema.OrganizationMember.organizationId, organizationId),
        eq(schema.OrganizationMember.status, 'ACTIVE'),
        inArray(schema.OrganizationMember.role, ['ADMIN', 'OWNER'])
      )
    )

  if (admins.length === 0) {
    logger.warn('No admins/owners found for overage notification', { organizationId })
    return
  }

  const featureList = overages
    .map((o) => `${o.label}: ${o.current}/${o.limit} (${o.excess} over)`)
    .join(', ')

  const message = `Your plan has changed and some features exceed the new limits: ${featureList}. Existing items are preserved but you cannot create new ones until you're within limits.`

  const notificationService = new NotificationService(db)

  await Promise.all(
    admins.map((admin) =>
      notificationService
        .sendNotification({
          type: 'SYSTEM_MESSAGE',
          userId: admin.userId,
          entityId: organizationId,
          entityType: 'organization',
          organizationId,
          message,
          data: { overages, type: 'PLAN_OVERAGE' },
        })
        .catch((error) => {
          logger.warn('Failed to send overage notification to admin', {
            userId: admin.userId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
    )
  )
}
