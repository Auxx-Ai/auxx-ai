// packages/lib/src/dedup/__tests__/nicknames.test.ts
//
// Pure — no db. The dictionary and the five given-name equivalence arms.

import { describe, expect, it } from 'vitest'
import {
  areGivenNamesEquivalent,
  canonicalGivenNames,
  givenNameEquivalence,
  NICKNAME_CANONICAL_COUNT,
  NICKNAME_NAME_COUNT,
  normalizeGivenName,
} from '../nicknames'

describe('the dictionary itself', () => {
  it('covers a substantial slice of common English given names', () => {
    // Not a target to pad towards — a floor, so a bad merge of the JSON asset
    // (or a truncated file) fails here rather than silently disarming the only
    // signal that can recover Peggy/Margaret.
    expect(NICKNAME_CANONICAL_COUNT).toBeGreaterThanOrEqual(300)
    expect(NICKNAME_NAME_COUNT).toBeGreaterThanOrEqual(1200)
  })

  it('resolves a variant to every canonical name that claims it', () => {
    // Ambiguity is modelled, not avoided: `bert` really is short for all of these.
    expect(canonicalGivenNames('bert')).toEqual(
      expect.arrayContaining(['albert', 'gilbert', 'herbert', 'robert'])
    )
  })

  it('lets an unknown name stand for itself', () => {
    expect(canonicalGivenNames('kwame')).toEqual(['kwame'])
  })

  it('does NOT make two canonical names equivalent through a shared variant', () => {
    // `chris` resolves to christopher AND christine, but christopher and
    // christine are each canonical, so their root sets never intersect.
    expect(areGivenNamesEquivalent('christopher', 'christine')).toBe(false)
    expect(areGivenNamesEquivalent('albert', 'robert')).toBe(false)
    // …while the ambiguous short form still matches either of them.
    expect(areGivenNamesEquivalent('chris', 'christine')).toBe(true)
    expect(areGivenNamesEquivalent('bert', 'robert')).toBe(true)
  })
})

describe('normalizeGivenName', () => {
  it('folds case, whitespace, diacritics and punctuation', () => {
    expect(normalizeGivenName('  Bill ')).toBe('bill')
    expect(normalizeGivenName('José')).toBe('jose')
    expect(normalizeGivenName('W.')).toBe('w')
    expect(normalizeGivenName('Mary-Anne')).toBe('maryanne')
  })

  it('is empty for a blank cell', () => {
    expect(normalizeGivenName(null)).toBe('')
    expect(normalizeGivenName('   ')).toBe('')
  })
})

describe('givenNameEquivalence — the five arms', () => {
  it('recovers nicknames no string metric can reach', () => {
    // Measured: similarity('bob','robert') = 0 and similarity('peggy','margaret')
    // = 0 — ZERO shared trigrams. The dictionary is the only mechanism for these.
    expect(givenNameEquivalence('Bob', 'Robert')).toBe('nickname')
    expect(givenNameEquivalence('Peggy', 'Margaret')).toBe('nickname')
    expect(givenNameEquivalence('Bill', 'William')).toBe('nickname')
    expect(givenNameEquivalence('Dick', 'Richard')).toBe('nickname')
  })

  it('matches an initial against the full name', () => {
    expect(givenNameEquivalence('W.', 'William')).toBe('initial')
    expect(givenNameEquivalence('J', 'Jane')).toBe('initial')
    expect(givenNameEquivalence('J', 'William')).toBeNull()
  })

  it('matches a prefix of three characters or more', () => {
    // `nath` is not in the dictionary, so this is the prefix arm.
    expect(givenNameEquivalence('Nath', 'Nathaniel')).toBe('prefix')
    // `jon` and `kim` ARE, so they resolve at higher confidence than a prefix.
    expect(givenNameEquivalence('Jon', 'Jonathan')).toBe('nickname')
    expect(givenNameEquivalence('Kim', 'Kimberly')).toBe('nickname')
    // Two characters would collapse `jo` onto joseph, joanna, john and josephine.
    expect(givenNameEquivalence('Jo', 'Jonathan')).toBeNull()
  })

  it('tolerates a single typo in a long name', () => {
    // Not in the dictionary — this is the edit-distance arm doing the work.
    expect(givenNameEquivalence('Kathrine', 'Katherine')).toBe('fuzzy')
    // These two ARE in the dictionary, so they resolve at higher confidence.
    expect(givenNameEquivalence('Micheal', 'Michael')).toBe('nickname')
    expect(givenNameEquivalence('Sara', 'Sarah')).toBe('nickname')
  })

  it('refuses edit distance on short names, where it is a trap', () => {
    // All distance 1, all different people — and none of them linked by the
    // dictionary, so nothing else rescues them either.
    expect(areGivenNamesEquivalent('Ken', 'Ben')).toBe(false)
    expect(areGivenNamesEquivalent('Dan', 'Don')).toBe(false)
    expect(areGivenNamesEquivalent('Jon', 'Ron')).toBe(false)
  })

  it('still pairs two short forms of the SAME canonical name', () => {
    // `bob` and `rob` are both Robert, so this is the dictionary arm, not the
    // edit-distance one — the length guard above must not suppress it.
    expect(givenNameEquivalence('Bob', 'Rob')).toBe('nickname')
  })

  it('refuses edit distance across a different first letter', () => {
    // Without the first-letter guard these are distance 1 and would pair.
    expect(areGivenNamesEquivalent('Kevin', 'Devin')).toBe(false)
    expect(areGivenNamesEquivalent('Jenny', 'Kenny')).toBe(false)
  })

  it('treats a blank name as absence of evidence, never as a match', () => {
    expect(areGivenNamesEquivalent('', '')).toBe(false)
    expect(areGivenNamesEquivalent(null, 'William')).toBe(false)
    expect(areGivenNamesEquivalent(undefined, undefined)).toBe(false)
  })

  it('keeps John and Jane apart — the case the whole name rule exists for', () => {
    expect(areGivenNamesEquivalent('John', 'Jane')).toBe(false)
  })
})
