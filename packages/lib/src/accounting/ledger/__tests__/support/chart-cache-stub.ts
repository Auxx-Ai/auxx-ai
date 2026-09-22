// packages/lib/src/accounting/ledger/__tests__/support/chart-cache-stub.ts

import { type Database, schema } from '@auxx/database'
import { chartAccountsProvider } from '../../../../cache/providers/chart-accounts-provider'
import type { ChartAccountRow } from '../../types'

/** A db answering only the `chartAccounts` provider's two reads: the def's instances, then their values. */
export function chartProviderDb(
  accounts: readonly { id: string; archived?: boolean }[],
  values: readonly Record<string, unknown>[]
): Database {
  const rows = (table: unknown) =>
    table === schema.EntityInstance
      ? accounts.map((a) => ({ id: a.id, archivedAt: a.archived ? new Date(0) : null }))
      : values
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => rows(table),
      }),
    }),
  } as unknown as Database
}

/** The `chartAccounts` answer a test's cache mock returns - the real provider over {@link chartProviderDb}. */
export function computeChart(orgId: string, db: unknown): Promise<ChartAccountRow[]> {
  return chartAccountsProvider.compute(orgId, db as Database)
}
