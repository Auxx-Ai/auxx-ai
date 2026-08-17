// packages/lib/src/participants/search/phone-query.ts

import { type PhoneRegion, parseValidPhone } from '@auxx/utils'

/**
 * Minimum pattern length. Below three characters `pg_trgm` extracts no full
 * trigram, so an `ILIKE '%xy%'` degrades to a sequential scan no matter what is
 * indexed (`search/text-search-sql.ts` documents the same floor for its ILIKE
 * fallbacks).
 */
const TRIGRAM_FLOOR = 3

/**
 * Substring patterns to match a typed phone query against stored E.164
 * identifiers.
 *
 * 🔴 **Stripping non-digits is NOT normalization, and that was the bug this
 * function exists to prevent.** `Participant.identifier` is E.164, and E.164
 * **drops the trunk prefix** every country with one prints. So the digits a
 * German reads off their own invoice are not a substring of what we store:
 *
 * | typed | `\D`-stripped | stored | matches? |
 * |---|---|---|---|
 * | `(415) 555-1234` | `4155551234` | `+14155551234` | ✅ |
 * | `030 901820` (Berlin) | `030901820` | `+4930901820` | 🔴 **no** |
 * | `030 901820` → national | `30901820` | `+4930901820` | ✅ |
 *
 * A digit-strip-only implementation therefore works in the NANP and silently
 * finds nobody in DE/GB/FR/NL/IT — for an org sending from a German number, that
 * is every search they will ever run.
 *
 * So the query is parsed, and up to three patterns come back:
 *
 * 1. the full E.164 **without** the `+` (so it is a substring of the stored form),
 * 2. the national significant number (trunk prefix removed),
 * 3. the raw digits as typed.
 *
 * ⚠️ **(3) is kept even when parsing succeeds, deliberately.**
 * `parsePhoneNumberFromString` returns `undefined` for a partial number, which is
 * the common case while someone is still typing — so (3) cannot be the `else`
 * branch of an `if`. When the parse *does* succeed it is usually a duplicate of
 * (2) and the `Set` collapses it; when it is not, it costs one extra index probe
 * and can still match a legacy row stored without a `+`. Three probes is within
 * the budget `text-search-sql.ts` sets (the record binding spends four).
 *
 * @param query Raw user input, any formatting.
 * @param region Region national (no `+`) input is parsed against. Must come from
 *   the SENDING channel's own number (`regionFromIdentifier`), never a global
 *   default — the same input means different numbers in different regions.
 * @returns Distinct digit patterns, or `[]` when there is nothing safely
 *   searchable. **`[]` means "add no phone arm", not "match everything".**
 */
export function phoneSearchPatterns(query: string, region: PhoneRegion): string[] {
  const digits = query.replace(/\D/g, '')
  if (digits.length < TRIGRAM_FLOOR) return []

  const patterns = new Set<string>()
  // 🔴 `parseValidPhone`, not a bare parse — it carries the `isValid()` gate that
  // `formatPhoneNumber` and `lookupPhoneGeo` share, so "valid" cannot drift between
  // search and the write path. `parsePhoneNumberFromString` happily returns a
  // PhoneNumber for a fragment: `('415', 'US')` yields `+1415`, whose patterns would
  // be `1415` and `415`. That synthetic `1415` is a real false-positive arm (it
  // matches `+13161415000`), and it is invented rather than typed. An invalid or
  // partial parse contributes nothing, and the raw-digits pattern below carries the
  // fragment instead.
  const parsed = parseValidPhone(query, region)
  if (parsed) {
    // `.number` is `+4930901820`; drop the `+` so the pattern is a substring of
    // the stored identifier rather than an anchored equality.
    patterns.add(parsed.number.slice(1))
    patterns.add(parsed.nationalNumber)
  }
  patterns.add(digits)

  // A pattern can fall under the floor even when the input does not — a national
  // number of one or two digits is not a thing, but `nationalNumber` is provider
  // data and this keeps the guarantee unconditional.
  return [...patterns].filter((pattern) => pattern.length >= TRIGRAM_FLOOR)
}
