// packages/lib/src/resources/search/record-search-sql.test.ts
//
// The record binding of the shared builder. Only the ALIASED form is asserted
// here: `recordSearchColumns()` returns Drizzle `Column`s, and under this
// package's Vitest setup `@auxx/database`'s `schema` is a Proxy whose columns
// are `undefined`, so rendering it would assert nothing
// (`project_drizzle_columns_undefined_in_vitest`).
//
// That asymmetry is the point of the two-binding API, not an accident of the
// tests: a `Column` renders table-qualified (`"EntityInstance"."displayName"`)
// and Postgres rejects that under `FROM "EntityInstance" ei`, so the picker's
// hand-written SQL needs the raw form while a Drizzle-composed query needs the
// column form. One builder, two bindings.

import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import {
  RECORD_SEARCH_COLUMNS_EI,
  recordSearchColumnsAliased,
  recordSearchCursor,
  recordSearchPredicate,
  recordSearchRank,
} from './record-search-sql'

const dialect = new PgDialect()

describe('record search binding', () => {
  it('binds searchText as the document and displayName as the trigram column', () => {
    const { sql: text } = dialect.sqlToQuery(
      recordSearchPredicate('acme', RECORD_SEARCH_COLUMNS_EI)
    )
    expect(text).toContain(`to_tsvector('english', COALESCE(ei."searchText", ''))`)
    expect(text).toContain(`(ei."displayName" % $2 AND similarity(ei."displayName", $3) > 0.3)`)
    expect(text).toContain(`ei."displayName" ILIKE $4`)
    expect(text).toContain(`ei."secondaryDisplayValue" ILIKE $5`)
  })

  it('keeps secondaryDisplayValue as a fallback arm — the tsvector cannot cover it', () => {
    // `searchText` concatenates `secondaryDisplayValue`, so this arm looks
    // redundant. It is not: `to_tsvector` turns `ada@acme-supply.io` into a
    // single `email` token, so the tsvector arm cannot match `acme` inside it,
    // and 1543 of the dev database's 3376 non-null `secondaryDisplayValue`s are
    // email addresses. The arm is affordable because
    // `EntityInstance_org_secondaryDisplayValue_trgm_idx` serves it — deleting
    // that index, not this arm, is what would cost 4x.
    const { sql: text } = dialect.sqlToQuery(
      recordSearchPredicate('acme', RECORD_SEARCH_COLUMNS_EI)
    )
    expect(text).toContain(`ei."secondaryDisplayValue" ILIKE `)
  })

  it('renders the ranking formula the picker projects as combined_score', () => {
    const { sql: text } = dialect.sqlToQuery(recordSearchRank('acme', RECORD_SEARCH_COLUMNS_EI))
    expect(text).toBe(
      `(COALESCE(similarity(ei."displayName", $1), 0) * 2 + COALESCE(ts_rank_cd(to_tsvector('english', COALESCE(ei."searchText", '')), plainto_tsquery('english', $2)), 0))`
    )
  })

  it('tie-breaks the keyset cursor on ei."id"', () => {
    const { sql: text } = dialect.sqlToQuery(
      recordSearchCursor('acme', 0.5, 'inst_1', RECORD_SEARCH_COLUMNS_EI)
    )
    expect(text).toContain(`AND ei."id" < `)
  })

  it('takes any alias, so a second correlated copy of the table is expressible', () => {
    const { sql: text } = dialect.sqlToQuery(
      recordSearchPredicate('acme', recordSearchColumnsAliased('other'))
    )
    expect(text).toContain(`other."searchText"`)
    expect(text).not.toContain('ei.')
  })
})
