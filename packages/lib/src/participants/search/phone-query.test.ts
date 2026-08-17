// packages/lib/src/participants/search/phone-query.test.ts
//
// Every case here is one that a `query.replace(/\D/g, '')` implementation gets
// wrong or misses. The NANP ones it gets right by luck; the trunk-prefix ones are
// the reason this function exists.

import { describe, expect, it } from 'vitest'
import { phoneSearchPatterns } from './phone-query'

/** Does any pattern match the stored E.164 the way the SQL arm would? */
const matches = (patterns: string[], stored: string) => patterns.some((p) => stored.includes(p))

describe('phoneSearchPatterns — trunk-prefix regions', () => {
  it('🔴 finds a Berlin number typed the way it is printed', () => {
    // The whole point. A `\D` strip yields '030901820', which is NOT a substring
    // of '+4930901820' — E.164 drops the trunk 0.
    const patterns = phoneSearchPatterns('030 901820', 'DE')
    expect(matches(patterns, '+4930901820')).toBe(true)
    expect(patterns).toContain('30901820')
  })

  it('finds a London number typed nationally', () => {
    const patterns = phoneSearchPatterns('020 7183 8750', 'GB')
    expect(matches(patterns, '+442071838750')).toBe(true)
  })

  it('a bare digit strip would NOT have matched either — pinning the contrast', () => {
    for (const [typed, stored] of [
      ['030 901820', '+4930901820'],
      ['020 7183 8750', '+442071838750'],
    ] as const) {
      expect(stored.includes(typed.replace(/\D/g, ''))).toBe(false)
    }
  })
})

describe('phoneSearchPatterns — NANP', () => {
  it('matches a fully typed US number in any common formatting', () => {
    for (const typed of ['(415) 555-1234', '415.555.1234', '415 555 1234', '+1 415 555 1234']) {
      expect(matches(phoneSearchPatterns(typed, 'US'), '+14155551234')).toBe(true)
    }
  })

  it('matches a partial number, which never parses to a VALID one', () => {
    // A fragment either fails to parse or parses to something `isValid()` rejects,
    // so the raw-digits pattern is the only one that can carry it — which is why
    // that pattern is unconditional rather than an `else` branch.
    expect(matches(phoneSearchPatterns('(415) 555', 'US'), '+14155551234')).toBe(true)
    expect(matches(phoneSearchPatterns('4155551', 'US'), '+14155551234')).toBe(true)
  })
})

describe('phoneSearchPatterns — the region parameter earns its keep', () => {
  it('produces different patterns for the same digits in different regions', () => {
    const asGb = phoneSearchPatterns('020 7183 8750', 'GB')
    const asUs = phoneSearchPatterns('020 7183 8750', 'US')
    expect(matches(asGb, '+442071838750')).toBe(true)
    // US cannot parse it, so it falls back to raw digits and finds nothing.
    expect(matches(asUs, '+442071838750')).toBe(false)
    expect(asGb).not.toEqual(asUs)
  })
})

describe('phoneSearchPatterns — the trigram floor', () => {
  it('returns [] below three digits, because no full trigram is extractable', () => {
    // Not "match everything" — [] means the caller adds no phone arm at all. An
    // ILIKE '%xy%' has no index to use and would drop the whole OR block to a
    // sequential scan.
    expect(phoneSearchPatterns('4', 'US')).toEqual([])
    expect(phoneSearchPatterns('41', 'US')).toEqual([])
    expect(phoneSearchPatterns('(4', 'US')).toEqual([])
  })

  it('returns [] for input with no digits at all', () => {
    expect(phoneSearchPatterns('klooth', 'US')).toEqual([])
    expect(phoneSearchPatterns('', 'US')).toEqual([])
    expect(phoneSearchPatterns('   ', 'US')).toEqual([])
  })

  it('admits exactly three digits, and invents nothing from them', () => {
    // Not `['1415', '415']`: `parsePhoneNumberFromString('415', 'US')` parses to
    // `+1415`, which is not a valid number. Its patterns would include a
    // synthetic '1415' that matches unrelated numbers like '+13161415000' — an
    // arm nobody typed. Hence the `isValid()` gate.
    expect(phoneSearchPatterns('415', 'US')).toEqual(['415'])
  })

  it('contributes no parsed patterns for a fragment that only LOOKS parseable', () => {
    for (const fragment of ['415', '4155', '41555']) {
      // Only the raw digits survive — one arm, exactly what was typed.
      expect(phoneSearchPatterns(fragment, 'US')).toEqual([fragment])
    }
  })

  it('never returns a pattern shorter than the floor', () => {
    for (const typed of ['415', '4155', '(415) 555-1234', '030 901820', '+49 30 901820']) {
      for (const pattern of phoneSearchPatterns(typed, 'DE')) {
        expect(pattern.length).toBeGreaterThanOrEqual(3)
      }
    }
  })
})

describe('phoneSearchPatterns — shape', () => {
  it('deduplicates, so a fully typed national number is not three identical probes', () => {
    const patterns = phoneSearchPatterns('4155551234', 'US')
    expect(new Set(patterns).size).toBe(patterns.length)
  })

  it('keeps the arm count small — at most three probes', () => {
    for (const typed of ['(415) 555-1234', '030 901820', '+442071838750', '415555']) {
      expect(phoneSearchPatterns(typed, 'DE').length).toBeLessThanOrEqual(3)
    }
  })

  it('strips the + so patterns are substrings of the stored identifier', () => {
    // An E.164 pattern WITH the `+` would still match, but the national and raw
    // forms would not — and the point is that all arms search the same way.
    for (const pattern of phoneSearchPatterns('+14155551234', 'US')) {
      expect(pattern.startsWith('+')).toBe(false)
    }
  })

  it('is idempotent on an already-E.164 input', () => {
    expect(matches(phoneSearchPatterns('+4930901820', 'US'), '+4930901820')).toBe(true)
    expect(matches(phoneSearchPatterns('+14155551234', 'DE'), '+14155551234')).toBe(true)
  })
})
