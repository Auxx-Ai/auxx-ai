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

import {
  type AccountIdentityRow,
  type AccountRole,
  type AccountSuggestionReason,
  accountSubtypeLabel,
  CHART_PACK_KEYS,
  CHART_PACKS,
  type ChartAccountRow,
  type ChartPackKey,
  GL_ACCOUNT_SUBTYPES,
  GL_ACCOUNT_TYPE_META,
  type GlAccountSubtypeValue,
  type GlAccountTypeValue,
  glAccountTypeMeta,
  type ProviderAccount,
} from '@auxx/lib/postings/client'
import type { SelectOptionColor } from '@auxx/types/custom-field'
import { getIcon } from '@auxx/ui/components/icon-data'
import { Landmark, type LucideIcon } from 'lucide-react'
import { formatAccountLabel } from '../account-label-format'

/**
 * The five statement classifications, for the type dropdown.
 *
 * 🛑 DERIVED from `GL_ACCOUNT_TYPE_META`, not mirrored from it. This used to be
 * a hand-written copy of `GlAccountType.values` carrying a "⚠️ Mirrored from"
 * comment and a promise that a divergence would be a compile error - which
 * covered the VALUES but never the labels or the colours, and said nothing at
 * all about the icons, which lived in a third place with only three glyphs for
 * five types. One table now feeds the dropdown, the badge and the icon.
 */
export const ACCOUNT_TYPE_OPTIONS: Array<{
  value: GlAccountTypeValue
  label: string
  color: SelectOptionColor
}> = GL_ACCOUNT_TYPE_META.map((meta) => ({
  value: meta.value as GlAccountTypeValue,
  label: meta.label,
  color: meta.color as SelectOptionColor,
}))

export function accountTypeLabel(type: GlAccountTypeValue): string {
  return glAccountTypeMeta(type).label
}

/**
 * The badge colour for a statement classification.
 *
 * One id doing three jobs - an `ICON_COLORS` id, a `Badge` variant and a
 * `SelectOptionColor` - so the chart list, the role map, the role editor and
 * the statement table cannot drift into four palettes for the same five words.
 */
export function accountTypeColor(type: GlAccountTypeValue): SelectOptionColor {
  return glAccountTypeMeta(type).color as SelectOptionColor
}

/**
 * The `ICON_DATA` id for a statement classification, for `EntityIcon` or any
 * other surface that takes an icon id rather than a component.
 */
export function accountTypeIconId(type: string): string {
  return glAccountTypeMeta(type).iconId
}

/**
 * The Lucide component for a statement classification, resolved through the
 * shared catalog.
 *
 * ⚠️ `getIcon` answers `undefined` for an id that is not in `ICON_DATA`, and a
 * row still has to draw something, so this falls back to `Landmark` - the glyph
 * the chart list drew for every account before any of this was shared.
 */
export function accountTypeIcon(type: string): LucideIcon {
  return getIcon(accountTypeIconId(type))?.icon ?? Landmark
}

/**
 * The eight subtypes (task 13 §3 / task 15 §5) - what puts an account under
 * COGS on the P&L, never a code prefix. Optional: most accounts carry none.
 *
 * Derived from `GL_ACCOUNT_SUBTYPES` and `accountSubtypeLabel`, both
 * client-exported from `@auxx/lib/postings/client`, rather than reaching into
 * the registry's `GlAccountSubtype.values` (server-only).
 */
export const ACCOUNT_SUBTYPE_OPTIONS: Array<{
  value: GlAccountSubtypeValue
  label: string
  color: SelectOptionColor
}> = GL_ACCOUNT_SUBTYPES.map((value) => ({
  value,
  label: accountSubtypeLabel(value),
  color: 'gray',
}))

