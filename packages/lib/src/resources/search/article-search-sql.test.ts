// packages/lib/src/resources/search/article-search-sql.test.ts
//
// The KB-article binding of the shared builder, plus the system-table registry
// that decides whether a `search` string reaches SQL at all.
//
// The predicate/rank/cursor assertions inject a raw-identifier
// `TextSearchColumns` rather than calling `articleSearchColumns()`: under this
// package's Vitest setup `@auxx/database`'s `schema` is a Proxy whose columns are
// `undefined`, so rendering the real binding would assert nothing
// (`project_drizzle_columns_undefined_in_vitest`). What is being pinned here is
// the SHAPE of the block — how many arms, which formula, which tie-break — which
// is exactly what a future edit could break without noticing.

import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import type { TextSearchColumns } from '../../search/text-search-sql'
import {
  articleSearchCursor,
  articleSearchPredicate,
  articleSearchRank,
} from './article-search-sql'
import { getSystemSearchBinding, hasSystemSearchBinding } from './system-search-bindings'

const dialect = new PgDialect()

/** The `Article` binding written against an alias, so it renders in a test. */
const ARTICLE_COLS_A: TextSearchColumns = {
  document: sql.raw('a."searchText"'),
  rank: sql.raw('a."title"'),
  fallbacks: [sql.raw('a."title"')],
  id: sql.raw('a."id"'),
}

describe('article search binding', () => {
  it('binds searchText as the document and title as the trigram column', () => {
    const { sql: text } = dialect.sqlToQuery(articleSearchPredicate('mcp attio', ARTICLE_COLS_A))

    expect(text).toContain(`to_tsvector('english', COALESCE(a."searchText", ''))`)
    expect(text).toContain(`(a."title" % $2 AND similarity(a."title", $3) > 0.3)`)
    expect(text).toContain(`a."title" ILIKE $4`)
  })

  it('carries exactly ONE ILIKE fallback — every fallback needs a trigram index', () => {
    // `excerpt` is in the corpus but deliberately not a fallback: it has no
    // trigram index, and an OR block is only as indexable as its worst arm. A
    // second ILIKE appearing here means someone added a fallback; check the
    // index exists before letting this through.
    const { sql: text } = dialect.sqlToQuery(articleSearchPredicate('mcp attio', ARTICLE_COLS_A))

    expect(text.match(/ILIKE/g)).toHaveLength(1)
  })

  it('renders the same three-arm OR block the other two bindings do', () => {
    const { sql: text } = dialect.sqlToQuery(articleSearchPredicate('mcp attio', ARTICLE_COLS_A))

    // Parenthesized as a whole: AND-ing an unparenthesized OR chain into a WHERE
    // reassociates the clause and silently widens past every other filter.
    expect(text.startsWith('(')).toBe(true)
    expect(text.endsWith(')')).toBe(true)
    expect(text.match(/ OR /g)).toHaveLength(2)
  })

  it('renders the shared ranking formula, not a restatement of it', () => {
    const { sql: text } = dialect.sqlToQuery(articleSearchRank('mcp attio', ARTICLE_COLS_A))

    expect(text).toBe(
      `(COALESCE(similarity(a."title", $1), 0) * 2 + COALESCE(ts_rank_cd(to_tsvector('english', COALESCE(a."searchText", '')), plainto_tsquery('english', $2)), 0))`
    )
  })

  it('tie-breaks the keyset cursor on the id column', () => {
    const { sql: text } = dialect.sqlToQuery(
      articleSearchCursor('mcp attio', 0.5, 'art_1', ARTICLE_COLS_A)
    )

    expect(text).toContain(`AND a."id" < `)
  })
})

describe('system-table search bindings', () => {
  it('reports article as searchable', () => {
    expect(hasSystemSearchBinding('article')).toBe(true)
  })

  it('reports a table with no corpus as NOT searchable, without throwing', () => {
    // This is the contract that lets the remaining ~10 system tables be adopted
    // one at a time: absence must degrade to "search ignored", never to an
    // error. `querySystemResourceIdsPaged` relies on `undefined` here to fall
    // back to the exact query it ran before search existed on this path.
    expect(hasSystemSearchBinding('user')).toBe(false)
    expect(getSystemSearchBinding('user')).toBeUndefined()
  })

  it('excludes thread and message on purpose — mail carries its own lens', () => {
    // Mail rows are governed by the member lens and are blocked from the generic
    // record path entirely (`resources/picker/mail-lens-tables.ts`). Binding them
    // here would route thread content through a query that carries no lens.
    expect(hasSystemSearchBinding('thread')).toBe(false)
    expect(hasSystemSearchBinding('message')).toBe(false)
  })
})
