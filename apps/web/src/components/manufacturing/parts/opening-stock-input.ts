// apps/web/src/components/manufacturing/parts/opening-stock-input.ts

// The opening-stock section's pure half: what the create form sends, and the
// inventory account it says it will land in.
//
// Split out of `part-form-dialog.tsx` for the same reason `receipt-input.ts` is
// split out of the receive popover — the sentence under the inputs and the
// payload the mutation sends have to be derived from ONE description of the
// form's state. Here that matters more than usual: the sentence names a GL
// account, and `openStockBalance` writes an `updatable: false` movement stamped
// with that account. A line that said one thing while the write did another
// would be uncorrectable.
//
// plans/money/tasks/15-costing-usability.md §2.2.

import { DEFAULT_CHART_OF_ACCOUNTS } from '@auxx/lib/postings/client'
import { resolveInventoryRoleForPartKind } from '@auxx/lib/receiving/client'

/** Everything the opening-stock section holds. */
export interface OpeningStockFormValues {
  /** Units on hand at the opening date. */
  quantity: number | null
  /** What a unit cost, in whole minor units — the CURRENCY input's own shape. */
  unitCost: number | null
  /** ISO string from the date input. The ACCOUNTING date, not `createdAt`. */
  occurredAt: string
}

/** A blank section: no quantity, no cost, dated today. */
export function defaultOpeningStockValues(): OpeningStockFormValues {
  return { quantity: null, unitCost: null, occurredAt: new Date().toISOString() }
}

/** Nothing was typed, so there is no opening balance to record. */
export function isOpeningStockEmpty(values: OpeningStockFormValues): boolean {
  return values.quantity == null && values.unitCost == null
}

/**
 * The `purchasing.openStockBalance` payload, or `null` when the section is not
 * answered completely enough to send.
 *
 * 🛑 Both halves are required together. `openStockBalance` refuses a
 * non-positive quantity or unit cost outright, because an opening balance IS a
 * valuation — it becomes the part's first `part_standard_cost` — and a quantity
 * with no cost would be a hand-valued adjustment wearing an opening balance's
 * name, which is exactly what `G12` refuses for `adjustStock`.
 *
 * The unit cost is rounded here rather than trusted: `CURRENCY` is minor units
 * in a `doublePrecision` column, and the procedure's schema takes an integer.
 */
export function buildOpeningStockInput(
  partId: string,
  values: OpeningStockFormValues
): { partId: string; quantity: number; unitCost: number; occurredAt: Date } | null {
  const quantity = values.quantity
  const unitCost = values.unitCost
  if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) return null
  if (unitCost == null || !Number.isFinite(unitCost) || unitCost <= 0) return null
  return {
    partId,
    quantity,
    unitCost: Math.round(unitCost),
    occurredAt: new Date(values.occurredAt),
  }
}

/** The validation errors the section contributes, keyed by field. */
export function validateOpeningStock(values: OpeningStockFormValues): Record<string, string> {
  const errors: Record<string, string> = {}
  if (values.quantity == null || values.quantity <= 0) {
    errors.quantity = 'Quantity must be greater than zero'
  }
  if (values.unitCost == null || values.unitCost <= 0) {
    errors.unitCost = 'Unit cost must be greater than zero'
  }
  return errors
}

/**
 * The ONE resolution of a part kind to an inventory account, shared by
 * {@link openingStockAccountLabel} and {@link openingStockAccountCode}.
 *
 * 🛑 **Through `resolveInventoryRoleForPartKind`, never a second mapping.**
 * That function is what the write path uses, so the only way either rendering
 * can be wrong about the account is if the write is wrong about it too. A
 * kind-to-account table maintained here would drift silently, and the movement
 * it disagreed with is append-only. One resolution, two renderings: a caller
 * that wants the number and a caller that wants the name must never be able to
 * disagree about which account they are naming.
 *
 * The code and name come from `DEFAULT_CHART_OF_ACCOUNTS`, which is the chart
 * every org is seeded with. An org that has RENUMBERED its raw materials
 * account will see the seeded number here rather than its own — the role is
 * still right, and reading the org's chart would need `ledgerView`, which
 * somebody creating a part is not required to hold. When no chart entry carries
 * the role, both renderings fall back to the role string itself.
 */
function resolveOpeningStockAccount(partKind: string | null | undefined): {
  role: string
  account: (typeof DEFAULT_CHART_OF_ACCOUNTS)[number] | undefined
} {
  const role = resolveInventoryRoleForPartKind(partKind)
  return { role, account: DEFAULT_CHART_OF_ACCOUNTS.find((entry) => entry.role === role) }
}

/**
 * One inventory ROLE, spelled out as `1310 Raw Materials / Parts`.
 *
 * The entry point for callers that already hold a role rather than a part kind —
 * the reconciliation panel, which groups by role because that is what
 * `accounting.opening*` is keyed on and what a movement freezes. Falls back to
 * the role string when no chart entry carries it, exactly like
 * {@link openingStockAccountLabel}, which delegates here so the two renderings
 * cannot drift.
 */
export function inventoryAccountLabelForRole(role: string): string {
  const account = DEFAULT_CHART_OF_ACCOUNTS.find((entry) => entry.role === role)
  if (!account) return role
  return `${account.code} ${account.name}`
}

/**
 * The inventory account an opening balance for this part kind will be stamped
 * with, spelled out — `1310 Raw Materials / Parts`.
 *
 * See {@link resolveOpeningStockAccount} for why this is the only mapping.
 */
export function openingStockAccountLabel(partKind: string | null | undefined): string {
  return inventoryAccountLabelForRole(resolveOpeningStockAccount(partKind).role)
}

/**
 * The same account as {@link openingStockAccountLabel}, as just its number —
 * `1310`. For a column narrow enough that the name would repeat on every row;
 * pair it with the full label in a tooltip.
 *
 * See {@link resolveOpeningStockAccount} for why this is the only mapping.
 */
export function openingStockAccountCode(partKind: string | null | undefined): string {
  const { role, account } = resolveOpeningStockAccount(partKind)
  return account?.code ?? role
}
