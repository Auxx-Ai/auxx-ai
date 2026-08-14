// packages/lib/src/data-migrations/migrations/085-multi-email-website-flip.test.ts

import { describe, expect, it } from 'vitest'
import { MULTI_FLIP_SYSTEM_ATTRIBUTES, mergeMultiIntoOptions } from './085-multi-email-website-flip'

/**
 * Pure-logic tests only (no DB — same reasoning as
 * `072-mail-filters-limit.test.ts`): `mergeMultiIntoOptions` is the entire
 * behavior surface. Everything DB-shaped in `run()` is fetch-rows /
 * call-this-function / write-rows-that-changed.
 *
 * The load-bearing behavior: existing option keys survive the flip. A clobber
 * here would silently wipe display options, validation, and provider config
 * on every org's seeded email/website field.
 */
describe('mergeMultiIntoOptions', () => {
  it('merges multi: true into existing options without clobbering other keys', () => {
    const merged = mergeMultiIntoOptions({
      truncateLength: 40,
      copyValue: true,
      relationship: { cardinality: 'one' },
    })

    expect(merged).toEqual({
      truncateLength: 40,
      copyValue: true,
      relationship: { cardinality: 'one' },
      multi: true,
    })
  })

  it('handles a NULL options blob (seeded rows without options)', () => {
    expect(mergeMultiIntoOptions(null)).toEqual({ multi: true })
    expect(mergeMultiIntoOptions(undefined)).toEqual({ multi: true })
  })

  it('replaces non-object blobs instead of spreading them', () => {
    expect(mergeMultiIntoOptions('legacy')).toEqual({ multi: true })
    expect(mergeMultiIntoOptions([1, 2])).toEqual({ multi: true })
  })

  it('is idempotent — an already-multi blob stays unchanged', () => {
    const blob = { multi: true, truncateLength: 20 }
    expect(mergeMultiIntoOptions(blob)).toEqual(blob)
  })

  it('does not mutate the input blob', () => {
    const blob = { truncateLength: 20 }
    mergeMultiIntoOptions(blob)
    expect(blob).toEqual({ truncateLength: 20 })
  })
})

describe('MULTI_FLIP_SYSTEM_ATTRIBUTES', () => {
  // Phone is flipped by migration 086, not by extending this list: 085 has
  // already run everywhere, and a data migration is applied once — a new
  // attribute added here would silently no-op for every existing org.
  it('flips EMAIL + WEBSITE only', () => {
    expect([...MULTI_FLIP_SYSTEM_ATTRIBUTES]).toEqual(['primary_email', 'company_website'])
    expect(MULTI_FLIP_SYSTEM_ATTRIBUTES).not.toContain('phone')
  })
})
