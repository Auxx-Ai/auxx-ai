// packages/lib/src/search/text-search-sql.test.ts
//
// The shared ranked-search builder, asserted on RENDERED SQL.
//
// Rendering is meaningful here — and only here — because every binding under
// test is built from `sql.raw` identifiers rather than Drizzle `Column`s. Under
// this package's Vitest setup `@auxx/database`'s `schema` is a Proxy whose
// columns are `undefined` (`src/test/setup.ts`), so a `Column`-bound fragment
// would render to nonsense; that is exactly why the record binding exposes an
// aliased raw form and why the picker uses it.
//
// What these tests protect is the property the whole extraction exists for: the
// ranking formula that the SELECT list, the ORDER BY and the keyset cursor all
// depend on is ONE expression. If `textSearchRank` changes, the cursor changes
// with it — the assertion below is that they are textually the same expression,
// because a cursor and an ORDER BY that disagree skip rows silently.

import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import {
  type TextSearchColumns,
  TS_RANK_SATURATING,
  textSearchCursor,
  textSearchDocumentScore,
  textSearchKeyset,
  textSearchPredicate,
  textSearchRank,
  textSearchTrigramMatch,
} from './text-search-sql'

const dialect = new PgDialect()
const render = (fragment: ReturnType<typeof sql>) => dialect.sqlToQuery(fragment)

/** A record-shaped binding under the `ei` alias, as the picker uses it. */
const COLS: TextSearchColumns = {
  document: sql.raw('ei."searchText"'),
  rank: sql.raw('ei."displayName"'),
  fallbacks: [sql.raw('ei."displayName"'), sql.raw('ei."secondaryDisplayValue"')],
  id: sql.raw('ei."id"'),
}

describe('textSearchPredicate', () => {
  it('ORs a tsvector match, a trigram match and every ILIKE fallback', () => {
    const { sql: text, params } = render(textSearchPredicate('acme', COLS))

    expect(text).toContain(`to_tsvector('english', COALESCE(ei."searchText", '')) @@`)
    expect(text).toContain(`plainto_tsquery('english', $1)`)
    expect(text).toContain(`(ei."displayName" % $2 AND similarity(ei."displayName", $3) > 0.3)`)
    expect(text).toContain(`ei."displayName" ILIKE $4`)
    expect(text).toContain(`ei."secondaryDisplayValue" ILIKE $5`)
    expect(params).toEqual(['acme', 'acme', 'acme', '%acme%', '%acme%'])
  })

  it('states the trigram floor AND emits the % operator, on every arm', () => {
    // Neither half is redundant, and this test exists to stop someone deleting
    // the one that looks it.
    //
    // `similarity(a, b) > 0.3` alone is a bare function call: `gin_trgm_ops`
    // indexes operators, so nothing can serve it, and because the arm sits in an
    // OR block that one unindexable arm costs the OTHER arms their indexes too
    // (measured: 125 ms vs 32 ms over a 100k-row slice).
    //
    // `a % b` alone is index-servable but reads its threshold from the
    // `pg_trgm.similarity_threshold` GUC, which would make search recall a
    // property of the database's configuration rather than of this file.
    const { sql: text } = render(textSearchPredicate('acme', COLS))

    expect(text).toContain(`ei."displayName" % `)
    expect(text).toContain(` > 0.3`)
  })

  it('keeps every ILIKE fallback as its own arm, so each can use its own index', () => {
    // `gin_trgm_ops` serves ILIKE as well as `%` — so a fallback column is only
    // cheap if it has a trigram index. Collapsing these into one concatenated
    // expression, or adding a column with no index, un-indexes the whole block.
    const { sql: text } = render(textSearchPredicate('acme', COLS))

    expect(text).toContain(`ei."displayName" ILIKE `)
    expect(text).toContain(`ei."secondaryDisplayValue" ILIKE `)
  })

  it('wraps the OR block in parentheses so ANDing it cannot reassociate', () => {
    // Without the parens, `WHERE org = $1 AND a OR b` matches every row of every
    // org that satisfies `b` — the widest possible failure mode, and silent.
    const { sql: text } = render(textSearchPredicate('acme', COLS))
    expect(text.startsWith('(')).toBe(true)
    expect(text.endsWith(')')).toBe(true)
  })

  it('COALESCEs the document exactly as the GIN index expression does', () => {
    // Migration 0058 indexes `to_tsvector('english', COALESCE("searchText", ''))`.
    // Drop the COALESCE and the query expression stops matching the index one,
    // which costs a sequential scan without changing a single result.
    const { sql: text } = render(textSearchPredicate('acme', COLS))
    expect(text).toContain(`COALESCE(ei."searchText", '')`)
  })
})