/**
 * The account map, as the Chart of accounts tab consumes it.
 *
 * 🛑 This DECORATES the chart, it never sources it. `ledger.chartAccounts` is a
 * local read and `ledger.accountMap` is a provider round trip that can fail for
 * reasons that have nothing to do with us - an expired token, a revoked
 * connection, QuickBooks being down. The list renders from the first and is
 * annotated by the second, so a provider outage can never make an org's chart
 * unreadable or unrenamable. `P1` makes "nothing connected" first class: every
 * field below has an honest value when there is no provider at all.
 */
export interface ChartMapView {
  /** A provider is connected AND returned a chart to map against. */
  connected: boolean
  /** The map row per `gl_account` id. Empty until `ledger.accountMap` resolves. */
  byAccountId: Map<string, AccountIdentityRow>
  /** The provider's own chart, for the picker. Empty when nothing is connected. */
  providerAccounts: ProviderAccount[]
  /**
   * Codes whose confirmed mapping no longer validates - the target was deleted,
   * deactivated, or its classification no longer agrees.
   *
   * Carried separately from the rows because `G19` requires every close to
   * refuse on exactly these, so the screen has to be able to LEAD with them
   * rather than leave them to be found by scrolling.
   */
  broken: string[]
  /** How many unmapped accounts the matcher has a candidate for. */
  suggested: number
  /** `'QuickBooks Online'`, or null with nothing connected. Never hardcode it. */
  providerLabel: string | null
  /** The provider round trip is in flight. The chart does not wait on it. */
  isPending: boolean
  /** The provider round trip failed. One muted line, not a page-level error. */
  isError: boolean
}

/**
 * How a suggestion earned itself, in the words a person is shown.
 *
 * 🛑 Always rendered WITH the suggestion, never behind a tooltip in settings. A
 * wrong account id in a journal entry balances, so nothing downstream can catch
 * it and the confirming person is the last line of defence - showing them the
 * answer without the evidence turns a confirmation back into a guess.
 */
export const ACCOUNT_SUGGESTION_REASON_COPY: Record<AccountSuggestionReason, string> = {
  number: 'same account number',
  name: 'same name',
}

/** `1310 · Inventory Asset`, the way a PROVIDER account reads in a picker. */
export function formatProviderAccount(account: ProviderAccount): string {
  return account.number
    ? `${account.number} · ${account.fullyQualifiedName}`
    : account.fullyQualifiedName
}

/**
 * A confirmed mapping whose target has gone, been deactivated, or changed
 * statement section.
 *
 * 🛑 ONE definition, two screens. This predicate decides whether a close will
 * refuse (`resolveMappedAccounts` re-checks the identical three conditions
 * against the chart it just fetched), so the chart list and the wizard's map
 * must not each carry their own copy of it to drift.
 */
export function isMappingBroken(row: AccountIdentityRow): boolean {
  if (row.state !== 'confirmed') return false
  const live = row.liveProviderAccount
  return !live || !live.active || live.classification !== row.account.accountType
}

/**
 * What a chart row's provider link amounts to, in one word.
 *
 * 🛑 Derived, never stored. `account-identities.ts` emits only `confirmed` and
 * `unmapped` (the `suggested` member of `AccountIdentityState` is declared but
 * nothing produces it), and "is this link still valid" is a THIRD question that
 * `isMappingBroken` answers separately. Folding all three into one word here is
 * what lets the list render a single badge per row instead of leaving a reader
 * to infer state from which badges happen to be absent.
 *
 * 🛑 "Linked" is deliberately the Chart tab's word, where the Roles tab says
 * "mapped". They are different questions - which QuickBooks account THIS account
 * corresponds to, versus which of our accounts a posting ROLE points at - and
 * they used to share the string "Not mapped" on two tabs of one page.
 */
export type AccountLinkState = 'linked' | 'suggested' | 'broken' | 'unlinked'

/**
 * Fold one map row onto its {@link AccountLinkState}.
 *
 * `undefined` (an account created moments ago, before the invalidated
 * `accountMap` came back) reads as `unlinked`, which is what it is.
 *
 * @param row - The account's map row, if the map has one for it
 * @returns The single word the row's badge renders
 */
