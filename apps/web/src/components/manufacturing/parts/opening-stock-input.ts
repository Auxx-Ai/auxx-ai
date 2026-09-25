// apps/web/src/components/manufacturing/parts/opening-stock-input.ts

// The Set count section's pure half: what the create form sends, and the account
// the row lands in. The sentence under the inputs and the payload derive from ONE
// description of the form state, because the movement it writes is append-only.

import { cutoverDateFor, DEFAULT_CHART_OF_ACCOUNTS } from '@auxx/lib/accounting/ledger/client'
import { normalizeCalendarDayIso, toCalendarDayIso } from '@auxx/lib/field-values/client'
import { resolveInventoryRoleForPartKind } from '@auxx/lib/inventory/movements/client'

/** Everything the Set count section holds. */
export interface OpeningStockFormValues {
  /** Units on the shelf on the count day. */
  quantity: number | null
  /** Optional: what a unit cost, whole minor units. Becomes the part's first standard. */
  unitCost: number | null
  /** Calendar-day ISO from the date input. */
  occurredAt: string
}

/** A blank section: no quantity, no cost, dated today. */
export function defaultOpeningStockValues(): OpeningStockFormValues {
  return { quantity: null, unitCost: null, occurredAt: toCalendarDayIso(new Date()) }
}

/** Nothing was typed, so there is no count to record. */
export function isOpeningStockEmpty(values: OpeningStockFormValues): boolean {
  return values.quantity == null && values.unitCost == null
}

/**
 * The `purchasing.setCount` payload, or `null` when the section is not answered.
 * A count of zero is real; a cost is optional (the row is valued when the part gets one).
 */
export function buildOpeningStockInput(
  partId: string,
  values: OpeningStockFormValues
): { partId: string; quantity: number; unitCost?: number; occurredAt: Date } | null {
  const { quantity, unitCost } = values
  if (quantity == null || !Number.isFinite(quantity) || quantity < 0) return null
  if (unitCost != null && (!Number.isFinite(unitCost) || unitCost < 0)) return null
  return {
    partId,
    quantity,
    ...(unitCost != null ? { unitCost: Math.round(unitCost) } : {}),
    occurredAt: new Date(values.occurredAt),
  }
}

/** The validation errors the section contributes, keyed by field. */
export function validateOpeningStock(values: OpeningStockFormValues): Record<string, string> {
  const errors: Record<string, string> = {}
  if (values.quantity == null || values.quantity < 0) {
    errors.quantity = 'Quantity must be zero or more'
  }
  if (values.unitCost != null && values.unitCost < 0) {
    errors.unitCost = 'Unit cost cannot be negative'
  }
  return errors
}

/**
 * One inventory ROLE, spelled out as `1310 Raw Materials / Parts`, from the chart every org
 * is seeded with. Falls back to the role string when no chart entry carries it.
 */
export function inventoryAccountLabelForRole(role: string): string {
  const account = DEFAULT_CHART_OF_ACCOUNTS.find((entry) => entry.role === role)
  if (!account) return role
  return `${account.code} ${account.name}`
}

/**
 * The inventory account a count for this part kind is stamped with, resolved through
 * `resolveInventoryRoleForPartKind` — the same function the write path uses.
 */
export function openingStockAccountLabel(partKind: string | null | undefined): string {
  return inventoryAccountLabelForRole(resolveInventoryRoleForPartKind(partKind))
}

/** The same account as {@link openingStockAccountLabel}, as just its number — `1310`. */
export function openingStockAccountCode(partKind: string | null | undefined): string {
  const role = resolveInventoryRoleForPartKind(partKind)
  return DEFAULT_CHART_OF_ACCOUNTS.find((entry) => entry.role === role)?.code ?? role
}

/** What a count dated `occurredAt` posts (111 Q19): decided by the date, never asked. */
export type SetCountPosting =
  | { kind: 'off' }
  | { kind: 'covered'; cutoverDate: string }
  | { kind: 'variance'; inventoryAccount: string; varianceAccount: string }

export function describeSetCountPosting(input: {
  occurredAt: string
  partKind: string | null | undefined
  cutoffPeriod: string | null
  accountingActive: boolean
}): SetCountPosting {
  if (!input.accountingActive) return { kind: 'off' }
  const day = normalizeCalendarDayIso(input.occurredAt)?.slice(0, 10)
  if (input.cutoffPeriod && day) {
    try {
      const cutoverDate = cutoverDateFor(input.cutoffPeriod)
      if (day <= cutoverDate) return { kind: 'covered', cutoverDate }
    } catch {
      // A malformed cutoff month: nothing is covered, so the count posts as a variance.
    }
  }
  return {
    kind: 'variance',
    inventoryAccount: openingStockAccountLabel(input.partKind),
    varianceAccount: inventoryAccountLabelForRole('inventory_count_variance'),
  }
}

/** The one sentence under the inputs. */
export function setCountPostingSentence(posting: SetCountPosting): string {
  switch (posting.kind) {
    case 'off':
      return 'Moves stock only; nothing is posted until accounting is set up.'
    case 'covered':
      return `Dated on or before the cutover (${posting.cutoverDate}), so nothing is posted; the opening balance covers it.`
    case 'variance':
      return `Posts the difference to ${posting.inventoryAccount} against ${posting.varianceAccount}.`
  }
}
