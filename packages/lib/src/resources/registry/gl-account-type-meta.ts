// packages/lib/src/resources/registry/gl-account-type-meta.ts
//
// The five statement classifications, and everything a screen needs to draw
// one, in ONE table.
//
// 🛑 This existed four times before, and the four disagreed. `GlAccountType`
// carried the label and colour; `accounts-types.ts` carried a hand-written copy
// of the same two (its own comment said "Mirrored from `GlAccountType`");
// `role-map-list.tsx` carried the icons and had only THREE for the five types
// (asset and equity were both `Coins`, revenue and expense both `Receipt`);
// and the chart list and the statement table drew a blanket `Landmark` for
// everything. The role editor had already drifted off the palette entirely,
// rendering the type in a bare `outline` badge, so "Equity" was purple in one
// pane and grey in the next.
//
// 🛑 A LEAF: no imports, because `enum-values.ts` imports THIS. The dependency
// inside `packages/lib` runs `postings -> resources/registry` and never the
// reverse (`default-chart.ts:42`, `account-subtype.ts:9`), so the table has to
// sit on the registry side for `GlAccountType` to derive from it.
//
// The colour is one id doing three jobs. `blue`, `amber`, `purple`, `green` and
// `red` are each simultaneously an `ICON_COLORS` id (`icons.tsx`, what
// `EntityIcon` takes), a `Badge` variant, and a `SelectOptionColor`
// (`@auxx/types/custom-field`, what the type dropdown takes) - so one field
// feeds the icon, the badge and the select, and a fourth palette cannot appear.
// Anything added here must hold in all three.

/** One statement classification, as every screen needs to draw it. */
export interface GlAccountTypeMeta {
  value: string
  label: string
  /**
   * An `ICON_DATA` id (`packages/ui/src/components/icon-data.ts`), NOT a Lucide
   * component.
   *
   * 🛑 A string, because `@auxx/lib` is imported by the worker and the API and
   * must never pull React or `lucide-react` in behind it. Web resolves the id
   * through `getIcon`/`EntityIcon` the way every other icon in the app is
   * resolved, so this table stays renderable from a server context.
   */
  iconId: string
  /** `ICON_COLORS` id, `Badge` variant and `SelectOptionColor`, all at once. */
  color: string
}

/**
 * The five, in statement order: assets, liabilities, equity, revenue, expense.
 *
 * ⚠️ The ORDER is load-bearing. `GL_ACCOUNT_TYPES` and every statement's
 * sections read down it, and `sortChartAccountsForStatement` sorts against it
 * on the server, so a balance sheet's sections come out in this sequence.
 */
export const GL_ACCOUNT_TYPE_META = [
  { value: 'asset', label: 'Asset', iconId: 'landmark', color: 'blue' },
  { value: 'liability', label: 'Liability', iconId: 'credit-card', color: 'amber' },
  { value: 'equity', label: 'Equity', iconId: 'piggy-bank', color: 'purple' },
  { value: 'revenue', label: 'Revenue', iconId: 'trending-up', color: 'green' },
  { value: 'expense', label: 'Expense', iconId: 'receipt', color: 'red' },
] as const satisfies readonly GlAccountTypeMeta[]

/**
 * One classification's presentation, or the asset row for anything unknown.
 *
 * Never returns undefined: a caller drawing a row has to draw SOMETHING, and an
 * unknown type is a bug upstream rather than a reason to render a hole. The
 * same total-lookup shape `getOptionColor` uses in `custom-fields/client.ts`.
 */
export function glAccountTypeMeta(type: string): GlAccountTypeMeta {
  return GL_ACCOUNT_TYPE_META.find((meta) => meta.value === type) ?? GL_ACCOUNT_TYPE_META[0]
}
