// packages/lib/src/postings/account-label.ts
//
// How an account is NAMED in a sentence this package writes: a refusal, a
// log line, a divergence report. One function so a null code (task 15 §5)
// reads as the name alone everywhere, and so no message composes
// `${code} ${name}` by hand again. PURE, client-safe. The web app has its own
// `formatAccountLabel` for on-screen labels (middot, tooltip); this is the
// prose form.

/** The two facts a sentence needs. `code` may be null, undefined or blank. */
export interface NamedAccount {
  code?: string | null
  name: string
}

/** `1310 Raw Materials`, or `Raw Materials` when the account has no code. */
export function accountLabel(account: NamedAccount): string {
  const code = account.code?.trim()
  return code ? `${code} ${account.name}` : account.name
}

/**
 * Sort key for a statement or a chart list: by code when both rows have one,
 * a coded row before an uncoded one, then by name. Task 15 §5's 15.2 default,
 * applied AFTER the caller has ordered by statement type.
 */
export function compareAccountsByCodeThenName(a: NamedAccount, b: NamedAccount): number {
  const codeA = a.code?.trim() || null
  const codeB = b.code?.trim() || null
  if (codeA && codeB) {
    const byCode = codeA.localeCompare(codeB)
    if (byCode !== 0) return byCode
  } else if (codeA) {
    return -1
  } else if (codeB) {
    return 1
  }
  return a.name.localeCompare(b.name)
}
