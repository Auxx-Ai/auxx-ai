// packages/lib/src/data-migrations/migrations/181-rewalk-provisioned-chart-packs.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  CHART_PACK_KEYS,
  type ChartPackKey,
  packState,
} from '../../accounting/ledger/chart/default-chart'
import { listRoleMap } from '../../accounting/ledger/roles/role-map'
import { loadExistingState } from '../../seed/entity-helpers'
import { seedChartPacks } from '../../seed/gl-account-chart'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:181')

const GL_ACCOUNT = 'gl_account'

/** {@link PerOrgMigrationResult} plus what the re-walk actually landed. */
export interface Migration181Result extends PerOrgMigrationResult {
  packsRewalked: ChartPackKey[]
  accountsCreated: number
  rolesAssigned: number
}

/**
 * Migration 181: re-walk every chart pack an org has adopted, so an account
 * added to the catalogue after the org's wizard ran stops being unreachable
 * (`plans/accounting/tasks/75-what-the-74-retest-found.md` §1.3, 75-D2).
 *
 * Only a pack reading `partial` is walked — the org has some of it, so the
 * missing rows are rows it already meant to have. An `absent` pack is never
 * walked: foisting `payroll`, `fixed_assets` or `debt` on an org that never
 * adopted them is worse than a missing account. This is the Roles tab's Add
 * accounts action (16 §3.2), run once for everyone; today it lands 5093
 * Purchase Discounts, and every later catalogue addition the next time a
 * migration runs.
 *
 * Idempotent — `seedChartPacks` is INSERT-only on `code` and its role
 * assignments are `ON CONFLICT DO NOTHING`, so a second pass creates nothing.
 */
export const migration181RewalkProvisionedChartPacks: PerOrgMigration = {
  id: '181-rewalk-provisioned-chart-packs',
  description:
    'Re-walks every chart pack reading `partial` for an org, landing the catalogue accounts ' +
    'added since it was provisioned (5093 Purchase Discounts today). `absent` packs are never ' +
    'walked (75 §1.3)',

  async up(db: Database, organizationId: string): Promise<Migration181Result> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const nothing: Migration181Result = {
      ...state,
      alreadyUpToDate: true,
      packsRewalked: [],
      accountsCreated: 0,
      rolesAssigned: 0,
    }

    const existing = await loadExistingState(db, organizationId)
    const glAccountDefId = existing.entityDefs.get(GL_ACCOUNT)?.id
    // No def means no chart to re-walk, the same tolerance `seedChartPacks` has.
    if (!glAccountDefId) return nothing

    const roleMap = await listRoleMap(db, organizationId)
    if (roleMap.isErr()) throw roleMap.error

    const partial = CHART_PACK_KEYS.filter((pack) => packState(pack, roleMap.value) === 'partial')
    if (partial.length === 0) return nothing

    // `seedChartPacks` expands `core` and each pack's `requires` before walking;
    // both are idempotent, and a pack nothing requires stays untouched.
    const chart = await seedChartPacks(db, organizationId, glAccountDefId, partial)

    const changed = chart.created > 0 || chart.rolesAssigned > 0
    if (changed) {
      logger.info('Migration 181 applied', {
        organizationId,
        packs: partial,
        accountsCreated: chart.created,
        rolesAssigned: chart.rolesAssigned,
      })
    }

    return {
      ...state,
      alreadyUpToDate: !changed,
      packsRewalked: [...partial],
      accountsCreated: chart.created,
      rolesAssigned: chart.rolesAssigned,
    }
  },
}
