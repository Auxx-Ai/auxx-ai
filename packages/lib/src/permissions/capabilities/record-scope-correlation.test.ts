// packages/lib/src/permissions/capabilities/record-scope-correlation.test.ts
//
// The correlation target of the record-lane subqueries (`recordAccessRankSql`,
// `grantExistsSql`, `notRowRestrictedSql`) must survive Drizzle's projection
// rewrite. This file pins the MECHANISM rather than the call sites, and that is
// deliberate — see the note at the bottom for why the call sites cannot be
// pinned here.
//
// The bug this exists to stop shipped once and was invisible for a day: a member
// granted `edit` on a row read back `_access: 'read'`, so the drawer stayed
// read-only, the per-row write gate refused, and the access-request lane
// re-derived `read → edit` forever. Nothing errored anywhere.

import { Column, getTableColumns, sql } from 'drizzle-orm'
import { integer, PgDialect, pgTable, QueryBuilder, text } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

/**
 * Local stand-ins for the real tables. `@auxx/database`'s `schema` is mocked to a
 * Proxy handing out `{}` per key under the default Vitest config, so
 * `schema.EntityInstance.id` is `undefined` in tests and every built predicate
 * degrades to a bound parameter — which is precisely why the original defect was
 * unobservable from the suite. Real `pgTable`s render real SQL.
 */
const EntityInstance = pgTable('EntityInstance', { id: text('id').primaryKey() })

const dialect = new PgDialect()
const qb = new QueryBuilder()

/** The rendered SQL of a single-table select carrying `fragment` in its PROJECTION. */
function renderProjection(fragment: ReturnType<typeof sql>): string {
  return dialect.sqlToQuery(
    qb.select({ id: EntityInstance.id, probe: fragment }).from(EntityInstance).getSQL()
  ).sql
}

describe('the record-lane correlation target', () => {
  it('🔴 a Drizzle Column embedded in the PROJECTION is rewritten to a BARE identifier', () => {
    // This is the hazard itself, stated as a fact about Drizzle rather than about
    // our code: `buildSelection` walks into nested `sql` fragments and, when the
    // query has a single table in its FROM, replaces every `Column` chunk with an
    // unqualified `sql.identifier(column.name)`.
    const rendered = renderProjection(
      sql`(SELECT 1 FROM "ResourceAccess" WHERE "ResourceAccess"."entityInstanceId" = ${EntityInstance.id})`
    )

    expect(rendered).toContain('"entityInstanceId" = "id"')
    expect(rendered).not.toContain('"entityInstanceId" = "EntityInstance"."id"')
  })

  it('🔴 …and a bare "id" inside FROM "ResourceAccess" binds to ResourceAccess.id, not the outer row', () => {
    // The consequence, spelled out because the rendering above looks harmless.
    // SQL name resolution prefers the INNERMOST scope, so the correlation
    // silently becomes `ResourceAccess.entityInstanceId = ResourceAccess.id` —
    // never true. `max()` then aggregates zero rows and returns NULL, which
    // `rankToRung` reads as `'none'`, which `foldRecordAccess` discards in favour
    // of the def rung. Every per-record grant becomes inert, fail-closed and
    // silent.
    //
    // `ResourceAccess` genuinely has an `id` column, so there is no "column does
    // not exist" error to catch the mistake.
    const ResourceAccess = pgTable('ResourceAccess', {
      id: text('id').primaryKey(),
      entityInstanceId: text('entityInstanceId'),
      rank: integer('rank'),
    })
    expect(Object.keys(getTableColumns(ResourceAccess))).toContain('id')
  })

  it('a RAW qualified identifier survives the projection rewrite', () => {
    // The fix: `sql.raw` produces a StringChunk, and `buildSelection` has nothing
    // to rewrite. This is what `DEFAULT_INSTANCE_ID_COLUMN` is.
    const rendered = renderProjection(
      sql`(SELECT 1 FROM "ResourceAccess" WHERE "ResourceAccess"."entityInstanceId" = ${sql.raw('"EntityInstance"."id"')})`
    )

    expect(rendered).toContain('"entityInstanceId" = "EntityInstance"."id"')
  })

  it('the same Column IS rendered qualified in a WHERE clause — which is why only the STAMP broke', () => {
    // Worth pinning: the rewrite is scoped to the projection. `grantExistsSql` and
    // `notRowRestrictedSql` ride in `.where()`, so record-lane READ visibility
    // (arm 2 / arm 3) was correct throughout — a row shared at `read` was
    // readable. Only the rung STAMP folded away, which is exactly why the failure
    // presented as "sharing works, but edit never takes".
    const rendered = dialect.sqlToQuery(
      qb
        .select({ id: EntityInstance.id })
        .from(EntityInstance)
        .where(
          sql`EXISTS (SELECT 1 FROM "ResourceAccess" WHERE "ResourceAccess"."entityInstanceId" = ${EntityInstance.id})`
        )
        .getSQL()
    ).sql

    expect(rendered).toContain('"entityInstanceId" = "EntityInstance"."id"')
  })

  it('a Column is the rewritable chunk kind; a raw identifier is not', () => {
    // The one-line rule for a future reader deciding what to pass as
    // `instanceIdColumn`: anything `is(x, Column)` will be rewritten in a
    // projection. The search paths pass `sql.raw('ei."id"')` and are safe for the
    // same reason the default is.
    expect(EntityInstance.id instanceof Column).toBe(true)
    expect(sql.raw('"EntityInstance"."id"') instanceof Column).toBe(false)
  })
})

// ⚠ Why the CALL SITES are not asserted here.
//
// `recordAccessRankSql` builds its grantee union from `schema.ResourceAccess`
// columns, which the setup mock renders `undefined`. Feeding those to the dialect
// produces neither the production SQL nor an error — the whole predicate collapses
// to bound parameters, so an assertion on the rendered call-site SQL would be
// vacuous in the exact way `project_drizzle_columns_undefined_in_vitest` warns
// about. The call sites are covered against the real database by
// `packages/lib/scripts/check-record-access-stamp.ts`, not from here.
