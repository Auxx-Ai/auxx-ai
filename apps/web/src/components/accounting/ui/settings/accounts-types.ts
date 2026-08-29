// apps/web/src/components/accounting/ui/settings/accounts-types.ts
//
// The web-only half of the Accounts settings page's vocabulary.
//
// 🛑 Nothing here mirrors a lib type any more. `RoleAssignmentRow`,
// `RoleAssignmentState` and `ChartAccountRow` are imported straight from
// `@auxx/lib/postings/client` at every call site, because `ledger.roleMap` and
// `ledger.chartAccounts` now return exactly those shapes. What is left below is
// presentation the server has no opinion about: the badge palette for the five
// statement classifications, the two roles the L1 regime never emits, and how an
// account reads inside a row.

import type { AccountRole, ChartAccountRow, GlAccountTypeValue } from '@auxx/lib/postings/client'
import type { SelectOptionColor } from '@auxx/types/custom-field'

/**
 * The five statement classifications.
 *
 * ⚠️ Mirrored from `GlAccountType` in
 * `packages/lib/src/resources/registry/enum-values.ts`, which is NOT among
 * `@auxx/lib/resources/client`'s re-exports. The literal union
 * (`GlAccountTypeValue`) IS client-exported from `@auxx/lib/postings/client`
 * and every value below is typed against it, so a divergence is a compile
 * error rather than a silently wrong dropdown.
 */
export const ACCOUNT_TYPE_OPTIONS: Array<{
  value: GlAccountTypeValue
  label: string
  color: SelectOptionColor
}> = [
  { value: 'asset', label: 'Asset', color: 'blue' },
  { value: 'liability', label: 'Liability', color: 'amber' },
  { value: 'equity', label: 'Equity', color: 'purple' },
  { value: 'revenue', label: 'Revenue', color: 'green' },
  { value: 'expense', label: 'Expense', color: 'red' },
]

export function accountTypeLabel(type: GlAccountTypeValue): string {
  return ACCOUNT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type
}

/**
 * The badge colour for a statement classification.
 *
 * Declared once, in {@link ACCOUNT_TYPE_OPTIONS}, so the chart list, the role
 * map and the editor cannot drift into three different palettes for the same
 * five words. Every value is a real `Badge` colour variant.
 */
export function accountTypeColor(type: GlAccountTypeValue): SelectOptionColor {
  return ACCOUNT_TYPE_OPTIONS.find((option) => option.value === type)?.color ?? 'blue'
}

/**
 * The two roles nothing emits under the L1 regime, and which are therefore the
 * expected candidates for being marked unused.
 *
 * `ppv` is a report rather than a posting (nothing accumulates in 5090 during
 * the year), and `inventory_wip` is structurally unreachable because
 * `resolveInventoryRoleForPartKind`'s range is raw materials and finished goods
 * only. A map that demanded all thirteen would block Preview on two roles
 * nothing can ever post to.
 *
 * ⚠️ Advisory only. The server decides what a role's state IS - this list only
 * decides where the page explains why marking one unused is the normal answer.
 */
export const DEFAULT_UNUSED_ROLES: AccountRole[] = ['ppv', 'inventory_wip']

/** `1310 · Inventory Raw Materials`, the way an account reads in a row. */
export function formatAccount(account: ChartAccountRow | null | undefined): string {
  if (!account) return ''
  return `${account.code} · ${account.name}`
}

/**
 * The phantom draft the Chart of accounts tab keeps while somebody is adding an
 * account, owned by `accounts-settings-page.tsx`.
 *
 * Only enough to render the list's phantom row and to know whether the current
 * selection is a draft — the full field set lives inside the draft form instance
 * (keyed by `draftId`), exactly as `CatalogDraftHandle` has it.
 */
export interface ChartDraftHandle {
  draftId: string
  /** Live preview of the code being typed, for the phantom row. */
  code: string
  /** Live preview of the name being typed, for the phantom row. */
  name: string
  /**
   * Set once the draft's `chartAccountCreate` resolves. The draft is KEPT alive
   * after creation (with selection swapped to this id) so the draft form stays
   * mounted — a remount onto the query-bound form mid-typing would replace the
   * input's text and cancel the pending debounced commit. The list hides the
   * phantom row once this is set (the real row arrived with the invalidated
   * query); the draft is dropped when the user navigates to another row or tab.
   */
  recordId?: string
}
