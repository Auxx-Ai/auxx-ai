// packages/lib/src/dedup/__tests__/name-match.test.ts
//
// Pure — no db. The structured comparator, the JS↔Postgres trigram parity, the
// name-alone rule, and the medium band it produces.
//
// The measured pairs from the plan's Design table are the required suite. They
// are asserted twice over: once as the raw `similarity()` numbers (to pin the JS
// reimplementation to Postgres) and once as the rule's verdict (to pin the
// behaviour those numbers argued for).

import { describe, expect, it } from 'vitest'
import {
  compareStructuredNames,
  decideNameSignal,
  type NameComparison,
  normalizeSurname,
  trigramSimilarity,
} from '../name-match'
import { bandForScore, scorePair, scoreSignals } from '../scoring'
import type { Signal } from '../types'

const CLOSE = 6

describe('trigramSimilarity — reproduces pg_trgm exactly', () => {
  // Every expectation here was measured against the dev database on 2026-08-14.
  // If Postgres and this function ever disagree, the surname threshold means
  // something different in SQL than it does in JS and the rule quietly drifts.
  it('matches the measured full-name scores', () => {
    expect(trigramSimilarity('john smith', 'jane smith')).toBeCloseTo(0.4666667, CLOSE)
    expect(trigramSimilarity('william klooth', 'bill klooth')).toBeCloseTo(0.4210526, CLOSE)
    expect(trigramSimilarity('bob smith', 'robert smith')).toBeCloseTo(0.3529412, CLOSE)
    expect(trigramSimilarity('peggy klooth', 'margaret klooth')).toBeCloseTo(0.3181818, CLOSE)
  })

  it('shows why full-name similarity is unusable as a score', () => {
    // A DIFFERENT PERSON outranks every true nickname pair. This is the
    // measurement the whole Phase-2 design turns on, so it is asserted, not
    // just commented.
    const differentPeople = trigramSimilarity('john smith', 'jane smith')
    expect(differentPeople).toBeGreaterThan(trigramSimilarity('william klooth', 'bill klooth'))
    expect(differentPeople).toBeGreaterThan(trigramSimilarity('bob smith', 'robert smith'))
    expect(differentPeople).toBeGreaterThan(trigramSimilarity('peggy klooth', 'margaret klooth'))
  })

  it('matches the measured surname scores — where trigram IS good', () => {
    expect(trigramSimilarity('klooth', 'klooth')).toBe(1)
    expect(trigramSimilarity('klooth', 'kloth')).toBeCloseTo(0.625, CLOSE)
  })

  it('returns zero for the nickname pairs, at any threshold', () => {
    // Not a tuning problem: the relation is lexical convention, not spelling.
    expect(trigramSimilarity('bob', 'robert')).toBe(0)
    expect(trigramSimilarity('peggy', 'margaret')).toBe(0)
  })

  it('tokenizes like pg_trgm does', () => {
    // `show_trgm('o''brien-smith')` splits on the apostrophe AND the hyphen.
    expect(normalizeSurname("O'Brien-Smith")).toBe('o brien smith')
    expect(trigramSimilarity('jon', 'jonathan')).toBeCloseTo(0.3, CLOSE)
  })
})

describe('compareStructuredNames', () => {
  it('matches a nickname on an exact surname', () => {
    const result = compareStructuredNames(
      { firstName: 'Bill', lastName: 'Klooth' },
      { firstName: 'William', lastName: 'Klooth' }
    )
    expect(result).toMatchObject({ givenName: 'nickname', reversed: false, matched: true })
    expect(result.surname).toMatchObject({ kind: 'exact', similarity: 1 })
  })

  it('tolerates a surname typo via trigram', () => {
    const result = compareStructuredNames(
      { firstName: 'William', lastName: 'Klooth' },
      { firstName: 'William', lastName: 'Kloth' }
    )
    expect(result.matched).toBe(true)
    expect(result.surname).toMatchObject({ kind: 'fuzzy' })
    expect(result.surname?.similarity).toBeCloseTo(0.625, CLOSE)
  })

  it('rejects a surname below the threshold', () => {
    const result = compareStructuredNames(
      { firstName: 'William', lastName: 'Klooth' },
      { firstName: 'William', lastName: 'Kloosterman' }
    )
    expect(result.surname).toBeNull()
    expect(result.matched).toBe(false)
  })

  it('recovers a record whose importer swapped the name columns', () => {
    const result = compareStructuredNames(
      { firstName: 'William', lastName: 'Klooth' },
      { firstName: 'Klooth', lastName: 'Bill' }
    )
    expect(result).toMatchObject({ reversed: true, matched: true, givenName: 'nickname' })
  })

  it('does not relabel a genuine direct match as reversed', () => {
    // Both parts are plausible given names, so the reversed orientation would
    // also "work" — the direct attempt has to win.
    const result = compareStructuredNames(
      { firstName: 'James', lastName: 'Thomas' },
      { firstName: 'Jim', lastName: 'Thomas' }
    )
    expect(result).toMatchObject({ reversed: false, matched: true })
  })

  it('refuses to match on a missing surname', () => {
    const result = compareStructuredNames(
      { firstName: 'William', lastName: null },
      { firstName: 'Bill', lastName: null }
    )
    expect(result.matched).toBe(false)
  })

  it('keeps John Smith and Jane Smith apart on the given name', () => {
    const result = compareStructuredNames(
      { firstName: 'John', lastName: 'Smith' },
      { firstName: 'Jane', lastName: 'Smith' }
    )
    expect(result.surname).toMatchObject({ kind: 'exact' })
    expect(result.givenName).toBeNull()
    expect(result.matched).toBe(false)
  })
})

