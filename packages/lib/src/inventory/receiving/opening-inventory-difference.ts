// packages/lib/src/inventory/receiving/opening-inventory-difference.ts

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { cutoverDateFor } from '../../accounting/ledger/builders/opening-balance'
import { readOpeningInventoryLedger } from '../../accounting/ledger/reads/opening-inventory'
import { INVENTORY_ROLES } from '../../accounting/ledger/roles/regime'
import { loadRoleAccountCodes } from '../../accounting/ledger/roles/resolve-roles'
import { UnprocessableEntityError } from '../../errors'
import { readOrganizationSettings } from '../../settings/read'
import { guard } from './guard'
import { readOpeningStockSubledgerTotals } from './opening-stock-subledger'

/** One inventory account (or an unmapped role) at the cutover: ledger against parts. */
export interface OpeningInventoryDifferenceRow {
  /** Null for an inventory role no account carries. */
  glAccountId: string | null
  /** The inventory roles on this account; a provider-imported chart often puts all three on one. */
  roles: string[]
  /** The opening entry's lines plus any opening adjustment already posted, debit-positive. */
  ledgerMinor: number
  /** Σ extended cost of the `initial` movements on or before the cutover, for these roles. */
  partsMinor: number
  /** `partsMinor − ledgerMinor`: what an adjustment would debit (or credit, negative). */
  differenceMinor: number
}

export interface OpeningInventoryDifference {
  cutoverDate: string
  rows: OpeningInventoryDifferenceRow[]
  /** Σ `differenceMinor`. Zero means both books agree with the shelf. */
  differenceMinor: number
  /** Already posted by an opening adjustment, net over all accounts. */
  adjustedMinor: number
}

/**
 * The opening entry's inventory against the parts' opening value, per inventory account
 * (plans/accounting/tasks/103 §5a). Parts are the frozen extended cost of the `initial`
 * movements dated on or before the cutover. Reads only.
 *
 * @throws {UnprocessableEntityError} when the cutoff month is unset.
 */
export async function readOpeningInventoryDifference(
  db: Database,
  input: { organizationId: string }
): Promise<Result<OpeningInventoryDifference, Error>> {
  const { organizationId } = input
  return guard(
    async () => {
      const settings = await readOrganizationSettings(organizationId, [
        'accounting.cutoffPeriod',
      ] as const)
      const cutoff = settings['accounting.cutoffPeriod']?.trim()
      if (!cutoff) {
        throw new UnprocessableEntityError(
          'The accounting cutoff month is not set, so there is no opening to compare the parts to.',
          { organizationId }
        )
      }
      const cutoverDate = cutoverDateFor(cutoff)

      const [roleAccounts, parts] = await Promise.all([
        loadRoleAccountCodes(db, organizationId, [...INVENTORY_ROLES]),
        readOpeningStockSubledgerTotals(db, organizationId, { onOrBefore: cutoverDate }),
      ])
      if (parts.isErr()) throw parts.error

      const rowsByKey = new Map<string, OpeningInventoryDifferenceRow>()
      for (const role of INVENTORY_ROLES) {
        const glAccountId = roleAccounts.get(role)?.glAccountId ?? null
        const partsMinor = parts.value[role as keyof typeof parts.value] ?? 0
        const key = glAccountId ?? `role:${role}`
        const row = rowsByKey.get(key)
        if (row) {
          row.roles.push(role)
          row.partsMinor += partsMinor
          continue
        }
        rowsByKey.set(key, {
          glAccountId,
          roles: [role],
          ledgerMinor: 0,
          partsMinor,
          differenceMinor: 0,
        })
      }

      const accountIds = [...rowsByKey.values()].flatMap((row) =>
        row.glAccountId ? [row.glAccountId] : []
      )
      const ledger = await readOpeningInventoryLedger(db, organizationId, accountIds)

      let adjustedMinor = 0
      const rows: OpeningInventoryDifferenceRow[] = []
      for (const row of rowsByKey.values()) {
        if (row.glAccountId) {
          const adjusted = ledger.adjustmentByAccount.get(row.glAccountId) ?? 0
          adjustedMinor += adjusted
          row.ledgerMinor = (ledger.openingByAccount.get(row.glAccountId) ?? 0) + adjusted
        }
        row.differenceMinor = row.partsMinor - row.ledgerMinor
        // An unmapped role with no parts is not a row anybody can act on.
        if (!row.glAccountId && row.partsMinor === 0) continue
        rows.push(row)
      }

      return {
        cutoverDate,
        rows,
        differenceMinor: rows.reduce((sum, row) => sum + row.differenceMinor, 0),
        adjustedMinor,
      }
    },
    'Failed to read the opening inventory difference',
    { organizationId }
  )
}
