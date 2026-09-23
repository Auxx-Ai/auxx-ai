// packages/lib/src/accounting/providers/provider-create-order.ts
//
// PURE and client-safe: which of a selection's accounts a bulk create-and-link
// sends to the provider, and in what order. `createProviderAccounts` runs it
// server-side and the chart tab's bulk bar runs it to preview the confirm.

import { accountPath, sortChartTree } from '../ledger/chart/account-tree'
import type { AccountIdentityRow, ChartAccountRow } from '../ledger/types'

/** Neither linked (a broken link still holds a provider id) nor offered a match to accept. */
function isUnlinked(row: AccountIdentityRow | undefined): boolean {
  return !row || (!row.providerAccountId && !row.suggestion)
}

/**
 * The rows a bulk create-and-link sends, in chart order so every parent
 * precedes its children - the provider cannot nest a child under a parent it
 * does not hold yet. Only unlinked rows go: linked, broken and suggested ones
 * are skipped, as the per-row create skips them, and an unlinked ancestor
 * outside the selection is pulled in ahead of its child rather than left for
 * the provider to refuse. Archived rows and ids the chart does not hold drop out.
 */
export function providerCreateOrder(
  accounts: readonly ChartAccountRow[],
  byAccountId: ReadonlyMap<string, AccountIdentityRow>,
  selectedIds: readonly string[]
): ChartAccountRow[] {
  const live = accounts.filter((account) => !account.isArchived)
  const wanted = new Set<string>()
  for (const id of selectedIds) {
    for (const row of accountPath(live, id)) wanted.add(row.id)
  }
  return sortChartTree(live).filter(
    (account) => wanted.has(account.id) && isUnlinked(byAccountId.get(account.id))
  )
}
