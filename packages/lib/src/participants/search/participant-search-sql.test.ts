// packages/lib/src/participants/search/participant-search-sql.test.ts
//
// Only the aliased form exists to assert, and that is deliberate rather than a
// test limitation — see the binding's own doc. Rendered SQL is checked because
// what matters is index-servability, and that is a property of the emitted text
// (`% ` vs a bare `similarity()`), not of the values.

import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  participantDisplayLabel,
  participantRecencyScore,
  participantSearchBinding,
  participantSearchPredicate,
  participantSearchRank,
} from './participant-search-sql'

const dialect = new PgDialect()
const P = participantSearchBinding('p')
const render = (fragment: Parameters<PgDialect['sqlToQuery']>[0]) => dialect.sqlToQuery(fragment)

describe('participantSearchPredicate', () => {
  it('emits three arms: fuzzy displayName, displayName ILIKE, identifier ILIKE', () => {
    const { sql: text } = render(participantSearchPredicate('klooth', P))
    expect(text).toContain(`(p."displayName" % $1 AND similarity(p."displayName", $2) > 0.3)`)
    expect(text).toContain(`p."displayName" ILIKE $3`)
    expect(text).toContain(`p."identifier" ILIKE $4`)
  })

  it('🔴 keeps the `%` operator beside the explicit similarity comparison', () => {
    // The two say the same thing on purpose. `gin_trgm_ops` indexes the OPERATORS
    // only, so a bare `similarity() > 0.3` can never be an index condition — and
    // inside an OR block one unindexable arm forfeits the other arms' indexes
    // too. Measured: 0.35 ms with the bitmap, 32.6 ms without it.
    const { sql: text } = render(participantSearchPredicate('klooth', P))
    expect(text).toContain('p."displayName" % ')
    expect(text).toContain('similarity(p."displayName"')
  })

  it('emits NO tsvector arm — Participant has no corpus', () => {
    const { sql: text } = render(participantSearchPredicate('klooth', P))
    expect(text).not.toContain('to_tsvector')
    expect(text).not.toContain('plainto_tsquery')
  })

  it('emits NO name arm — redundant with displayName by construction', () => {
    const { sql: text } = render(participantSearchPredicate('klooth', P))
    expect(text).not.toContain('p."name"')
  })

  it('adds one identifier arm per phone pattern, and none for an empty list', () => {
    const none = render(participantSearchPredicate('klooth', P, []))
    expect(none.sql.match(/p\."identifier" ILIKE/g)).toHaveLength(1)

    const two = render(participantSearchPredicate('030 901820', P, ['4930901820', '30901820']))
    expect(two.sql.match(/p\."identifier" ILIKE/g)).toHaveLength(3) // base arm + 2 patterns
    expect(two.params).toContain('%4930901820%')
    expect(two.params).toContain('%30901820%')
  })

  it('returns a parenthesized block, so AND-ing it cannot reassociate the WHERE', () => {
    // An unparenthesized OR chain AND-ed into a WHERE widens the result set past
    // every other filter — including the org scope.
    const { sql: text } = render(participantSearchPredicate('klooth', P))
    expect(text.startsWith('(')).toBe(true)
    expect(text.endsWith(')')).toBe(true)
  })

  it('respects the alias it was built with', () => {
    const { sql: text } = render(
      participantSearchPredicate('klooth', participantSearchBinding('cand'))
    )
    expect(text).toContain('cand."displayName"')
    expect(text).not.toContain('p."displayName"')
  })
})

describe('participantSearchRank', () => {
  it('weights name 2, identifier 1, recency 0.25', () => {
    const { sql: text } = render(participantSearchRank('klooth', P))
    expect(text).toContain(`COALESCE(similarity(p."displayName", $1), 0) * 2`)
    expect(text).toContain(`COALESCE(similarity(p."identifier", $2), 0) * 1`)
    expect(text).toContain('* 0.25')
  })

  it('COALESCEs every arm, so a row matching one arm still ranks', () => {
    const { sql: text } = render(participantSearchRank('klooth', P))
    // Three COALESCEs: name, identifier, and the recency term's own.
    expect(text.match(/COALESCE\(/g)?.length).toBe(3)
  })

  it('takes the name weight from the shared TRIGRAM_WEIGHT rather than retyping 2', async () => {
    // Guards the drift the shared module exists to prevent: records, mail and
    // participants must weight their name arm with the same number.
    const { TRIGRAM_WEIGHT } = await import('../../search/text-search-sql')
    const weight = render(TRIGRAM_WEIGHT).sql
    const { sql: text } = render(participantSearchRank('klooth', P))
    expect(weight).toBe('2')
    expect(text).toContain(`COALESCE(similarity(p."displayName", $1), 0) * ${weight}`)
  })
})

describe('participantDisplayLabel', () => {
  it('COALESCEs the usable contact name over the participant displayName', () => {
    const { sql: text } = render(participantDisplayLabel(P, 'ct'))
    // Blank/NULL contact names collapse to NULL…
    expect(text).toContain(`WHEN BTRIM(COALESCE(ct."displayName", '')) = '' THEN NULL`)
    // …and a contact whose display value IS the identifier must not masquerade
    // as a name — same rule as `usableContactName` in `../client.ts`.
    expect(text).toContain(
      `WHEN LOWER(BTRIM(ct."displayName")) = LOWER(BTRIM(p."identifier")) THEN NULL`
    )
    expect(text).toContain(`ELSE BTRIM(ct."displayName")`)
    expect(text).toContain(`p."displayName")`)
  })

  it('🔴 stays out of the match predicate and the rank — label only', () => {
    // A contact renamed five minutes ago must still be findable by the old
    // header name, and the trigram indexes only cover the stored columns.
    const contactRef = 'ct."displayName"'
    expect(render(participantSearchPredicate('klooth', P)).sql).not.toContain(contactRef)
    expect(render(participantSearchRank('klooth', P)).sql).not.toContain(contactRef)
  })

  it('respects both aliases it was built with', () => {
    const { sql: text } = render(participantDisplayLabel(participantSearchBinding('cand'), 'ei2'))
    expect(text).toContain('ei2."displayName"')
    expect(text).toContain('cand."identifier"')
    expect(text).not.toContain('ct."displayName"')
    expect(text).not.toContain('p."displayName"')
  })
})

describe('participantRecencyScore', () => {
  it('is bounded and saturating, which is what makes the 0.25 weight derivable', () => {
    const { sql: text } = render(participantRecencyScore(P))
    // 1/(1+age) — strictly decreasing, supremum 1, so the weighted arm caps at 0.25.
    expect(text).toContain('1.0 / (1.0 + EXTRACT(EPOCH FROM (now() - p."lastSentMessageAt"))')
    expect(text).toContain('2592000.0')
  })

  it('scores a never-mailed participant 0 rather than NULL', () => {
    // A NULL here would null the whole rank expression and drop the row from any
    // ordering that compares it.
    const { sql: text } = render(participantRecencyScore(P))
    expect(text).toMatch(/^COALESCE\(/)
    expect(text).toContain(', 0)')
  })
})
