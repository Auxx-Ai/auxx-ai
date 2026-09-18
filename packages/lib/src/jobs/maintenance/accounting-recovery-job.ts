// packages/lib/src/jobs/maintenance/accounting-recovery-job.ts
import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import { sweepExportBatches } from '../../accounting/export'
import { sweepCustomerReceiptAccounting } from '../../accounting/money/customer-money/accounting'
import { sweepFinancialRecordBridge } from '../../accounting/money/customer-money/bridge-sweep'
import { sweepDepositApplicationAccounting } from '../../accounting/money/customer-money/deposit-application-accounting'
import { sweepImportedCustomerMoney } from '../../accounting/money/customer-money/ingest'
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
    // The rotation cursor no longer tracks a fulfillment sweep - a native
    // shipment posts inside `fulfill.ts`'s own write now (step 1b, TARGET §1),
    // so there is no batch/effect backlog left to page through. Bumping it
    // still rotates which orgs this page favours, least-recently-touched first.
    const previous = typeof organization.cursor === 'string' ? organization.cursor : undefined
    await saveCursor(organization.id, previous ?? null)
    // Before the money sweeps that read them: a record with no evidence row has
    // nothing for the acceptance lane to find (brief 69 §5).
    try {
      await sweepFinancialRecordBridge(database, { organizationId: organization.id, limit: 500 })
    } catch (error) {
      logger.warn('Financial record bridge needs retry', {
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
    // D19 task B: applications of a held prepayment to an invoice. Runs after
    // the receipt sweep on purpose - the reclass relieves a receivable the
    // receipt's own effect is what raised.
    if (Date.now() < deadline) {
      try {
        await sweepDepositApplicationAccounting(database, {
          organizationId: organization.id,
          limit: 100,
          timeBudgetMs: deadline - Date.now(),
        })
      } catch (error) {
        logger.warn('Deposit application accounting recovery needs retry', {
          organizationId: organization.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    // Gate 2's scheduled half: batches whose avenue auto-sends, and failed ones
    // past their backoff. A held batch is never touched here.
    try {
      await sweepExportBatches(database, {
        organizationId: organization.id,
        limit: 5,
        timeBudgetMs: Math.max(1, deadline - Date.now()),
      })
    } catch (error) {
      logger.warn('Export batch recovery needs retry', {
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
