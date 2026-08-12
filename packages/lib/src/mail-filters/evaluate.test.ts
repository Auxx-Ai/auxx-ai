// packages/lib/src/mail-filters/evaluate.test.ts
// The single evaluator (§4.2). Three things matter here: the chunking ceiling
// (unlimited plans must not compile one 200-branch statement on the
// message:received path), the FAIL-CLOSED rule for conditions the builder cannot
// compile (a filter that asked to match something and compiled to nothing must
// match NOTHING, not the whole inbox), and which fields a filter may be authored
// on at all — `body` works on a brand-new thread, `freeText` does not.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Condition, ConditionGroup } from '../conditions/types'
import { SYSTEM_VISIBILITY } from '../permissions/visibility/context'
import { getMailFilterFields, MAIL_FILTER_EXCLUDED_FIELD_IDS } from './client'
import {
  assertFilterConditionsCompile,
  buildFilterPredicate,
  FILTER_PREDICATE_CHUNK_SIZE,
  matchFilters,
} from './evaluate'
import type { CachedMailFilter } from './types'

/**
 * Partial mock: only the compilation is stubbed. `drizzle-orm` stays REAL —
 * replacing it kills the file at collection — so `sql` / `and` / `eq` build a
 * genuine tree, which is what `db.execute` receives and what `PgDialect` renders.
 *
 * The stub is a faithful MINI-MODEL of `condition-query-builder`'s drop rule
 * rather than a constant: it drops exactly the combination the shipped dialog can
 * produce and the builder has no case for (`body starts with`, `buildBodyQuery`
 * handles `contains` / `not contains` only), and returns the bare base scope for
 * whatever survives. That is the shape of the real bug, so a test written against
 * it is a test of the evaluator's response to a real drop.
 */
vi.mock('../mail-query/condition-query-builder', async () => {
  const { sql } = await import('drizzle-orm')

  const isSupported = (condition: Condition) =>
    !(condition.fieldId === 'body' && condition.operator === 'starts with')

  const buildConditionGroupsQueryWithDiagnostics = vi.fn(
    (groups: ConditionGroup[], _organizationId?: string, _viewer?: unknown) => {
      const all = groups.flatMap((group) => group.conditions ?? [])
      const droppedConditions = all
        .filter((c) => !isSupported(c))
        .map((c) => ({
          conditionId: c.id,
          fieldId: String(c.fieldId),
          operator: String(c.operator),
          reason: 'unsupported-operator-or-value' as const,
        }))
      return {
        // `BASE_SCOPE` stands in for `organizationId = $1 AND mergedIntoThreadId IS
        // NULL` — the clause a fully dropped filter really collapses to.
        sql: sql`BASE_SCOPE`,
        requestedConditions: all.length,
        droppedConditions,
        allConditionsDropped: all.length > 0 && droppedConditions.length === all.length,
      }
    }
  )

  return {
    buildConditionGroupsQueryWithDiagnostics,
    buildConditionGroupsQuery: (
      groups: ConditionGroup[],
      organizationId: string,
      viewer: unknown
    ) => buildConditionGroupsQueryWithDiagnostics(groups, organizationId, viewer).sql,
  }
})

const render = (clause: Parameters<PgDialect['sqlToQuery']>[0]) =>
  new PgDialect().sqlToQuery(clause).sql

/** Bound parameters — the filter ids ride as `$n`, never inline in the text. */
const params = (clause: Parameters<PgDialect['sqlToQuery']>[0]) =>
  new PgDialect().sqlToQuery(clause).params as unknown[]

function condition(fieldId: string, operator: string, value: unknown = 'x'): Condition {
  return { id: `cnd_${fieldId}_${operator}`, fieldId, operator, value } as Condition
}

function groups(...conditions: Condition[]): ConditionGroup[] {
  return [{ id: 'grp_1', logicalOperator: 'AND', conditions }]
}

/** The condition the shipped dialog offers and the builder cannot compile. */
const UNCOMPILABLE = groups(condition('body', 'starts with', 'Unsubscribe'))
const COMPILABLE = groups(condition('body', 'contains', 'Unsubscribe'))

function filter(id: string, conditions: ConditionGroup[] = []): CachedMailFilter {
  return {
    id,
    inboxId: 'ibx_1',
    name: id,
    order: 0,
    stopProcessing: false,
    enabled: true,
    conditions,
    actions: [],
    templateKey: null,
  }
}

function fakeDb(rowsPerCall: { fid: string }[][]) {
  const execute = vi.fn()
  for (const rows of rowsPerCall) execute.mockResolvedValueOnce({ rows })
  execute.mockResolvedValue({ rows: [] })
  return { db: { execute } as never, execute }
}

beforeEach(() => vi.clearAllMocks())

