// packages/lib/src/seed/entity-migrations/migrations/126-service-revenue-account.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../../cache'
import { seedDefaultChartOfAccounts } from '../../gl-account-chart'
import { loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:126')

/** The def the chart lives on. Created by migration 108. */
const GL_ACCOUNT_ENTITY_TYPE = 'gl_account'

/** The account this migration exists to put in every org's chart. */
export const SERVICE_REVENUE_CODE = '4030'

/**
 * The per-org cache keys a new `gl_account` instance invalidates. A chart
 * account is an `EntityInstance`, so `resources` is the key that serves it;
 * no definition and no field is created here.
 */
const CACHE_KEYS = ['resources'] as const

/**
 * Migration 126: `4030 Service Revenue` and its `revenue_service` role, in
 * every existing org's chart of accounts.
 *
 * The credit leg of the `invoice_issued` entry
 * (plans/accounting/tasks/08-invoice-revenue.md). Before it, the chart's
 * revenue block was `4000 Product Revenue - DTC`, `4010 Product Revenue -
 * Dealer` and `4020 Shipping Revenue`, all three of them credited on SHIPMENT
 * by the fulfillment entry and sourced on an `order`. An invoice has no
 * shipment and no order, so service revenue reached the profit and loss
 * through no account at all.
 *
 * ## Why this is one call to `seedDefaultChartOfAccounts` and nothing else
 *
 * That function is idempotent on `code` and its role insert is
 * `ON CONFLICT (organizationId, role) DO NOTHING`, and it assigns roles to
 * accounts it FINDS as well as accounts it creates. So once `default-chart.ts`
 * declares `4030`, one call does the whole job on a settled org: it creates the
 * account where it is missing, assigns `revenue_service` where it is
 * unassigned, and touches nothing a bookkeeper has edited. Writing the insert a
 * second way here would be the second source of truth the chart module exists
 * to avoid.
 *
 * ## Self-sufficient, with no companion data migration
 *
 * There is nothing to backfill. Invoices already `sent`, `partially_paid` or
 * `paid` when this ships deliberately get NO issuance entry (brief 08 §3.6):
 * their dates sit in periods that are closed or about to be, and the opening
 * trial balance's A/R figure already includes them, so posting them a second
 * time would double the receivable.
 *
 * An org short of migration 108 has no chart at all, and 108 seeds the whole
 * current `DEFAULT_CHART_OF_ACCOUNTS` - `4030` included - so this is a skip
 * rather than a failure and that org picks the account up from 108 itself.
 */
export const migration126ServiceRevenueAccount: EntityMigration = {
  id: '126-service-revenue-account',
  description:
    'Adds 4030 Service Revenue and its revenue_service role to every org chart - the credit ' +
    'leg of the invoice issuance entry',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const existing = await loadExistingState(db, organizationId)
    const def = existing.entityDefs.get(GL_ACCOUNT_ENTITY_TYPE)
    if (!def) return { ...state, alreadyUpToDate: true }

    const chart = await seedDefaultChartOfAccounts(db, organizationId, def.id)
    const changed = chart.created > 0 || chart.rolesAssigned > 0

    // A new chart account is invisible to every read path that serves the chart
    // until the org's `resources` cache is dropped.
    // `runEntityMigrationsForOrg` does this after the whole batch, but `up()`
    // can also be invoked directly, so it clears its own.
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 126 applied', {
        organizationId,
        accountsCreated: chart.created,
        rolesAssigned: chart.rolesAssigned,
      })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}
