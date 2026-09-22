// packages/lib/src/accounting/export/preflight.ts
// What the mapping table already knows about a batch that has not been sent
// (89 D7). A tab read, so it touches our database only - never the provider.

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { accountLabel } from '../ledger/chart/account-label'
import { listChartAccounts } from '../ledger/roles/role-map'
import { NONE_PROVIDER_ID, resolveAccountingProvider } from '../providers/provider'
import type { ExportFailureItem } from './client'
import { payloadAccountIds } from './payloads'

/** Matches the QuickBooks adapter's own remedy, minus the provider's name. */
const UNMAPPED_ACCOUNT_REMEDY =
  'Pick its account under Accounting > Settings > Accounts > Chart of accounts.'

/** The sentence `send.ts` records when the preflight stops a batch before the provider call. */
export function exportBlockerSentence(item: ExportFailureItem): string {
  return `${item.label} is not mapped to an account in the connected accounting system. ${item.remedy}`
}

/**
 * Which accounts each batch names that the org has not mapped yet.
 *
 * 🛑 `listAccountMappings` and `listChartAccounts` only, once each for the whole
 * set. `listAccountIdentities` and `listProviderAccounts` reach the provider,
 * and a tab read must not. So this emits `unmapped_account` alone -
 * `invalid_mapping` needs the live provider chart and stays the adapter's
 * verdict at send time, making this a subset of it and never a contradiction.
 */
export async function readExportBatchBlockers(
  db: Database,
  organizationId: string,
  batches: readonly { id: string; payload: unknown }[]
): Promise<Result<Map<string, ExportFailureItem[]>, Error>> {
  const blockers = new Map<string, ExportFailureItem[]>()

  const namedIds = new Map<string, string[]>()
  for (const batch of batches) {
    const ids = payloadAccountIds(batch.payload)
    if (ids.length > 0) namedIds.set(batch.id, ids)
  }
  if (namedIds.size === 0) return ok(blockers)

  // No book connected is not a blocker: the batch stays internal and `send.ts`
  // answers `not_connected` without spending an attempt.
  const provider = await resolveAccountingProvider(organizationId)
  if (provider.id === NONE_PROVIDER_ID) return ok(blockers)

  const mapped = await provider.listAccountMappings(organizationId)
  if (mapped.isErr()) return err(mapped.error)
  const chart = await listChartAccounts(db, organizationId)
  if (chart.isErr()) return err(chart.error)

  const labels = new Map(chart.value.map((row) => [row.id, accountLabel(row)]))
  for (const [batchId, ids] of namedIds) {
    const items: ExportFailureItem[] = []
    for (const glAccountId of ids) {
      if (mapped.value.get(glAccountId)) continue
      const label = labels.get(glAccountId)
      // An id our chart does not hold has nothing to pick; it stays the
      // adapter's prose at send time (89 D1).
      if (!label) continue
      items.push({
        key: 'unmapped_account',
        ref: glAccountId,
        label,
        remedy: UNMAPPED_ACCOUNT_REMEDY,
      })
    }
    if (items.length > 0) blockers.set(batchId, items)
  }
  return ok(blockers)
}