describe('matchFilters', () => {
  it('makes zero round trips for zero filters', async () => {
    const { db, execute } = fakeDb([])
    await expect(matchFilters(db, 'org_1', 'thr_1', [])).resolves.toEqual(new Set())
    expect(execute).not.toHaveBeenCalled()
  })

  it('chunks at 25 predicates per statement — 60 filters ⇒ 3 round trips', async () => {
    expect(FILTER_PREDICATE_CHUNK_SIZE).toBe(25)
    const { db, execute } = fakeDb([])
    const filters = Array.from({ length: 60 }, (_, i) => filter(`flt_${i}`))

    await matchFilters(db, 'org_1', 'thr_1', filters)

    // ceil(60/25) — linear degradation, not one 60-branch statement.
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('returns exactly the filter ids the UNION ALL reported', async () => {
    const { db } = fakeDb([[{ fid: 'flt_a' }, { fid: 'flt_c' }]])
    const matched = await matchFilters(db, 'org_1', 'thr_1', [
      filter('flt_a'),
      filter('flt_b'),
      filter('flt_c'),
    ])
    expect(matched).toEqual(new Set(['flt_a', 'flt_c']))
  })

  it('unions matches across chunks', async () => {
    const filters = Array.from({ length: 30 }, (_, i) => filter(`flt_${i}`))
    const { db } = fakeDb([[{ fid: 'flt_3' }], [{ fid: 'flt_27' }]])
    const matched = await matchFilters(db, 'org_1', 'thr_1', filters)
    expect(matched).toEqual(new Set(['flt_3', 'flt_27']))
  })
})

/**
 * The failure this whole section exists for: `Body starts with "Unsubscribe"` →
 * `Set status: Spam`. The condition compiles to nothing, the predicate collapses
 * to the org scope, and AND-ed with `Thread.id = $1` it matches — so every
 * inbound message in the inbox is marked spam, and "also apply to existing"
 * backfills that across the mailbox. A dropped condition does not narrow a
 * filter, it WIDENS it, which is why the only safe reading is "matches nothing".
 */
describe('a filter whose conditions do not compile fails CLOSED', () => {
  it('does not match, and costs no round trip', async () => {
    const { db, execute } = fakeDb([[{ fid: 'flt_broken' }]])

    const matched = await matchFilters(db, 'org_1', 'thr_1', [filter('flt_broken', UNCOMPILABLE)])

    expect(matched).toEqual(new Set())
    // Skipped outright — the branch is never emitted, so the statement that
    // would have matched every thread is never sent.
    expect(execute).not.toHaveBeenCalled()
  })

  it('skips only the broken filter, never the healthy ones beside it', async () => {
    const { db, execute } = fakeDb([[{ fid: 'flt_ok' }]])

    const matched = await matchFilters(db, 'org_1', 'thr_1', [
      filter('flt_broken', UNCOMPILABLE),
      filter('flt_ok', COMPILABLE),
    ])

    expect(matched).toEqual(new Set(['flt_ok']))
    expect(execute).toHaveBeenCalledTimes(1)
    // One branch, not two — the broken filter contributed no SELECT. The ids ride
    // as bound parameters, so that is what the branch count is read off.
    const statement = execute.mock.calls[0]![0]
    expect(render(statement)).not.toContain('UNION ALL')
    expect(params(statement)).toContain('flt_ok')
    expect(params(statement)).not.toContain('flt_broken')
  })

  /**
   * `buildFilterPredicate` is the shared compilation the retroactive backfill and
   * the preview count also come through, so the fail-closed rule has to live
   * there and not only in `matchFilters` — otherwise "also apply to existing"
   * would still rewrite the whole mailbox.
   */
  it('compiles to AND false everywhere the predicate is reused', () => {
    expect(
      render(buildFilterPredicate({ conditions: UNCOMPILABLE }, 'org_1', SYSTEM_VISIBILITY))
    ).toBe('(BASE_SCOPE and false)')
  })

  it('leaves a filter with NO conditions alone — "every new message" is a real rule', () => {
    expect(render(buildFilterPredicate({ conditions: [] }, 'org_1', SYSTEM_VISIBILITY))).toBe(
      'BASE_SCOPE'
    )
    expect(
      render(buildFilterPredicate({ conditions: COMPILABLE }, 'org_1', SYSTEM_VISIBILITY))
    ).toBe('BASE_SCOPE')
  })
})

/**
 * The save-time gate. `buildFilterPredicate`'s `AND false` bounds rows that
 * already exist; this is what stops new ones, and it is the only place the author
 * is ever told, so the message has to name the condition rather than say
 * "invalid conditions".
 */
describe('assertFilterConditionsCompile', () => {
  it('names the offending field and operator', () => {
    expect(() => assertFilterConditionsCompile(UNCOMPILABLE, 'org_1')).toThrow(/Body/)
    expect(() => assertFilterConditionsCompile(UNCOMPILABLE, 'org_1')).toThrow(/starts with/)
  })

  it('maps to a 400', () => {
    try {
      assertFilterConditionsCompile(UNCOMPILABLE, 'org_1')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as { statusCode?: number }).statusCode).toBe(400)
    }
  })

  it('accepts conditions that compile, and the empty filter', () => {
    expect(() => assertFilterConditionsCompile(COMPILABLE, 'org_1')).not.toThrow()
    expect(() => assertFilterConditionsCompile([], 'org_1')).not.toThrow()
  })

  /**
   * A PARTIAL drop is rejected too. It does not collapse to the base scope, so
   * `allConditionsDropped` is false — but the filter still fires on more mail than
   * it was written to, and at save time there is no reason to accept that.
   */
  it('rejects a filter where only one of several conditions drops', () => {
    const mixed = groups(
      condition('body', 'contains', 'Unsubscribe'),
      condition('body', 'starts with', 'Unsubscribe')
    )
    expect(() => assertFilterConditionsCompile(mixed, 'org_1')).toThrow(/starts with/)
  })
})

