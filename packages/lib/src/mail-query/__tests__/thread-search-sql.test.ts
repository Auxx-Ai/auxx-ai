// packages/lib/src/mail-query/__tests__/thread-search-sql.test.ts
//
// The MAIL ranking formula — its shape, asserted on rendered SQL, and its
// ordering behaviour, asserted on a model of that SQL.
//
// Two kinds of test here, and the split is deliberate:
//
//  1. **Rendered-SQL tests.** These pin the expression the database actually
//     receives — above all that the keyset cursor and the `ORDER BY` are the
//     same bytes. A cursor that disagrees with its ordering does not error, it
//     skips and duplicates rows on page 2, and mail's ranked list is full of
//     ties, so this is a live bug rather than a corner.
//  2. **Model tests.** Vitest has no Postgres, so `ts_rank_cd` and `similarity`
//     cannot be evaluated here. The model below reproduces the formula in
//     TypeScript from constants MEASURED against the dev database (see each
//     constant), and its weights are asserted against the generated SQL, so it
//     cannot silently drift from the source. What it proves is the ordering
//     property the weight was chosen for — not that Postgres implements
//     `ts_rank_cd` as documented, which the measurements already established.
//
// `schema` is mocked rather than used: under this package's Vitest setup
// `@auxx/database`'s `schema` is a Proxy whose COLUMNS read `undefined`, so a
// Drizzle-column-bound fragment renders to nonsense. The mock below is PARTIAL —
// it keeps `createSchemaMock`'s auto-vivification, because a full replacement
// makes any table another module touches at import time `undefined` and kills
// the file at collection.

import type { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  const { sql: raw } = await import('drizzle-orm')
  return {
    database: createChainableDatabaseMock(),
    schema: createSchemaMock({
      Thread: {
        id: raw.raw('"Thread"."id"'),
        subject: raw.raw('"Thread"."subject"'),
        searchText: raw.raw('"Thread"."searchText"'),
      },
    }),
  }
})

const { threadSearchCursor, threadSearchRank, threadSubjectSearchPredicate } = await import(
  '../thread-search-sql'
)

const dialect = new PgDialect()
const render = (fragment: ReturnType<typeof sql>) => dialect.sqlToQuery(fragment)

/**
 * The weights the formula is built from. Asserted against the generated SQL in
 * the first test below, so the model cannot outlive a change to the source.
 */
const TRIGRAM_WEIGHT = 2
const SUBJECT_WEIGHT = 11

/**
 * `ts_rank_cd`'s score for ONE cover of one unlabelled lexeme.
 *
 * Measured, not assumed: Postgres returns 0.1 for a single cover, 0.2 for two
 * and 0.3 for three, and — the part that matters — the same 0.1 whether the
 * document is one word or 800, because the default normalization does not divide
 * by length. That is the whole reason the body arm needs saturating.
 */
const PER_COVER = 0.1

/** `ts_rank_cd(…, 32)` — verified against the database as exactly `r / (r + 1)`. */
const saturate = (rank: number) => rank / (rank + 1)

/** The TypeScript model of {@link threadSearchRank}. */
const rank = (row: { similarity?: number; subjectCovers?: number; bodyCovers?: number }) =>
  (row.similarity ?? 0) * TRIGRAM_WEIGHT +
  saturate(PER_COVER * (row.subjectCovers ?? 0)) * SUBJECT_WEIGHT +
  saturate(PER_COVER * (row.bodyCovers ?? 0))

/** The formula as it stood before the subject arm — for the regression tests. */
const previousRank = (row: { similarity?: number; bodyCovers?: number }) =>
  (row.similarity ?? 0) * TRIGRAM_WEIGHT + PER_COVER * (row.bodyCovers ?? 0)

