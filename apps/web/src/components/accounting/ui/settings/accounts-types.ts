// apps/web/src/components/accounting/ui/settings/accounts-types.ts
//
// Shared shapes for the Accounts settings page's two tabs.
//
// 🛑 PLACEHOLDER-BACKED. There is no procedure that can read or create a
// `GlRoleAssignment`, and none that reads or writes a `gl_account` row through
// this surface, so both tabs run on `components/accounting/fixtures.ts` plus
// local state. Every type below is either the real lib type or a thin local
// mirror of a row that already exists in the database, so swapping a fixture
// for a query stays a small change.

import type { AccountRole, GlAccountTypeValue } from '@auxx/lib/postings/client'
import type { SelectOptionColor } from '@auxx/types/custom-field'

/**
 * Whether a role's account was chosen by a person or merely proposed.
 *
 * `G19` step 4: a suggested-but-unconfirmed match must read visibly differently
 * from a confirmed one, and a role nothing can ever emit must be markable
 * unused rather than blocking Preview forever.
 */
export type RoleAssignmentState = 'confirmed' | 'suggested' | 'unmapped' | 'unused'

export interface RoleAssignment {
  /** The `gl_account` row this role points at, or `null` while unmapped/unused. */
  accountId: string | null
  state: RoleAssignmentState
}

/** One row of the org's editable chart. Mirrors the `gl_account` EntityInstance. */
export interface ChartAccount {
  id: string
  code: string
  name: string
  accountType: GlAccountTypeValue
  isActive: boolean
}

/**
 * The phantom-draft handle for a not-yet-created chart row.
 *
 * The page owns only enough to render the placeholder row in the list and to
 * know whether the current selection is a draft; the full field set lives in
 * the editor component instance, keyed by `draftId`.
 */
export interface ChartDraftHandle {
  draftId: string
  code: string
  name: string
  /**
   * Set once the draft's first create resolves. The draft is KEPT alive after
   * creation (selection swapped to this id) so the draft editor form stays
   * mounted: remounting onto the committed form mid-typing would replace the
   * input's text with the create snapshot and cancel the pending debounced
   * commit.
   */
  recordId?: string
}

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
 * The two roles nothing emits under the L1 regime, and which therefore DEFAULT
 * to unused.
 *
 * `ppv` is a report rather than a posting (nothing accumulates in 5090 during
 * the year), and `inventory_wip` is structurally unreachable because
 * `resolveInventoryRoleForPartKind`'s range is raw materials and finished goods
 * only. A map that demanded all thirteen would block Preview on two roles
 * nothing can ever post to.
 */
export const DEFAULT_UNUSED_ROLES: AccountRole[] = ['ppv', 'inventory_wip']

/** `1310 · Inventory — Raw Materials`, the way an account reads in a row. */
export function formatAccount(account: ChartAccount | undefined): string {
  if (!account) return ''
  return `${account.code} · ${account.name}`
}