export function accountLinkState(row: AccountIdentityRow | undefined): AccountLinkState {
  if (!row) return 'unlinked'
  if (isMappingBroken(row)) return 'broken'
  if (row.state === 'confirmed') return 'linked'
  return row.suggestion ? 'suggested' : 'unlinked'
}

/**
 * The two roles nothing emits under the L1 regime, and which are therefore the
 * expected candidates for being marked unused.
 *
 * `ppv` is a report rather than a posting (nothing accumulates in 5090 during
 * the year), and `inventory_wip` is structurally unreachable because
 * `resolveInventoryRoleForPartKind`'s range is raw materials and finished goods
 * only. A map that demanded every role would block Preview on two roles
 * nothing can ever post to.
 *
 * ⚠️ Advisory only. The server decides what a role's state IS - this list only
 * decides where the page explains why marking one unused is the normal answer.
 */
export const DEFAULT_UNUSED_ROLES: AccountRole[] = ['ppv', 'inventory_wip']

/**
 * `1310 · Inventory Raw Materials`, the way an account reads in a row, or the
 * name alone when the account has no code. Delegates to `formatAccountLabel`
 * in `../account-label.tsx`, the one string form every screen shares.
 */
export function formatAccount(account: ChartAccountRow | null | undefined): string {
  return formatAccountLabel(account)
}

// ─────────────────────────────────────────────────────────────────────────────
// The pack picker (brief 16 §3.2) - pure, shared by the wizard's checkbox card
// and the Roles tab's `chart-packs-dialog.tsx`. `CHART_PACKS.requires` is the
// one declared table (16 §1.6: never derived from the builders), so both
// pickers read it through these two functions rather than each hand-rolling
// the cascade.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which packs a chosen set forces on via `requires` - choosing `purchasing`
 * forces `inventory` (16 §1.4). Never includes a key already in `selected`
 * itself; a picker checks AND disables a row that comes back here, because
 * the person did not choose it directly and cannot un-choose it directly
 * either.
 */
export function forcedPacks(selected: ReadonlySet<ChartPackKey>): Set<ChartPackKey> {
  const forced = new Set<ChartPackKey>()
  for (const key of selected) {
    for (const req of CHART_PACKS[key].requires ?? []) forced.add(req)
  }
  return forced
}

/**
 * `selected` plus everything it forces on, in `CHART_PACK_KEYS` order - what a
 * picker actually sends to `provisionChart`. `seedChartPacks` walks `requires`
 * itself and is idempotent, so sending the forced packs explicitly costs
 * nothing extra; it is done here so the picker's own "this also adds
 * Inventory" copy and the packs it submits can never disagree.
 */
export function resolveSelectedPacks(selected: ReadonlySet<ChartPackKey>): ChartPackKey[] {
  const forced = forcedPacks(selected)
  return CHART_PACK_KEYS.filter((key) => selected.has(key) || forced.has(key))
}

/**
 * The wizard picker's initial selection: `core` always, `card_rail`
 * pre-checked when either card-rail signal is present (16 §3.2,
 * `ledger.paymentRailsPresent`). Pure so the pre-check rule is one function,
 * tested without mounting the query that feeds it.
 */
export function defaultSelectedPacks(railsPresent: {
  stripeConnect: boolean
  shopify: boolean
}): ChartPackKey[] {
  return railsPresent.stripeConnect || railsPresent.shopify ? ['core', 'card_rail'] : ['core']
}

/**
 * The phantom draft the Chart of accounts tab keeps while somebody is adding an
 * account, owned by `accounts-settings-page.tsx`.
 *
 * Only enough to render the list's phantom row and to know whether the current
 * selection is a draft, the full field set lives inside the draft form instance
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
   * mounted, a remount onto the query-bound form mid-typing would replace the
   * input's text and cancel the pending debounced commit. The list hides the
   * phantom row once this is set (the real row arrived with the invalidated
   * query); the draft is dropped when the user navigates to another row or tab.
   */
  recordId?: string
}
