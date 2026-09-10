// apps/web/src/components/accounting/ui/account-label-format.ts
//
// The pure half of `account-label.tsx`: string forms of a GL account with no
// React and no chart fetch, so `accounts-types.ts` (which the picker imports)
// can use them without a module cycle, and so they are unit-testable bare.

/**
 * The two facts a label needs. `code` is typed nullable ahead of task 15 §5,
 * where `gl_account.code` becomes optional: an account imported from
 * QuickBooks has a name and no number, and every renderer must read correctly
 * for it today so that change touches no screen.
 */
export interface LabelAccount {
  code?: string | null
  name: string
}

/**
 * `1310 · Inventory Raw Materials`, or `Inventory Raw Materials` when the
 * account has no code. The one string form of an account, for tooltips,
 * `title` attributes, dialog titles, confirm copy, option labels and search
 * indexes. Never a bare code: a code alone identifies nothing to a reader who
 * did not number the chart.
 */
export function formatAccountLabel(account: LabelAccount | null | undefined): string {
  if (!account) return ''
  const code = account.code?.trim()
  return code ? `${code} · ${account.name}` : account.name
}

/**
 * The shortest token that still names the account: the code when there is one
 * (four characters, which is what a chip or a badge has room for), else the
 * name. The caller pairs it with {@link formatAccountLabel} in a tooltip.
 */
export function accountChipText(account: LabelAccount): string {
  return account.code?.trim() || account.name
}

/** Case-insensitive match over code and name, null-safe on the code. */
export function accountMatchesSearch(account: LabelAccount, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return (
    account.name.toLowerCase().includes(needle) ||
    (account.code?.toLowerCase().includes(needle) ?? false)
  )
}
