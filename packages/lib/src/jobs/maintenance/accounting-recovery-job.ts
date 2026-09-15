// packages/lib/src/jobs/maintenance/accounting-recovery-job.ts
import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import { sweepCustomerReceiptAccounting } from '../../money/customer-money/accounting'
import { sweepImportedCustomerMoney } from '../../money/customer-money/ingest'
import { sweepFulfillmentAccountingWork } from '../../money/fulfillment-posting/run'
import { sweepAccountingDeliveries } from '../../postings/delivery'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('accounting-recovery-job')
const CURSOR_KEY = 'accounting.fulfillmentRecoveryCursor'

/** Rotate bounded organization/source pages so queue loss cannot strand accounting work. */
export async function accountingRecoveryJob(ctx: JobContext): Promise<void> {
  const organizations = await database
    .select({ id: schema.Organization.id, cursor: schema.OrganizationSetting.value })
    .from(schema.Organization)
    .leftJoin(
      schema.OrganizationSetting,
      and(
        eq(schema.OrganizationSetting.organizationId, schema.Organization.id),
        eq(schema.OrganizationSetting.key, CURSOR_KEY)
      )
    )
    .orderBy(sql`${schema.OrganizationSetting.updatedAt} ASC NULLS FIRST`, schema.Organization.id)
    .limit(25)
  const deadline = Date.now() + 45_000
  let processed = 0
  for (const organization of organizations) {
    if (Date.now() >= deadline) break
    processed++
    const previous = typeof organization.cursor === 'string' ? organization.cursor : undefined
    let nextCursor = previous ?? null
    await saveCursor(organization.id, nextCursor)
    try {
      const result = await sweepFulfillmentAccountingWork(database, {
        organizationId: organization.id,
        afterId: previous,
        limit: 100,
      })
      nextCursor = result.nextCursor
      await saveCursor(organization.id, nextCursor)
    } catch (error) {
      logger.warn('Fulfillment recovery needs retry', {
        organizationId: organization.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    try {
      await sweepImportedCustomerMoney(database, organization.id, 100)
    } catch (error) {
      logger.warn('Imported payment recovery needs retry', {
        organizationId: organization.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    if (Date.now() < deadline) {
      try {
        await sweepCustomerReceiptAccounting(database, {
          organizationId: organization.id,
          limit: 100,
          timeBudgetMs: deadline - Date.now(),
        })
      } catch (error) {
        logger.warn('Payment accounting recovery needs retry', {
          organizationId: organization.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    try {
      await sweepAccountingDeliveries(database, {
        organizationId: organization.id,
        limit: 5,
        timeBudgetMs: Math.max(1, deadline - Date.now()),
      })
    } catch (error) {
      logger.warn('Accounting delivery recovery needs retry', {
        organizationId: organization.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  logger.info('Accounting recovery page finished', {
    jobId: ctx.jobId,
    organizations: processed,
  })
}

/** Rotate before slow provider work and persist source progress independently of delivery. */
async function saveCursor(organizationId: string, value: string | null) {
  await database
    .insert(schema.OrganizationSetting)
    .values({ organizationId, key: CURSOR_KEY, value, scope: 'GENERAL', updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.OrganizationSetting.organizationId, schema.OrganizationSetting.key],
      set: { value, updatedAt: new Date() },
    })
}
