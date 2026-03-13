// packages/lib/src/organizations/backfill-forwarding-integrations.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { isNotNull } from 'drizzle-orm'
import { OrganizationService } from './organization-service'

const logger = createScopedLogger('backfill-forwarding-integrations')

/**
 * Backfill forwarding address integration for a single organization.
 * Idempotent — ensureForwardingAddressIntegration handles create-or-update.
 */
export async function backfillForwardingIntegration(
  db: Database,
  organizationId: string
): Promise<string | null> {
  const org = await db.query.Organization.findFirst({
    where: (o, { eq }) => eq(o.id, organizationId),
    columns: { id: true, handle: true, createdById: true },
  })

  if (!org) {
    logger.warn(`Organization ${organizationId} not found, skipping`)
    return null
  }

  if (!org.handle) {
    logger.warn(`Organization ${organizationId} has no handle, skipping`)
    return null
  }

  const service = new OrganizationService(db)
  const integrationId = await service.ensureForwardingAddressIntegration({
    organizationId: org.id,
    userId: org.createdById,
    handle: org.handle,
  })

  logger.info(`Backfilled forwarding integration for org ${organizationId}`, { integrationId })
  return integrationId
}

/**
 * Backfill forwarding address integrations for ALL organizations with a handle.
 */
export async function backfillAllOrgsForwardingIntegrations(db: Database): Promise<number> {
  const orgs = await db
    .select({ id: schema.Organization.id })
    .from(schema.Organization)
    .where(isNotNull(schema.Organization.handle))

  logger.info(`Found ${orgs.length} organizations with handles to backfill`)

  let successCount = 0

  for (const org of orgs) {
    try {
      const result = await backfillForwardingIntegration(db, org.id)
      if (result) successCount++
    } catch (error) {
      logger.error(`Failed to backfill org ${org.id}`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  logger.info(`Backfill complete: ${successCount}/${orgs.length} organizations processed`)
  return successCount
}
