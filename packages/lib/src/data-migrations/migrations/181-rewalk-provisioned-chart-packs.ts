// packages/lib/src/data-migrations/migrations/181-rewalk-provisioned-chart-packs.ts

import type { Database } from '@auxx/database'
import type { ChartPackKey } from '../../accounting/ledger/chart/default-chart'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

/** {@link PerOrgMigrationResult} plus what the re-walk landed; always zeros now. */
export interface Migration181Result extends PerOrgMigrationResult {
  packsRewalked: ChartPackKey[]
  accountsCreated: number
  rolesAssigned: number
}

/**
 * Migration 181, retired 2026-09-22 by MK: a data migration never creates chart accounts.
 *
 * It used to re-walk every `partial` chart pack (75-D2) and landed a second, coded
 * chart on any org that had imported its accounts and mapped roles by hand, because
 * the walker keys on `code` and an imported chart has none. The id stays so the
 * `DataMigration` ledger keeps its row; `up` does nothing.
 */
export const migration181RewalkProvisionedChartPacks: PerOrgMigration = {
  id: '181-rewalk-provisioned-chart-packs',
  description:
    'Retired: no chart accounts are created by a migration (was 75-D2, the pack re-walk)',

  async up(_db: Database, _organizationId: string): Promise<Migration181Result> {
    return {
      entityDefsCreated: 0,
      fieldsCreated: 0,
      relationshipsLinked: 0,
      alreadyUpToDate: true,
      packsRewalked: [],
      accountsCreated: 0,
      rolesAssigned: 0,
    }
  },
}
