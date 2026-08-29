// packages/lib/src/postings/suggest-account-identities.ts

/**
 * `G19` step 3: propose a type-compatible provider account for each of the org's
 * own accounts, and say WHY.
 *
 * Pure. No database, no provider call, no logger - both charts arrive as
 * arrays. That is what lets the whole matcher be tested without a double, and it
 * is why the number-versus-name precedence below can be argued about in a test
 * rather than in production.
 *
 * ## A suggestion is never a mapping
 *
 * Nothing here writes anything, and nothing downstream may treat a suggestion as
 * a resolution. `G19` is explicit - "require a human to confirm an existing
 * account" - and the reason is that every match this file can make is a guess
 * from a string. `1310` in our chart and `1310` in QuickBooks agreeing is strong
 * evidence and not proof; two accounts both called `Inventory Asset` is weaker
 * still. A wrong account id in a journal entry BALANCES, so no reader downstream
 * can ever catch it. The person confirming is the last line, which is why they
 * are shown the reason and not just the answer.
 *
 * ## Why type compatibility is a filter and not a tiebreak
 *
 * A candidate whose classification disagrees with ours is never offered at all,
 * at any confidence. Suggesting that our `2160` liability be mapped to a revenue
 * account because both are called "Accrual" would produce an entry that balances
 * and misstates the P&L, and a person clicking through a wizard has no way to
 * know that the number they recognised belonged to the wrong section.
 */

import type { AccountSuggestionReason, ChartAccountRow, ProviderAccount } from './types'

/** One proposal: our account, their account, and the evidence for the pairing. */
export interface AccountSuggestion {
  glAccountId: string
  account: ProviderAccount
  reason: AccountSuggestionReason
}

/**
 * `'an asset'` / `'a liability'` - the indefinite article for a classification.
 *
 * Trivial, and it lives here rather than at three call sites because these
 * sentences are read by a bookkeeper at 11pm deciding whether to trust a
 * mapping, and "is a asset account" reads like a machine wrote it.
 */
export function classificationArticle(classification: string): string {
  return /^[aeiou]/i.test(classification) ? `an ${classification}` : `a ${classification}`
}

/** Case- and whitespace-insensitive compare. `' 1310 '` matches `'1310'`. */
function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/**
 * Strip the punctuation and filler that differ between two charts describing the
 * same account, so `'COGS - Product Cost'` and `'Cogs   Product Cost'` compare
 * equal.
 *
 * Deliberately conservative: it collapses separators and whitespace and nothing
 * else. No stemming, no synonym list, no "inventory ≈ stock". Every loosening
 * makes a false match likelier, and a false match here is a misposting nobody
 * downstream can detect.
 */
