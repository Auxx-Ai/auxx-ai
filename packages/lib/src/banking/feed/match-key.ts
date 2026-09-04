// packages/lib/src/banking/feed/match-key.ts

/**
 * `description` → `matchKey`: the one piece of enrichment this subsystem gets to do
 * for itself.
 *
 * 🛑 **Stripe Financial Connections has no merchant enrichment and no categories**
 * (plans/bank-connection/01 §4.2 (3)). There is no `counterparty` object, no cleaned
 * merchant name, no PFC taxonomy - a `description` string and nothing else. So
 * "the last six lines matching this key were coded to 6100" is not a supplement to a
 * better signal, it is the PRIMARY categorisation mechanism, and the quality of this
 * function is the quality of every suggestion the review queue will ever make.
 *
 * 🛑 **It lives here and not in a CALC expression**, because CALC has no regex and no
 * replace (plans/accounting/implementation-review.md §2). The connector shapes it in
 * `fetch()` and emits it as a pre-shaped field, which is the same thing `fixture.ts`
 * does with its records.
 *
 * ⚠️ It is deliberately LOSSY and one-way. The raw string is kept verbatim on
 * `bank_transaction.description`; this is a grouping key, never a display value and
 * never something to reconcile against. Two different merchants can collide into one
 * key and that is an acceptable cost - a wrong suggestion a human declines is cheaper
 * than no suggestion at all, which is the state Stripe leaves us in.
 *
 * Pure, dependency-free and exhaustively tested, because every rule below is a
 * judgement call about what varies between two occurrences of the same merchant.
 */

/** Month names, for the two date shapes a bank writes without slashes. */
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec'

/**
 * The strip rules, applied IN ORDER. Order matters twice and the tests pin both:
 * dates go before masked suffixes (or `***** 12/31` loses its `12` to the mask and
 * strands a `31`), and masked suffixes go before the bare digit-run rule (or
 * `xxxx1234` loses its digits and leaves a meaningless `xxxx` that groups every card
 * in the org together).
 */
const STRIP_RULES: readonly RegExp[] = [
  // ── Dates first ────────────────────────────────────────────────────────────
  // Before the mask rules, and the ordering is pinned by a test. `***** 12/31` is a
  // real BoA shape: run the masks first and `***** 12` is eaten as a masked suffix,
  // leaving a stray `31` that then groups every line of that month together.
  // ISO dates and slashed/dotted dates, with or without a year.
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b/g,
  // ── Then reference labels and masked suffixes ──────────────────────────────
  // Masked card / account suffixes, in every shape a US bank prints them:
  // `xxxx1234`, `****1234`, `x1234`, `...1234`, `ending in 1234`, `card 1234`,
  // `acct 1234`, `ref 998877`, `trace 889900`. The digits ARE the reference, so the
  // label goes with them - keeping a bare `ref` in the key adds nothing and makes
  // every ACH line look slightly more alike than it is.
  /\b(?:ending\s+in|card|acct|account|ref|trace|trn)\s*#?\s*[x*.·-]*\d{2,}\b/g,
  // ⚠️ The lookbehind is load-bearing: without it the `x` at the end of a merchant
  // name eats itself, and `MAX 1234` normalises to `ma`.
  /(?<![a-z])[x*.·#]{1,}\s?\d{2,}\b/g,
  // `12 mar`, `mar 12`, `mar 12 2026`. The month name goes with the number: a merchant
  // name that is genuinely "March" is rarer than a statement line that carries a date.
  new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})[a-z]*\\b`, 'g'),
  new RegExp(`\\b(?:${MONTHS})[a-z]*\\s+\\d{1,2}(?:\\s+\\d{2,4})?\\b`, 'g'),
  // Times, which arrive on card-present lines: `14:32`, `02:15:09`.
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  // Any remaining run of MORE than three digits - trace numbers, ACH ids, terminal
  // ids, invoice numbers. Three is the threshold because a store number (`store 42`)
  // and a highway (`i 95`) genuinely identify the merchant, while four digits almost
  // never do.
  //
  // ⚠️ Not `\b`-anchored on the left, deliberately: `ppd1234567` and `id#00998877`
  // are one token to a word boundary, and leaving the digits in would make every
  // occurrence of that merchant a unique key, which is the exact failure this
  // function exists to prevent.
  /\d{4,}/g,
]

/**
 * Normalise a bank `description` into a stable grouping key.
 *
 * Lowercases, strips card suffixes, dates, times and long digit runs, folds every
 * remaining non-alphanumeric character to a single space, and trims.
 *
 * Returns `''` for input that is empty or reduces to nothing (a line whose whole
 * description was a trace number). 🛑 The empty string is a legitimate answer and the
 * callers must treat it as "no key", never as a key that groups: matching every
 * reference-number-only line together would suggest one merchant's coding for all of
 * them.
 */
export function normalizeMatchKey(description: string | null | undefined): string {
  if (!description) return ''
  let value = description.toLowerCase()
  for (const rule of STRIP_RULES) {
    value = value.replace(rule, ' ')
  }
  // Everything that is not a letter, a digit or a space becomes a space. Punctuation
  // varies between two occurrences of the same merchant (`sq *coffee` vs `sq*coffee`)
  // far more often than it distinguishes two merchants.
  value = value.replace(/[^a-z0-9]+/g, ' ')
  return value.trim().replace(/\s+/g, ' ')
}
