// packages/lib/src/postings/__tests__/doc-number.test.ts
//
// The document number is a deterministic NATURAL KEY. Two properties make it
// worth a test file of its own:
//
//  1. `GlPosting_org_docNumber_key` is unique per org, so two entries that mint
//     the same string cannot both exist. The `-R<revision>` suffix is what keeps
//     a reversal from colliding with the entry it reverses.
//  2. The poster's layer-2 heal ("QuickBooks already holds this entry but our id
//     map does not") is a QUERY BY this string. A value that is not stable
//     across runs turns the most valuable idempotency layer into a no-op.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import { buildDocNumber, DOC_NUMBER_MAX_LENGTH, DOC_NUMBER_PREFIX } from '../doc-number'
import { POSTING_TYPES } from '../types'

describe('the prefix table covers the vocabulary', () => {
  // Exact-key equality, both directions. A subset assertion passes forever; only
  // this catches a REMOVAL, and a posting type with no prefix mints
  // `AUXX-undefined-…`, a valid string that collides with every other new type.
  it('declares a prefix for exactly the posting types that exist', () => {
    expect(Object.keys(DOC_NUMBER_PREFIX).sort()).toEqual([...POSTING_TYPES].sort())
  })

  it('gives every type a DISTINCT three-letter prefix', () => {
    const prefixes = Object.values(DOC_NUMBER_PREFIX)
    expect(new Set(prefixes).size).toBe(prefixes.length)
    for (const prefix of prefixes) expect(prefix).toMatch(/^[A-Z]{3}$/)
  })
})

describe('buildDocNumber', () => {
  it('is deterministic — the same identity always yields the same string', () => {
    const once = buildDocNumber({ postingType: 'fulfillment', periodKey: '2026-08-18' })
    const twice = buildDocNumber({ postingType: 'fulfillment', periodKey: '2026-08-18' })
    expect(once).toBe('AUXX-FUL-20260818')
    expect(twice).toBe(once)
  })

  it('compacts a period key by stripping its hyphens', () => {
    expect(buildDocNumber({ postingType: 'month_end_inventory', periodKey: '2026-08' })).toBe(
      'AUXX-INV-202608'
    )
  })

  it('separates the types — two entries on one day must not collide', () => {
    const seen = new Set(
      POSTING_TYPES.map((postingType) => buildDocNumber({ postingType, periodKey: '2026-08-18' }))
    )
    expect(seen.size).toBe(POSTING_TYPES.length)
  })

  it('fits the 21-character cap for a day key and a month key alike', () => {
    for (const postingType of POSTING_TYPES) {
      for (const periodKey of ['2026-08-18', '2026-08']) {
        expect(buildDocNumber({ postingType, periodKey }).length).toBeLessThanOrEqual(
          DOC_NUMBER_MAX_LENGTH
        )
      }
    }
  })
})

describe('the reversal suffix', () => {
  // 🛑 Required, not cosmetic. `GlPosting_org_docNumber_key` is unique per org,
  // so a reversal sharing its original's number simply cannot be written.
  it('distinguishes a reversal from the entry it reverses', () => {
    const original = buildDocNumber({ postingType: 'month_end_inventory', periodKey: '2026-08' })
    const reversal = buildDocNumber({
      postingType: 'month_end_inventory',
      periodKey: '2026-08',
      revision: 1,
    })
    expect(reversal).toBe(`${original}-R1`)
    expect(reversal).not.toBe(original)
  })

  it('distinguishes successive revisions from each other', () => {
    const keys = [0, 1, 2, 3].map((revision) =>
      buildDocNumber({ postingType: 'receipt', periodKey: '2026-08-18', revision })
    )
    expect(new Set(keys).size).toBe(4)
  })

  // Revision 0 is the original, and every document number already minted is
  // suffix-less. Adding one would re-key the whole ledger.
  it('adds NOTHING at revision 0', () => {
    expect(buildDocNumber({ postingType: 'receipt', periodKey: '2026-08-18', revision: 0 })).toBe(
      buildDocNumber({ postingType: 'receipt', periodKey: '2026-08-18' })
    )
  })

  it('still fits the cap with a suffix on a day key', () => {
    expect(
      buildDocNumber({ postingType: 'receipt', periodKey: '2026-08-18', revision: 9 }).length
    ).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
  })

  it.each([-1, 1.5, Number.NaN])('refuses a revision of %s', (revision) => {
    expect(() => buildDocNumber({ postingType: 'build', periodKey: 'BLD-0007', revision })).toThrow(
      UnprocessableEntityError
    )
  })
})

describe('the two types that key on an id rather than a date', () => {
  // `build.number`, never the cuid: two builds can complete on one day, so a
  // date key silently swallows the second.
  it('keys a build on its build number', () => {
    expect(buildDocNumber({ postingType: 'build', periodKey: 'BLD-0007' })).toBe('AUXX-BLD-BLD0007')
  })

  it('gives two builds on one day two different numbers', () => {
    expect(buildDocNumber({ postingType: 'build', periodKey: 'BLD-0007' })).not.toBe(
      buildDocNumber({ postingType: 'build', periodKey: 'BLD-0008' })
    )
  })

  // 🛑 The rule enforced structurally rather than by prose: `AUXX-BLD-<cuid>` is
  // 33 characters, and the old implementation ended in `.slice(0, 21)`, which
  // truncated it into a string two different builds could share.
  it('REFUSES a cuid rather than truncating it into a collision', () => {
    expect(() =>
      buildDocNumber({ postingType: 'build', periodKey: 'clx8k2p9q0000abcd1234efgh' })
    ).toThrow(UnprocessableEntityError)
  })

  it('names the cap and the rule in the refusal', () => {
    let message = ''
    try {
      buildDocNumber({ postingType: 'build', periodKey: 'clx8k2p9q0000abcd1234efgh' })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('21')
    expect(message).toMatch(/build\.number/)
  })

  // Shopify can issue two payouts in a day; a date key merges them into one
  // entry whose total ties to neither deposit, and 1200 Shopify Clearing then
  // cannot be reconciled.
  it('keys a payout on the payout id, so two in a day stay apart', () => {
    expect(buildDocNumber({ postingType: 'payout', periodKey: '81234567' })).not.toBe(
      buildDocNumber({ postingType: 'payout', periodKey: '81234568' })
    )
  })
})

describe('refusals', () => {
  it('refuses a blank period key rather than minting AUXX-RCP-', () => {
    expect(() => buildDocNumber({ postingType: 'receipt', periodKey: '' })).toThrow(
      UnprocessableEntityError
    )
    expect(() => buildDocNumber({ postingType: 'receipt', periodKey: '--' })).toThrow(
      UnprocessableEntityError
    )
  })

  it('refuses an undeclared posting type rather than minting AUXX-undefined-', () => {
    expect(() =>
      // @ts-expect-error — deliberately outside the closed vocabulary
      buildDocNumber({ postingType: 'invented', periodKey: '2026-08' })
    ).toThrow(UnprocessableEntityError)
  })
})