describe('threadSearchRank shape', () => {
  it('is three arms: trigram x2, saturated subject x11, saturated body x1', () => {
    const { sql: text, params } = render(threadSearchRank('invoice'))

    expect(text).toBe(
      '(COALESCE(similarity("Thread"."subject", $1), 0) * 2 + ' +
        `COALESCE(ts_rank_cd(to_tsvector('english', COALESCE("Thread"."subject", '')), ` +
        `plainto_tsquery('english', $2), 32), 0) * 11 + ` +
        `COALESCE(ts_rank_cd(to_tsvector('english', COALESCE("Thread"."searchText", '')), ` +
        `plainto_tsquery('english', $3), 32), 0))`
    )
    expect(params).toEqual(['invoice', 'invoice', 'invoice'])
  })

  it('uses the same weights the model below reasons about', () => {
    // The one thread tying the rendered SQL to the arithmetic tests. If someone
    // retunes a weight without revisiting the derivation, this fails first.
    const { sql: text } = render(threadSearchRank('invoice'))
    expect(text).toContain(`, 0) * ${TRIGRAM_WEIGHT} +`)
    expect(text).toContain(`, 0) * ${SUBJECT_WEIGHT} +`)
  })

  it('saturates BOTH ts_rank_cd arms, not just one', () => {
    // Saturating only the body arm would leave subject covers unbounded, letting
    // a subject that repeats the term outrank an exact subject match. Saturating
    // only the subject arm would leave the 30x scale gap the weight is supposed
    // to close. The flag has to be on both.
    const { sql: text } = render(threadSearchRank('invoice'))
    expect(text.match(/, 32\), 0\)/g)).toHaveLength(2)
  })

  it('scores the subject even though the body is the shared binding’s document', () => {
    // The bug this file exists for: the rank used to read `Thread.searchText` as
    // its only tsvector, so the subject contributed through whole-string
    // `similarity()` alone.
    const { sql: text } = render(threadSearchRank('invoice'))
    expect(text).toContain(`to_tsvector('english', COALESCE("Thread"."subject", ''))`)
    expect(text).toContain(`to_tsvector('english', COALESCE("Thread"."searchText", ''))`)
  })

  it('is a score, never a match — no % operator can leak into the ordering', () => {
    // `%` belongs to the predicate. In the rank it would make the cursor and the
    // ORDER BY compare different things.
    const { sql: text } = render(threadSearchRank('invoice'))
    expect(text).not.toContain(' % ')
    expect(text).not.toContain('ILIKE')
  })
})

describe('threadSearchCursor / ORDER BY agreement', () => {
  it('restates the ORDER BY expression identically, twice', () => {
    // 🔴 The load-bearing test. `threads/thread-query.service.ts` orders by
    // `desc(threadSearchRank(term))` and resumes with `threadSearchCursor`; a
    // WHERE cannot see a SELECT alias, so the cursor recomputes the rank. If the
    // two ever differ — by a COALESCE, by a normalization flag, by a weight —
    // page 2 silently drops and repeats rows instead of failing.
    //
    // "Identically" is asserted modulo PLACEHOLDER ORDINALS, and only those: the
    // same fragment rendered at offset 0 binds $1..$3 while the copy after the
    // score binds $5..$7. That is Drizzle numbering parameters positionally, not
    // the expressions differing — the params test below pins that every one of
    // those slots receives the same term.
    const ordinalFree = (text: string) => text.replace(/\$\d+/g, '$?')
    const ordering = ordinalFree(render(threadSearchRank('invoice')).sql)
    const cursor = ordinalFree(render(threadSearchCursor('invoice', 0.75, 'thr_9')).sql)

    expect(cursor.split(ordering)).toHaveLength(3)
    expect(cursor).toBe(`(${ordering} < $? OR (${ordering} = $? AND "Thread"."id" < $?))`)
  })

  it('changes with the rank — the two cannot be edited apart', () => {
    // The structural guarantee behind the test above: the cursor is
    // `textSearchKeyset` applied to `threadSearchRank`, so there is no second
    // copy of the formula to forget to update. Re-derive the expected cursor
    // from the rank alone and it must match what the cursor actually emits.
    const ordinalFree = (text: string) => text.replace(/\$\d+/g, '$?')
    const rankSql = ordinalFree(render(threadSearchRank('refund')).sql)
    const cursorSql = ordinalFree(render(threadSearchCursor('refund', 0.5, 'thr_1')).sql)

    expect(cursorSql).toBe(`(${rankSql} < $? OR (${rankSql} = $? AND "Thread"."id" < $?))`)
  })

  it('binds the term once per rank occurrence, in cursor order', () => {
    const { params } = render(threadSearchCursor('invoice', 0.75, 'thr_9'))
    expect(params).toEqual([
      'invoice',
      'invoice',
      'invoice',
      0.75,
      'invoice',
      'invoice',
      'invoice',
      0.75,
      'thr_9',
    ])
  })

  it('tie-breaks on the thread id, the same column the ORDER BY tie-breaks on', () => {
    const { sql: cursor } = render(threadSearchCursor('invoice', 0.75, 'thr_9'))
    expect(cursor).toContain('AND "Thread"."id" < ')
  })
})