describe('textSearchRank', () => {
  it('weights the trigram score at 2x and COALESCEs both halves to 0', () => {
    const { sql: text } = render(textSearchRank('acme', COLS))
    expect(text).toBe(
      `(COALESCE(similarity(ei."displayName", $1), 0) * 2 + COALESCE(ts_rank_cd(to_tsvector('english', COALESCE(ei."searchText", '')), plainto_tsquery('english', $2)), 0))`
    )
  })
})

describe('textSearchDocumentScore', () => {
  it('emits no normalization argument by default, so the record score is unchanged', () => {
    // The optional flag was added for mail's two-corpus rank. Records project
    // this score raw to the picker, and a stray third argument would silently
    // rescale every record relevance score in the product.
    const { sql: text } = render(textSearchDocumentScore('acme', COLS))
    expect(text).toBe(
      `ts_rank_cd(to_tsvector('english', COALESCE(ei."searchText", '')), plainto_tsquery('english', $1))`
    )
  })

  it('appends the saturating flag when asked', () => {
    // Flag 32 is `r / (r + 1)`. Verified against the database rather than the
    // docs: ts_rank_cd(…, 32) returns 0.09090909 for a raw 0.1 and 0.23076923
    // for a raw 0.3 — exactly r/(r+1) in both cases.
    const { sql: text } = render(textSearchDocumentScore('acme', COLS, TS_RANK_SATURATING))
    expect(text).toBe(
      `ts_rank_cd(to_tsvector('english', COALESCE(ei."searchText", '')), plainto_tsquery('english', $1), 32)`
    )
  })
})

describe('textSearchTrigramMatch', () => {
  it('ANDs the indexable % operator with the explicit threshold', () => {
    const { sql: text, params } = render(textSearchTrigramMatch('acme', COLS))
    expect(text).toBe(`(ei."displayName" % $1 AND similarity(ei."displayName", $2) > 0.3)`)
    expect(params).toEqual(['acme', 'acme'])
  })

  it('is parenthesized, so ORing it into the predicate cannot reassociate', () => {
    // Unparenthesized, `a OR b % q AND similarity(...) > 0.3 OR c` binds the AND
    // tighter than the ORs and silently changes which rows match.
    const { sql: text } = render(textSearchTrigramMatch('acme', COLS))
    expect(text.startsWith('(')).toBe(true)
    expect(text.endsWith(')')).toBe(true)
  })
})

describe('textSearchCursor', () => {
  it('is a keyset filter over the SAME rank expression, tie-broken on id', () => {
    const rank = render(textSearchRank('acme', COLS)).sql
    const { sql: text, params } = render(textSearchCursor('acme', COLS, 0.75, 'inst_9'))

    // Both sides of the OR recompute the rank verbatim — a WHERE clause cannot
    // see the SELECT alias, so this recomputation is unavoidable and must be
    // generated, never retyped.
    expect(text).toContain(rank)
    expect(text).toContain(`AND ei."id" < `)
    expect(params).toEqual(['acme', 'acme', 0.75, 'acme', 'acme', 0.75, 'inst_9'])
  })

  it('is textSearchKeyset over textSearchRank — one definition, not two', () => {
    // The structural version of the assertion above: the cursor is not merely
    // *similar* to the keyset shape applied to the rank, it IS that, so a change
    // to either can only ever move both.
    const composed = render(textSearchKeyset(textSearchRank('acme', COLS), COLS.id, 0.75, 'inst_9'))
    const direct = render(textSearchCursor('acme', COLS, 0.75, 'inst_9'))

    expect(direct.sql).toBe(composed.sql)
    expect(direct.params).toEqual(composed.params)
  })

  it('carries no match operator — the cursor is a score comparison, not a filter', () => {
    // `%` belongs to the predicate. If it ever leaks into the rank expression,
    // the cursor and the ORDER BY stop agreeing and page 2 drops or repeats
    // rows, silently and only on ties.
    const { sql: text } = render(textSearchCursor('acme', COLS, 0.75, 'inst_9'))
    expect(text).not.toContain(' % ')
  })
})