function normName(value: string | null | undefined): string {
  return norm(value)
    .replace(/[-_/&,.()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Propose one provider account per unmapped auxx account.
 *
 * ## Precedence, and why it is this order
 *
 * | Rank | Reason | Evidence |
 * | --- | --- | --- |
 * | 1 | `number` | the provider account carries the same account NUMBER |
 * | 2 | `name` | the same normalised name, and only one candidate has it |
 *
 * The number wins because it is the one field in a chart of accounts that people
 * maintain deliberately and rarely reuse. Names are chosen for readability and
 * collide constantly - QuickBooks alone ships several accounts containing
 * "Income" - so a name match is offered only when no number matches at all.
 *
 * ⚠️ There is deliberately no third rank matching the two `accountType` strings.
 * Ours is the five-way statement classification (`'asset'`); a provider's is its
 * own detailed subtype (`'Other Current Asset'`), and the two vocabularies never
 * compare equal. The classification filter above is where type already does its
 * work, and a rank that could never fire would only read as though the matcher
 * were more careful than it is.
 *
 * 🛑 **Ambiguity yields NO suggestion, never the first hit.** Two candidates
 * tying at the same rank means the evidence does not distinguish them, and
 * picking one would hide that fact behind an answer that looks decided. The
 * account is left unmapped and the person chooses. This is `matchAccount`'s rule
 * in `quickbooks-accounting-provider.ts` and it is the same rule for the same
 * reason.
 *
 * 🛑 **Inactive provider accounts are never suggested.** Mapping to one produces
 * a confirmed mapping that fails its next revalidation, which is a worse outcome
 * than never having suggested it.
 *
 * @param accounts the org's own live chart
 * @param providerAccounts the connected provider's chart
 * @param alreadyMapped `gl_account` ids that already carry a mapping - skipped,
 *   because a suggestion must never appear to compete with a human's confirmation
 */
export function suggestAccountIdentities(
  accounts: readonly ChartAccountRow[],
  providerAccounts: readonly ProviderAccount[],
  alreadyMapped: ReadonlySet<string> = new Set()
): AccountSuggestion[] {
  const candidates = providerAccounts.filter((a) => a.active)

  const suggestions: AccountSuggestion[] = []
  for (const account of accounts) {
    if (alreadyMapped.has(account.id)) continue

    // The filter, not a tiebreak. See the file header.
    const compatible = candidates.filter((c) => c.classification === account.accountType)
    if (compatible.length === 0) continue

    const byNumber = pickOne(
      compatible,
      (c) => norm(c.number) !== '' && norm(c.number) === norm(account.code)
    )
    if (byNumber) {
      suggestions.push({ glAccountId: account.id, account: byNumber, reason: 'number' })
      continue
    }

    const byName = pickByName(compatible, account)
    if (byName) suggestions.push({ glAccountId: account.id, account: byName, reason: 'name' })
  }

  return suggestions
}

/**
 * The one provider account sharing this account's name, or null.
 *
 * Matches either the plain name or the fully-qualified one, because a provider
 * that nests accounts reports `'Sales:Product Income'` where our chart simply
 * says `'Product Income'`, and either spelling agreeing is the same evidence.
 *
 * Ambiguity yields null rather than the first hit - see the header.
 */
function pickByName(
  compatible: readonly ProviderAccount[],
  account: ChartAccountRow
): ProviderAccount | null {
  const wanted = normName(account.name)
  if (!wanted) return null

  return pickOne(
    compatible,
    (c) => normName(c.name) === wanted || normName(c.fullyQualifiedName) === wanted
  )
}

/** The single account matching a predicate, or null when none or several do. */
function pickOne(
  candidates: readonly ProviderAccount[],
  predicate: (account: ProviderAccount) => boolean
): ProviderAccount | null {
  const hits = candidates.filter(predicate)
  return hits.length === 1 ? hits[0]! : null
}

/**
 * Is a confirmed mapping still safe to post through?
 *
 * `G19`: "every close revalidates existence, active status, and type
 * compatibility". This is that check, as one function, so the resolver and the
 * settings screen cannot come to disagree about what "still valid" means.
 *
 * @returns null when the mapping is good, else the sentence explaining what broke
 */
export function validateProviderMapping(
  account: ChartAccountRow,
  providerAccount: ProviderAccount | undefined | null,
  providerAccountId: string
): string | null {
  if (!providerAccount) {
    return `${account.code} ${account.name} is mapped to an account that no longer exists in the connected accounting system (id ${providerAccountId}). Re-map it.`
  }
  if (!providerAccount.active) {
    return `${account.code} ${account.name} is mapped to '${providerAccount.fullyQualifiedName}', which has been deactivated. Reactivate it or map ${account.code} to another account.`
  }
  if (providerAccount.classification !== account.accountType) {
    return `${account.code} ${account.name} is ${classificationArticle(account.accountType)} account but is mapped to '${providerAccount.fullyQualifiedName}', which is ${providerAccount.classification}. Posting to it would balance and still be wrong.`
  }
  return null
}

/** Type-compatible, active, and therefore offerable in a picker for `account`. */
export function isMappableTo(
  account: Pick<ChartAccountRow, 'accountType'>,
  providerAccount: ProviderAccount
): boolean {
  return providerAccount.active && providerAccount.classification === account.accountType
}
