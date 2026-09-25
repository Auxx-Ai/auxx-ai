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
import {
  type PartValueAtCutover,
  readPartsValueAtCutover,
  type UncountedPart,
} from './opening-stock-subledger'

/** Where the inventory the parts describe was on the old books, chosen once (111 Q19). */
export type OpeningInventoryInBooks = 'revaluation' | 'opening_equity'

/** One inventory account (or an unmapped role) at the cutover: books against parts. */
export interface OpeningInventoryDifferenceRow {
  /** Null for an inventory role no account carries. */
  glAccountId: string | null
  /** The inventory roles on this account; a provider-imported chart often puts all three on one. */
  roles: string[]
  /** The opening entry's lines plus every difference entry already posted, debit-positive. */
  ledgerMinor: number
  /** The parts' value at the cutover for these roles. */
  partsMinor: number
  /** `partsMinor − ledgerMinor`: what the next entry would debit (or credit, negative). */
  differenceMinor: number
}

export interface OpeningInventoryDifference {
  cutoverDate: string
  /** The setting's answer; `null` until it is given. */
  inBooks: OpeningInventoryInBooks | null
  /** The credit account is unknown until `accounting.openingInventoryInBooks` is answered. */
  needsAnswer: boolean
  /** The opening entry's inventory lines. */
  providerOpeningMinor: number
  /** Σ every difference entry posted so far. */
  postedDifferencesMinor: number
  postedDifferenceCount: number
  /** Σ frozen extended cost of every movement ≤ cutover over anchored parts. */
  partsValueAtCutoverMinor: number
  /** `parts − (provider + posted)`: what the next press would post. */
  deltaMinor: number
  rows: OpeningInventoryDifferenceRow[]
  byPart: PartValueAtCutover[]
  /** Sold but never counted: movements ≤ cutover and no `initial`. Excluded from the value. */
  uncounted: UncountedPart[]
  /** Rows on anchored parts with no value yet, excluded from the value. */
  pendingRows: number
}

/**
 * The books' opening inventory against the parts' value at the cutover, per inventory account
 * (plans/accounting/tasks/111 §2.2). Reads only.
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
        'accounting.openingInventoryInBooks',
      ] as const)
      const cutoff = settings['accounting.cutoffPeriod']?.trim()
      if (!cutoff) {
        throw new UnprocessableEntityError(
          'The accounting cutoff month is not set, so there is no opening to compare the parts to.',
          { organizationId }
        )
      }
      const cutoverDate = cutoverDateFor(cutoff)
      const inBooks = readInBooks(settings['accounting.openingInventoryInBooks'])

      const [roleAccounts, parts] = await Promise.all([
        loadRoleAccountCodes(db, organizationId, [...INVENTORY_ROLES]),
        readPartsValueAtCutover(db, organizationId, { onOrBefore: cutoverDate }),
      ])
      if (parts.isErr()) throw parts.error

      const rowsByKey = new Map<string, OpeningInventoryDifferenceRow>()
      for (const role of INVENTORY_ROLES) {
        const glAccountId = roleAccounts.get(role)?.glAccountId ?? null
        const partsMinor = parts.value.byRole[role as keyof typeof parts.value.byRole] ?? 0
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

      let providerOpeningMinor = 0
      let postedDifferencesMinor = 0
      const rows: OpeningInventoryDifferenceRow[] = []
      for (const row of rowsByKey.values()) {
        if (row.glAccountId) {
          const opening = ledger.openingByAccount.get(row.glAccountId) ?? 0
          const posted = ledger.adjustmentByAccount.get(row.glAccountId) ?? 0
          providerOpeningMinor += opening
          postedDifferencesMinor += posted
          row.ledgerMinor = opening + posted
        }
        row.differenceMinor = row.partsMinor - row.ledgerMinor
        // An unmapped role with no parts is not a row anybody can act on.
        if (!row.glAccountId && row.partsMinor === 0) continue
        rows.push(row)
      }

      return {
        cutoverDate,
        inBooks,
        needsAnswer: inBooks === null,
        providerOpeningMinor,
        postedDifferencesMinor,
        postedDifferenceCount: ledger.differenceEntries,
        partsValueAtCutoverMinor: parts.value.totalMinor,
        deltaMinor: rows.reduce((sum, row) => sum + row.differenceMinor, 0),
        rows,
        byPart: parts.value.byPart,
        uncounted: parts.value.uncounted,
        pendingRows: parts.value.pendingRows,
      }
    },
    'Failed to read the opening inventory difference',
    { organizationId }
  )
}

function readInBooks(value: unknown): OpeningInventoryInBooks | null {
  return value === 'revaluation' || value === 'opening_equity' ? value : null
}