/**
 * Invariant 9, corrected. The premise it was written on was wrong in BOTH
 * directions, so the old source-ordering assertion could not have caught either
 * half — it pinned a `store-message.ts` call site that body conditions never
 * depended on, and said nothing about the field that does.
 */
describe('invariant 9 — what body conditions actually depend on', () => {
  /**
   * `buildBodyQuery` is a correlated `EXISTS` over `Message.textPlain` /
   * `Message.textHtml`, and those rows are committed inside `storeMessage`'s own
   * transaction, well before `message:received` publishes. It never reads
   * `Thread.searchText`, so no ingest ORDERING affects it — which is what makes
   * `body` safe on a brand-new thread.
   */
  // `importActual` loads the REAL builder and the schema behind it — ~4.5s warm,
  // past the 10s project default once the rest of the suite is competing for the
  // machine. The budget is for that import, not for the three assertions.
  it('compiles `body contains` to a correlated EXISTS, with nothing dropped', async () => {
    const { buildConditionGroupsQueryWithDiagnostics } = await vi.importActual<
      typeof import('../mail-query/condition-query-builder')
    >('../mail-query/condition-query-builder')

    const built = buildConditionGroupsQueryWithDiagnostics(COMPILABLE, 'org_1', SYSTEM_VISIBILITY)

    expect(built.droppedConditions).toEqual([])
    expect(built.allConditionsDropped).toBe(false)
    expect(render(built.sql)).toMatch(/exists/i)
  }, 30_000)

  /**
   * The subquery's target is not observable from a rendered clause here — the
   * `@auxx/database` stand-in is a chainable proxy, so `exists(db.select()…)`
   * flattens to a bound parameter. The dependency is therefore pinned where it is
   * stated: in the two functions themselves, one asserted to read `Message` and
   * the other `Thread.searchText`. This is the same source-reading technique
   * `seed-suggested-filters.test.ts` uses on this builder, and unlike the ordering
   * assertion it replaces it names the exact fact the invariant turns on.
   */
  it('reads Message columns in buildBodyQuery, and searchText only in freeText’s arm', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const builder = readFileSync(join(here, '../mail-query/condition-query-builder.ts'), 'utf8')
    const search = readFileSync(join(here, '../mail-query/thread-search-sql.ts'), 'utf8')

    const start = builder.indexOf('function buildBodyQuery(')
    expect(start).toBeGreaterThan(-1)
    const end = builder.indexOf('\n}\n', start)
    const body = builder.slice(start, end === -1 ? undefined : end)

    // A correlated EXISTS over the Message rows `storeMessage` commits in its own
    // transaction — available on the first message of a brand-new thread.
    expect(body).toContain('Message.textPlain')
    expect(body).toContain('Message.textHtml')
    expect(body).toContain('eq(Message.threadId, Thread.id)')
    expect(body).not.toContain('searchText')

    // …while `freeText`'s body arm is the maintained corpus, which is NULL until
    // `updateThreadMetadataEfficient` runs — never on a new thread.
    expect(search).toContain('document: schema.Thread.searchText')
  })

  /**
   * `freeText`'s body arm IS `Thread.searchText` (`threadBodySearchPredicate`),
   * and that column is written only by `updateThreadMetadataEfficient`, which
   * `store-message.ts` calls for already-existing threads. On a new thread it is
   * NULL for the whole first message, so `freeText contains "invoice"` silently
   * never fires — the reason it is not offerable at all.
   */
  it('does not offer freeText as a filter field', () => {
    expect(MAIL_FILTER_EXCLUDED_FIELD_IDS).toContain('freeText')
    expect(getMailFilterFields().map((f) => f.id)).not.toContain('freeText')
    // The positive control: `body` is what replaces it, and it stays offerable.
    expect(getMailFilterFields().map((f) => f.id)).toContain('body')
  })
})
