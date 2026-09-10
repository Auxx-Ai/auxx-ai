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
 * A token that mixes letters and digits and is therefore a per-payment reference:
 * `ST-F1K0R8X3L3D5`, `5Q9S115H0`, `avnwsy251`. Applied by
 * {@link stripReferenceTokens} after {@link STRIP_RULES}.
 *
 * 🛑 **This is the single highest-value rule in the function.** Measured against the
 * Auxx Ai feed of 2026-09-09 (489 lines, three accounts), the rules above alone put
 * only 65.2% of lines in a group of two or more - 210 keys, 170 of them singletons.
 * The cause is one gap: banks put their per-payment reference in a token that mixes
 * letters with digits, so the digit-run rule above never sees a run long enough to
 * strip. **Shopify payouts were 68 lines, $2.29M, and 68 distinct keys** - the
 * largest revenue stream in the book, unable to reach `MIN_HISTORY_MATCHES` even
 * once. With this rule the same feed yields 127 keys, 81 singletons, 83.4% of lines
 * in a group of 2+ (plans/accounting/tasks/11-clearing-the-review-queue.md, the
 * LANDED block).
 *
 * ⚠️ **It runs AFTER the `\d{4,}` rule, not before**, which is the opposite of what
 * the brief's follow-up (1) says. The brief's reasoning - "once the digits are gone
 * there is no mixed token left to recognise" - is true only of tokens whose digits
 * form a run of four or more, and those are exactly the ones that must NOT be
 * stripped whole: `PPD1234567` is a NACHA class code plus a trace number, and
 * `GOOGLE *ADS3197812385` an advertiser id, and both group correctly once the digits
 * alone are gone (`ppd`, `google ads`). The tokens this rule exists for -
 * `F1K0R8X3L3D5`, `5Q9S115H0`, `avnwsy251` - carry no run of four, so they reach it
 * untouched. Running it first would strip both kinds and lose the stable letter
 * stem of the first.
 */
const REFERENCE_TOKEN = /[a-z0-9]{6,}/g

/** Below this, a mixed token is a name (`WD40`, `1STDIBS`), not a reference. */
const REFERENCE_MIN_LENGTH = 6
/** Two of each: one digit is a brand (`LEVEL3`), two is a number. */
const REFERENCE_MIN_DIGITS = 2
const REFERENCE_MIN_LETTERS = 2

/**
 * The whole key names no counterparty and must not group. Anchored at both ends, so
 * `check card purchase shell oil` is untouched.
 *
 * 🛑 `Check 1660` reduces to `check` once the number is stripped, which fused all
 * eleven checks in the measured feed - **to eleven different payees** - into one key.
 * At eleven lines that reads as the `strong` confidence band and is default-selected
 * for bulk accept, so the first coded check would propose its account for ten
 * unrelated ones. A bare check number identifies nothing; `''` (no key) is the honest
 * answer and §0.1 above says it is a legitimate one.
 *
 * ⚠️ The optional trailing number is what keeps `Check 220` and `Check 1660` the same
 * answer. The digit-run rule strips four digits and keeps three, so without it a
 * short check number survives into the key and one door of this fix stays open on
 * every check numbered under 1000.
 */
const NO_COUNTERPARTY_KEY = /^checks?(?: \d{1,3})?$/

/** Is this run of letters and digits a per-payment reference rather than a name? */
function isReferenceToken(token: string): boolean {
  if (token.length < REFERENCE_MIN_LENGTH) return false
  let digits = 0
  let letters = 0
  for (const char of token) {
    if (char >= '0' && char <= '9') digits++
    else letters++
  }
  return digits >= REFERENCE_MIN_DIGITS && letters >= REFERENCE_MIN_LETTERS
}

/** Replace every {@link isReferenceToken} run with a space. Pure. */
function stripReferenceTokens(value: string): string {
  return value.replace(REFERENCE_TOKEN, (token) => (isReferenceToken(token) ? ' ' : token))
}

/**
 * Normalise a bank `description` into a stable grouping key.
 *
 * Lowercases, strips card suffixes, dates, times, long digit runs and mixed
 * letter-and-digit reference tokens, folds every remaining non-alphanumeric
 * character to a single space, and trims.
 *
 * Returns `''` for input that is empty, reduces to nothing (a line whose whole
 * description was a trace number), or reduces to a {@link NO_COUNTERPARTY_KEY} word
 * such as `check`. 🛑 The empty string is a legitimate answer and the callers must
 * treat it as "no key", never as a key that groups: matching every
 * reference-number-only line together would suggest one merchant's coding for all of
 * them.
 */
export function normalizeMatchKey(description: string | null | undefined): string {
  if (!description) return ''
  let value = description.toLowerCase()
  for (const rule of STRIP_RULES) {
    value = value.replace(rule, ' ')
  }
  value = stripReferenceTokens(value)
  // Everything that is not a letter, a digit or a space becomes a space. Punctuation
  // varies between two occurrences of the same merchant (`sq *coffee` vs `sq*coffee`)
  // far more often than it distinguishes two merchants.
  value = value.replace(/[^a-z0-9]+/g, ' ')
  const key = value.trim().replace(/\s+/g, ' ')
  return NO_COUNTERPARTY_KEY.test(key) ? '' : key
}