// ── The name-alone rule, over the plan's required suite ──────────────────────

const compare = (a: [string, string], b: [string, string]): NameComparison =>
  compareStructuredNames({ firstName: a[0], lastName: a[1] }, { firstName: b[0], lastName: b[1] })

/** Score the signals the rule produced, the way the scan job will. */
const bandFor = (signals: Signal[]) => {
  const scored = scorePair({
    organizationId: 'org_1',
    entityDefinitionId: 'def_1',
    instanceIdLow: 'a',
    instanceIdHigh: 'b',
    signals,
  })
  return scored?.band ?? null
}

const companySignal: Signal = { type: 'company', strength: 'corroborating', value: 'Acme' }

describe('the name-alone rule (the required suite)', () => {
  it('bill klooth / william klooth — rare surname, nickname hit → MEDIUM on name alone', () => {
    const { signal } = decideNameSignal({
      comparison: compare(['Bill', 'Klooth'], ['William', 'Klooth']),
      surnameRare: true,
      hasCorroboration: false,
    })
    expect(signal).toMatchObject({ type: 'name', strength: 'fuzzy', value: 'klooth' })
    expect(bandFor([signal as Signal])).toBe('medium')
  })

  it('peggy / margaret, same rare surname → medium (the dictionary is the only path)', () => {
    const comparison = compare(['Peggy', 'Klooth'], ['Margaret', 'Klooth'])
    expect(comparison.givenName).toBe('nickname')
    const { signal } = decideNameSignal({
      comparison,
      surnameRare: true,
      hasCorroboration: false,
    })
    expect(bandFor([signal as Signal])).toBe('medium')
  })

  it('john smith / jane smith → DROPPED, whatever the surname rarity says', () => {
    // The regression test for the entire name rule. Asserted at BOTH extremes of
    // condition (c): even in an org where `smith` happens to be rare, the given
    // names are not equivalent and no signal is produced.
    for (const surnameRare of [true, false]) {
      for (const hasCorroboration of [true, false]) {
        const outcome = decideNameSignal({
          comparison: compare(['John', 'Smith'], ['Jane', 'Smith']),
          surnameRare,
          hasCorroboration,
        })
        expect(outcome.signal).toBeNull()
        expect(outcome.reason).toBe('no-name-match')
      }
    }
  })

  it('bob smith / robert smith — dictionary hit, common surname → needs corroboration', () => {
    const comparison = compare(['Bob', 'Smith'], ['Robert', 'Smith'])
    expect(comparison.matched).toBe(true)

    const alone = decideNameSignal({ comparison, surnameRare: false, hasCorroboration: false })
    expect(alone.signal).toBeNull()
    expect(alone.reason).toBe('needs-corroboration')

    const corroborated = decideNameSignal({
      comparison,
      surnameRare: false,
      hasCorroboration: true,
    })
    expect(corroborated.reason).toBe('corroborated')
    expect(bandFor([corroborated.signal as Signal, companySignal])).toBe('medium')
  })

  it('jon / jonathan at the same company → medium via corroboration', () => {
    const comparison = compare(['Jon', 'Smith'], ['Jonathan', 'Smith'])
    expect(comparison.matched).toBe(true)

    const { signal } = decideNameSignal({
      comparison,
      surnameRare: false,
      hasCorroboration: true,
    })
    expect(bandFor([signal as Signal, companySignal])).toBe('medium')
  })
})

describe('scoreSignals — the medium band', () => {
  const nameSignal: Signal = { type: 'name', strength: 'fuzzy', value: 'klooth' }

  it('puts a bare name match exactly on the medium floor', () => {
    expect(scoreSignals([nameSignal])).toBe(0.5)
    expect(bandForScore(0.5)).toBe('medium')
  })

  it('scores corroboration at zero without something to promote', () => {
    // Not "a little" — zero. Three corroborators summing past the floor would
    // suggest a merge for two genuine colleagues at one company and address.
    expect(
      scoreSignals([
        companySignal,
        { type: 'address', strength: 'corroborating', value: '1 main st' },
        { type: 'ingest', strength: 'corroborating', value: '2026-08-14T00:00:00.000Z' },
      ])
    ).toBe(0)
  })

  it('never lets corroboration lift a name match into HIGH', () => {
    // `high` means an exact key matched. A name plus every corroborator we have
    // is still `medium`.
    const band = bandFor([
      nameSignal,
      companySignal,
      { type: 'address', strength: 'corroborating', value: '1 main st' },
      { type: 'identity', strength: 'corroborating', value: 'shopify' },
      { type: 'ingest', strength: 'corroborating', value: '2026-08-14T00:00:00.000Z' },
    ])
    expect(band).toBe('medium')
  })

  it('weighs a corroborating identity signal far below a strong one', () => {
    // Same TYPE, different strength — weighing by type alone would push a pair
    // to `high` because two records came from different systems.
    const strong = scoreSignals([{ type: 'identity', strength: 'strong', value: 'shopify:99' }])
    const weak = scoreSignals([
      { type: 'name', strength: 'fuzzy', value: 'klooth' },
      { type: 'identity', strength: 'corroborating', value: 'shopify' },
    ])
    expect(bandForScore(strong)).toBe('high')
    expect(bandForScore(weak)).toBe('medium')
  })

  it('counts a type once, at its higher strength', () => {
    const score = scoreSignals([
      { type: 'identity', strength: 'strong', value: 'shopify:99' },
      { type: 'identity', strength: 'corroborating', value: 'shopify' },
    ])
    expect(score).toBe(0.9)
  })
})