describe('ranking behaviour', () => {
  it('ranks a subject hit above a body-only match at equal textual strength', () => {
    expect(rank({ subjectCovers: 1 })).toBeGreaterThan(rank({ bodyCovers: 1 }))
  })

  it('ranks a weak subject hit above the strongest body-only match', () => {
    // The property the weight was derived for, at the extreme observed on the dev
    // org: a body mentioning the term 31 times (raw ts_rank_cd 3.1, the real
    // maximum for `invoice`) still loses to a subject that mentions it once.
    expect(rank({ subjectCovers: 1 })).toBeGreaterThan(rank({ bodyCovers: 31 }))
    expect(rank({ subjectCovers: 1 })).toBeGreaterThan(rank({ bodyCovers: 93 }))
  })

  it('caps the body arm strictly below the weakest subject arm, at any length', () => {
    // The derivation, stated as an assertion: saturation bounds the body arm on
    // [0, 1), and 11 x (0.1/1.1) is exactly 1.0. No body corpus can close that.
    const weakestSubjectArm = saturate(PER_COVER) * SUBJECT_WEIGHT
    expect(weakestSubjectArm).toBeCloseTo(1, 10)
    for (const covers of [1, 10, 100, 10_000]) {
      expect(saturate(PER_COVER * covers)).toBeLessThan(weakestSubjectArm)
    }
  })

  it('still lets an exact subject match dominate', () => {
    const exact = rank({ similarity: 1, subjectCovers: 1 })
    expect(exact).toBeGreaterThan(rank({ similarity: 0.42, subjectCovers: 1, bodyCovers: 10 }))
    expect(exact).toBeGreaterThan(rank({ bodyCovers: 1000 }))
    // Including against a subject that pads its cover count — saturating the
    // subject arm is what keeps repetition from beating exactness.
    expect(exact).toBeGreaterThan(rank({ similarity: 0.23, subjectCovers: 3 }))
  })

  it('still ranks a body-only match above no match — no regression to zero', () => {
    expect(rank({ bodyCovers: 1 })).toBeGreaterThan(0)
    expect(rank({})).toBe(0)
  })

  it('preserves the ordering WITHIN each arm, which is what saturation costs nothing', () => {
    // `r / (r + 1)` is strictly increasing, so a thread whose body says it more
    // still outranks one that says it less. Only the cross-arm scale changed.
    expect(rank({ bodyCovers: 5 })).toBeGreaterThan(rank({ bodyCovers: 2 }))
    expect(rank({ subjectCovers: 2 })).toBeGreaterThan(rank({ subjectCovers: 1 }))
  })

  it('fixes the ordering the previous formula got wrong', () => {
    // Regression pin, with the real numbers from the dev org. Under the old
    // formula a 31-cover body scored 3.1 and beat an exact subject match's 2.0 —
    // which is why a search for `invoice` returned six threads with no "invoice"
    // in the subject before the first one that had it.
    const exactSubject = { similarity: 1, subjectCovers: 1 }
    const longBody = { bodyCovers: 31 }

    expect(previousRank(longBody)).toBeGreaterThan(previousRank(exactSubject))
    expect(rank(exactSubject)).toBeGreaterThan(rank(longBody))
  })
})

describe('the lens split is untouched', () => {
  it('leaves the subject predicate a subject-only expression', () => {
    // The rank now reads both columns; the PREDICATES must not. Subject
    // visibility (`identity`) and body visibility (`read`) are separate tiers,
    // scoped separately by `condition-query-builder.ts`, and a body reference
    // leaking into the subject predicate would let a subject-only viewer MATCH
    // on text they cannot read.
    const { sql: text } = render(threadSubjectSearchPredicate('invoice'))
    expect(text).toContain('"Thread"."subject"')
    expect(text).not.toContain('"Thread"."searchText"')
  })
})
