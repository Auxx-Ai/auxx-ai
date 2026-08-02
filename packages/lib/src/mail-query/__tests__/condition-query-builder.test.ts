// packages/lib/src/mail-query/__tests__/condition-query-builder.test.ts

import { database, schema } from '@auxx/database'
import type { Rung } from '@auxx/database/enums'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, type Mock } from 'vitest'
import {
  getOperatorsForFieldType,
  type OperatorDefinition,
} from '../../conditions/operator-definitions'
import type { ConditionGroup } from '../../conditions/types'
import { getMailViewFieldDefinition } from '../../mail-views/mail-view-field-definitions'
import type { UserInstanceGrants } from '../../permissions/visibility/context'
import { THREAD_GRANT_DEF } from '../../permissions/visibility/context'
import {
  buildConditionGroupsQuery,
  buildConditionGroupsQueryWithDiagnostics,
} from '../condition-query-builder'

function viewer(threadGrants: Record<string, Rung> = {}): UserInstanceGrants {
  return {
    userId: 'user-1',
    role: 'USER',
    isAdmin: true,
    isMailAdmin: true,
    inboxLens: {},
    personalInboxIds: {},
    grants: { [THREAD_GRANT_DEF]: threadGrants },
    defEntityTypes: {},
  }
}

const toSql = (clause: Parameters<PgDialect['sqlToQuery']>[0]) =>
  new PgDialect().sqlToQuery(clause).sql

const toParams = (clause: Parameters<PgDialect['sqlToQuery']>[0]) =>
  new PgDialect().sqlToQuery(clause).params as unknown[]

function group(conditions: ConditionGroup['conditions']): ConditionGroup[] {
  return [{ id: 'g1', logicalOperator: 'AND', conditions }]
}

/** The clause every "no filter" outcome must collapse to. */
const baseScopeSql = () =>
  toSql(buildConditionGroupsQueryWithDiagnostics([], 'organization-1', viewer()).sql)

describe('buildConditionGroupsQueryWithDiagnostics — no filter given', () => {
  it('returns baseScope with allConditionsDropped false for zero groups', () => {
    const result = buildConditionGroupsQueryWithDiagnostics([], 'organization-1', viewer())

    expect(result.requestedConditions).toBe(0)
    expect(result.droppedConditions).toEqual([])
    expect(result.allConditionsDropped).toBe(false)
    expect(toSql(result.sql)).toBe(baseScopeSql())
  })

  it('returns baseScope with allConditionsDropped false for a group with no conditions', () => {
    const result = buildConditionGroupsQueryWithDiagnostics(group([]), 'organization-1', viewer())

    expect(result.requestedConditions).toBe(0)
    expect(result.allConditionsDropped).toBe(false)
    expect(toSql(result.sql)).toBe(baseScopeSql())
  })
})

describe('buildConditionGroupsQueryWithDiagnostics — every filter dropped', () => {
  it('flags an unknown fieldId and still returns baseScope', () => {
    const result = buildConditionGroupsQueryWithDiagnostics(
      group([{ id: 'c1', fieldId: 'totallyNotAField', operator: 'is', value: 'x' }]),
      'organization-1',
      viewer()
    )

    expect(result.requestedConditions).toBe(1)
    expect(result.droppedConditions).toEqual([
      { conditionId: 'c1', fieldId: 'totallyNotAField', operator: 'is', reason: 'unknown-field' },
    ])
    expect(result.allConditionsDropped).toBe(true)
    // The clause is unchanged — the discriminant is the only thing that tells
    // an AI tool it must refuse rather than answer.
    expect(toSql(result.sql)).toBe(baseScopeSql())
  })

  it('flags a known field whose operator/value produced no clause', () => {
    const result = buildConditionGroupsQueryWithDiagnostics(
      group([{ id: 'c1', fieldId: 'status', operator: 'is', value: 'not-a-status' }]),
      'organization-1',
      viewer()
    )

    expect(result.droppedConditions).toEqual([
      {
        conditionId: 'c1',
        fieldId: 'status',
        operator: 'is',
        reason: 'unsupported-operator-or-value',
      },
    ])
    expect(result.allConditionsDropped).toBe(true)
  })

  it('flags a valueSource that was not substituted upstream', () => {
    const result = buildConditionGroupsQueryWithDiagnostics(
      group([
        {
          id: 'c1',
          fieldId: 'assignee',
          operator: 'is',
          value: null,
          valueSource: 'currentUser',
        } as ConditionGroup['conditions'][number],
      ]),
      'organization-1',
      viewer()
    )

    expect(result.droppedConditions[0]?.reason).toBe('unresolved-value-source')
    expect(result.allConditionsDropped).toBe(true)
  })
})

describe('buildConditionGroupsQueryWithDiagnostics — partial drop', () => {
  it('reports the dropped condition without claiming everything was dropped', () => {
    const result = buildConditionGroupsQueryWithDiagnostics(
      group([
        { id: 'c1', fieldId: 'status', operator: 'is', value: 'open' },
        { id: 'c2', fieldId: 'nopeField', operator: 'is', value: 'x' },
      ]),
      'organization-1',
      viewer()
    )

    expect(result.requestedConditions).toBe(2)
    expect(result.droppedConditions.map((d) => d.fieldId)).toEqual(['nopeField'])
    expect(result.allConditionsDropped).toBe(false)
    // The surviving condition still narrows the query.
    expect(toSql(result.sql)).not.toBe(baseScopeSql())
  })

  it('reports no drops when every condition builds', () => {
    const result = buildConditionGroupsQueryWithDiagnostics(
      group([{ id: 'c1', fieldId: 'status', operator: 'is', value: 'open' }]),
      'organization-1',
      viewer()
    )

    expect(result.droppedConditions).toEqual([])
    expect(result.allConditionsDropped).toBe(false)
    expect(toSql(result.sql)).not.toBe(baseScopeSql())
  })
})

describe('buildConditionGroupsQuery — UI callers keep the old contract', () => {
  it('is the `sql` projection of the diagnostics build', () => {
    const groups = group([{ id: 'c1', fieldId: 'status', operator: 'is', value: 'open' }])

    expect(toSql(buildConditionGroupsQuery(groups, 'organization-1', viewer()))).toBe(
      toSql(buildConditionGroupsQueryWithDiagnostics(groups, 'organization-1', viewer()).sql)
    )
  })

  it('still returns baseScope on a genuine empty filter (mail list / views / unread / find node)', () => {
    expect(toSql(buildConditionGroupsQuery([], 'organization-1', viewer()))).toBe(baseScopeSql())
    expect(toSql(buildConditionGroupsQuery(group([]), 'organization-1', viewer()))).toBe(
      baseScopeSql()
    )
  })

  it('still returns baseScope — never throws — when every condition is dropped', () => {
    const groups = group([{ id: 'c1', fieldId: 'retiredField', operator: 'is', value: 'x' }])

    expect(toSql(buildConditionGroupsQuery(groups, 'organization-1', viewer()))).toBe(
      baseScopeSql()
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// `tags` — the key every registry-driven surface sends
//
// `THREAD_FIELDS` declares the field as `tags`; this builder's own older name
// is `tag`, still emitted by `context-to-conditions`. Until 2026-08-01 only
// `tag` had a case, so a registry-driven filter — the workflow Find node's
// panel among them — silently dropped and returned the whole visible mailbox.
// ═══════════════════════════════════════════════════════════════════════════

describe('tag / tags', () => {
  const tagCondition = (fieldId: string) =>
    group([{ id: 'c1', fieldId, operator: 'is', value: 't1' }])

  it('builds `tags` identically to `tag`', () => {
    const byNewName = buildConditionGroupsQueryWithDiagnostics(
      tagCondition('tags'),
      'organization-1',
      viewer()
    )
    const byOldName = buildConditionGroupsQueryWithDiagnostics(
      tagCondition('tag'),
      'organization-1',
      viewer()
    )

    expect(byNewName.droppedConditions).toEqual([])
    expect(toSql(byNewName.sql)).toBe(toSql(byOldName.sql))
    expect(toParams(byNewName.sql)).toEqual(toParams(byOldName.sql))
  })

  it('narrows rather than falling back to the whole mailbox', () => {
    const result = buildConditionGroupsQueryWithDiagnostics(
      tagCondition('tags'),
      'organization-1',
      viewer()
    )

    expect(result.allConditionsDropped).toBe(false)
    expect(toSql(result.sql)).not.toBe(baseScopeSql())
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Free text: tokenization (step 2.2 / R2a) over the ranked builder (step 3.1 / R2b)
//
// The tokenization guarantees from 2.2 are unchanged — one clause per term,
// AND-ed, quoted phrases held together, empty input dropped, term count capped.
// What changed underneath is the *per-term* clause: it used to be
// `subject ILIKE '%t%' OR EXISTS(message body ILIKE '%t%')` and is now two
// index-backed blocks from the shared builder, one over `Thread.subject` and one
// over the `Thread.searchText` corpus.
//
// Column names do not render under Vitest — Drizzle columns are `undefined`
// there (`project_drizzle_columns_undefined_in_vitest`) — so structure is
// asserted on the operator shape and on the bound parameters, exactly as the
// pre-existing assertions in this file already do.
// ═══════════════════════════════════════════════════════════════════════════

/** The rendered clause for one `freeText contains <value>` condition. */
function freeTextSql(value: unknown): string {
  return toSql(
    buildConditionGroupsQueryWithDiagnostics(
      group([{ id: 'c1', fieldId: 'freeText', operator: 'contains', value }]),
      'organization-1',
      viewer()
    ).sql
  )
}

/** The distinct search terms the builder bound, in any order. */
function freeTextTerms(value: unknown): Set<string> {
  const result = buildConditionGroupsQueryWithDiagnostics(
    group([{ id: 'c1', fieldId: 'freeText', operator: 'contains', value }]),
    'organization-1',
    viewer()
  )
  // Every term is bound several times per block (tsquery, `%`, similarity) and
  // once per block; the set is what the assertions are about.
  return new Set(toParams(result.sql).filter((p): p is string => typeof p === 'string'))
}

describe('free text — tokenization', () => {
  it('binds one term per whitespace-separated word, not one whole-string term', () => {
    const terms = freeTextTerms('order refund')

    expect(terms).toContain('order')
    expect(terms).toContain('refund')
    expect(terms).not.toContain('order refund')
  })

  it('AND-s the terms so a thread must match every one of them', () => {
    const sqlText = freeTextSql('order refund')

    // One `plainto_tsquery` per (term × block): 2 terms × 2 blocks = 4.
    expect(sqlText.match(/plainto_tsquery/g)).toHaveLength(4)
    // The two term clauses are joined with `and`, not `or` — an OR would return
    // every thread mentioning any one word, which at mailbox scale is
    // "everything".
    expect(sqlText).toMatch(/\)\) and \(\(/)
  })

  it('matches a thread the old single-ILIKE build could not: the words are not adjacent', () => {
    // The motivating thread: `Order #1042 — customer asking for a refund`. The
    // old build emitted the whole query as one substring (`%order refund%`),
    // which that subject does not contain, so the search returned nothing.
    const terms = freeTextTerms('order refund')

    expect(terms).not.toContain('order refund')
    // Independent terms, each free to match anywhere in the subject or the body
    // corpus, in any order.
    expect(terms).toContain('order')
    expect(terms).toContain('refund')
  })

  it('keeps a quoted phrase as one term', () => {
    const terms = freeTextTerms('"order number" refund')

    expect(terms).toContain('order number')
    expect(terms).toContain('refund')
    expect(terms).not.toContain('order')
  })

  it('degrades an unterminated quote to plain terms', () => {
    const terms = freeTextTerms('"order number')

    expect(terms).toContain('order')
    expect(terms).toContain('number')
  })

  it('drops the condition on whitespace-only input instead of matching everything', () => {
    const result = buildConditionGroupsQueryWithDiagnostics(
      group([{ id: 'c1', fieldId: 'freeText', operator: 'contains', value: '   ' }]),
      'organization-1',
      viewer()
    )

    expect(result.allConditionsDropped).toBe(true)
    expect(result.droppedConditions[0]?.reason).toBe('unsupported-operator-or-value')
    expect(toSql(result.sql)).toBe(baseScopeSql())
  })

  it('caps the term count rather than emitting one block per pasted word', () => {
    const terms = Array.from({ length: 40 }, (_, i) => `term${i}`).join(' ')
    const bound = [...freeTextTerms(terms)].filter((t) => t.startsWith('term'))

    expect(bound).toHaveLength(16)
  })
})

describe('free text — ranked, index-backed predicate (step 3.1 / R2b)', () => {
  it('uses the shared builder: stemmed tsvector, trigram % and the 0.3 floor', () => {
    const sqlText = freeTextSql('refund')

    expect(sqlText).toContain(`to_tsvector('english'`)
    expect(sqlText).toContain(`plainto_tsquery('english'`)
    expect(sqlText).toContain('similarity(')
    expect(sqlText).toContain('> 0.3')
  })

  it('emits exactly ONE ILIKE arm per term — the trigram-indexed subject', () => {
    // This is the assertion that keeps the query fast, and the count is the
    // whole point of it. Postgres builds the predicate as a `BitmapOr` of one
    // index scan per arm; an arm it has no index condition for forces it to
    // abandon the bitmap and filter the viewer's whole mailbox row by row,
    // re-evaluating `to_tsvector` over a 40 KB corpus per row.
    //
    // `Thread.subject` is trigram-indexed (`Thread_org_subject_trgm_idx`), and
    // `gin_trgm_ops` serves `~~*` as well as `%` — so ONE ILIKE arm is free and
    // buys sub-3-character queries, which neither other arm can answer.
    // `Thread.searchText` is NOT trigram-indexed, so a second ILIKE would be the
    // arm that costs the others their indexes. Measured on the dev org:
    // 2,004 ms for the old ILIKE-only build, 458 ms with an unindexed fallback,
    // 138 ms as built here.
    const sqlText = freeTextSql('refund')

    // Case-insensitive: the shared builder writes `ILIKE`, Drizzle's own
    // `ilike()` helper writes `ilike`, and this must catch either.
    expect(sqlText.match(/ilike/gi) ?? []).toHaveLength(1)
  })

  it('no longer opens a correlated EXISTS over Message per term', () => {
    // The body arm reads the maintained `Thread.searchText` corpus, so the
    // per-term subquery over `Message` — the dominant cost of the old build — is
    // gone entirely.
    expect(freeTextSql('order refund')).not.toMatch(/exists/i)
  })

  it('keeps subject and body as SEPARATE blocks, so the mail lens still applies per tier', () => {
    // 🔴 The load-bearing assertion of this step. `Thread.subject` is scoped at
    // the `identity` tier and the body corpus at `read`; one blended block would
    // let a subject-only viewer match on body text. Two `to_tsvector` documents
    // per term is what "two blocks" looks like once the column names are gone.
    const sqlText = freeTextSql('refund')

    expect(sqlText.match(/to_tsvector\('english'/g)).toHaveLength(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// `list` / `senderDomain` — the bulk-mail identity conditions
//
// Both are backed by columns on `Message` (`listId`, `senderDomain`, derived at
// ingest from headers), so both compile to a correlated `exists(...)` over
// `Message` scoped to the outer `Thread` — the `buildBodyQuery` /
// `buildToQuery` shape.
//
// 🔴 The parity suite is the load-bearing one. `MAIL_VIEW_FIELD_DEFINITIONS`
// declares no operator list of its own: the condition editor derives it from the
// field's `fieldType`. So the set the UI offers IS `getOperatorsForFieldType(...)`,
// and every member of it must dispatch. An operator the builder has no case for
// is dropped silently, and a filter whose every condition drops reduces to the
// bare org scope — it matches every thread in the inbox, and `set-status: SPAM`
// then marks the whole mailbox spam (mail-filters invariant 19, the
// `Body starts with` bug).
//
// The subquery itself is NOT rendered under Vitest: `database.select()` is a
// chainable `vi.fn` (src/test/setup.ts), so `exists(...)` binds the builder
// object as a parameter and the whole subquery collapses to `exists $n`. Its
// shape is therefore asserted on the mock — which table it reads, that it joins
// nothing, what it projects, and the WHERE clause it was handed (a real Drizzle
// `SQL`, since only the query builder is mocked, not `and`/`eq`/`ilike`).
// ═══════════════════════════════════════════════════════════════════════════

const MESSAGE_BACKED_FIELDS = ['list', 'senderDomain'] as const

/** The operators the condition editor offers for a field, as it derives them. */
function offeredOperators(fieldId: string): OperatorDefinition[] {
  const field = getMailViewFieldDefinition(fieldId)
  if (!field) throw new Error(`${fieldId} is not in MAIL_VIEW_FIELD_DEFINITIONS`)
  return getOperatorsForFieldType(field.fieldType)
}

/** A value shaped the way the editor would submit it for `operator`. */
function sampleValue(operator: OperatorDefinition): unknown {
  if (operator.valueType === 'none') return undefined
  if (operator.valueType === 'multiple') return ['news.acme.com', 'deals.acme.com']
  return 'news.acme.com'
}

function buildOne(fieldId: string, operator: string, value: unknown) {
  return buildConditionGroupsQueryWithDiagnostics(
    group([{ id: 'c1', fieldId, operator, value } as ConditionGroup['conditions'][number]]),
    'organization-1',
    viewer()
  )
}

/**
 * Build one condition and hand back the correlated subquery the builder opened,
 * as observed on the mocked query builder.
 */
function buildWithSubquery(fieldId: string, operator: string, value: unknown) {
  const select = database.select as unknown as Mock
  select.mockClear()

  const result = buildOne(fieldId, operator, value)

  // Exactly one subquery: the base scope opens none for this viewer.
  expect(select).toHaveBeenCalledTimes(1)
  const chain = select.mock.results[0]?.value
  return {
    result,
    sqlText: toSql(result.sql),
    /** The projection handed to `select(...)`. */
    projection: select.mock.calls[0]?.[0] as Record<string, SQL<unknown>>,
    /** The table handed to `.from(...)`. */
    table: chain.from.mock.calls[0]?.[0],
    /** The predicate handed to `.where(...)`. */
    where: chain.where.mock.calls[0]?.[0] as SQL<unknown>,
    chain,
  }
}

describe('list / senderDomain — the offered operator set is exactly the handled one', () => {
  it('offers the full FieldType.TEXT string set on both fields', () => {
    // Pinned literally: an operator that newly gains `FieldType.TEXT` support
    // widens what the UI offers, and this is where that has to be noticed —
    // the builder needs a case for it in the same change.
    const expected = [
      'is',
      'is not',
      'contains',
      'not contains',
      'starts with',
      'ends with',
      'in',
      'not in',
      'empty',
      'not empty',
    ]

    for (const fieldId of MESSAGE_BACKED_FIELDS) {
      expect(offeredOperators(fieldId).map((op) => op.key)).toEqual(expected)
    }
  })

  for (const fieldId of MESSAGE_BACKED_FIELDS) {
    it(`compiles every operator \`${fieldId}\` offers — nothing dropped`, () => {
      const operators = offeredOperators(fieldId)
      expect(operators.length).toBeGreaterThan(0)

      for (const operator of operators) {
        const result = buildOne(fieldId, operator.key, sampleValue(operator))

        // Keyed by operator so a failure names the one that doesn't compile.
        expect({ operator: operator.key, dropped: result.droppedConditions }).toEqual({
          operator: operator.key,
          dropped: [],
        })
        expect(result.allConditionsDropped).toBe(false)
        // The clause must actually narrow — collapsing to the base scope is the
        // precise fail-open this suite exists to prevent.
        expect(toSql(result.sql)).not.toBe(baseScopeSql())
      }
    })
  }
})

describe('list / senderDomain — correlated exists over Message, never a join', () => {
  for (const fieldId of MESSAGE_BACKED_FIELDS) {
    it(`reads \`Message\` through a correlated subquery for \`${fieldId}\``, () => {
      const built = buildWithSubquery(fieldId, 'is', 'news.acme.com')

      expect(built.table).toBe(schema.Message)
      expect(built.sqlText).toMatch(/\bexists \$\d+/)
      // One table, no join — the `buildBodyQuery` shape, not `buildToQuery`'s.
      expect(built.chain.innerJoin).not.toHaveBeenCalled()
      expect(built.chain.leftJoin).not.toHaveBeenCalled()
    })

    it(`keeps the predicate in the WHERE position for \`${fieldId}\``, () => {
      // 🔴 Invariant 6. A Drizzle `Column` in a single-table SELECT projection
      // loses its table qualifier, so the correlation silently becomes a
      // self-join and the condition fails closed. The projection is therefore a
      // literal `1`, and every column comparison lives in `.where(...)`.
      const built = buildWithSubquery(fieldId, 'contains', 'acme')

      expect(Object.keys(built.projection)).toEqual(['id'])
      expect(toSql(built.projection.id as SQL<unknown>)).toBe('1')
      expect(toSql(built.where)).toMatch(/ilike/i)
      expect(toParams(built.where)).toContain('%acme%')
    })
  }
})

describe('list / senderDomain — operator semantics', () => {
  it('lowercases the needle for `is`, matching the value normalized at ingest', () => {
    const params = toParams(buildWithSubquery('list', 'is', 'News.ACME.com').where)

    expect(params).toContain('news.acme.com')
    expect(params).not.toContain('News.ACME.com')
  })

  it('lowercases every needle for `in`', () => {
    const built = buildWithSubquery('list', 'in', ['News.ACME.com', 'Deals.ACME.com'])

    expect(toSql(built.where)).toMatch(/ in \(/i)
    expect(toParams(built.where)).toContain('news.acme.com')
    expect(toParams(built.where)).toContain('deals.acme.com')
  })

  it('compares `is` with `=` so the partial (listId, threadId) index can serve it', () => {
    // `ilike` here would make that index useless — and the index exists
    // specifically for this subquery (suggestions plan §1.1).
    const built = buildWithSubquery('list', 'is', 'news.acme.com')

    expect(toSql(built.where)).not.toMatch(/ilike/i)
    expect(toSql(built.where)).toMatch(/= \$\d+/)
  })

  it('uses ILIKE — not `=` — for the substring operators', () => {
    for (const operator of ['contains', 'not contains', 'starts with', 'ends with']) {
      expect(toSql(buildWithSubquery('senderDomain', operator, 'ACME').where)).toMatch(/ilike/i)
    }
  })

  it('anchors `starts with` / `ends with` on the right side', () => {
    expect(toParams(buildWithSubquery('senderDomain', 'starts with', 'acme').where)).toContain(
      'acme%'
    )
    expect(toParams(buildWithSubquery('senderDomain', 'ends with', 'acme').where)).toContain(
      '%acme'
    )
    expect(toParams(buildWithSubquery('senderDomain', 'contains', 'acme').where)).toContain(
      '%acme%'
    )
  })

  it('negates `is not` / `not contains` / `not in` as NOT EXISTS over the thread', () => {
    for (const [operator, value] of [
      ['is not', 'news.acme.com'],
      ['not contains', 'acme'],
      ['not in', ['news.acme.com']],
    ] as const) {
      const built = buildWithSubquery('list', operator, value)

      // "no message in this thread matches", not "some message doesn't".
      expect(built.sqlText).toMatch(/\bnot exists \$\d+/)
      expect(built.table).toBe(schema.Message)
    }
  })

  it('treats `empty` / `not empty` as a property of the whole thread', () => {
    const notEmpty = buildWithSubquery('list', 'not empty', undefined)
    const empty = buildWithSubquery('list', 'empty', undefined)

    // "not empty" = at least one message carries a value.
    expect(notEmpty.sqlText).toMatch(/\bexists \$\d+/)
    expect(notEmpty.sqlText).not.toMatch(/not exists/i)
    expect(toSql(notEmpty.where)).toMatch(/is not null/i)
    // "empty" = no message does. Same subquery, negated.
    expect(empty.sqlText).toMatch(/\bnot exists \$\d+/)
    expect(toSql(empty.where)).toBe(toSql(notEmpty.where))
  })

  it('drops a value-requiring operator given a blank value rather than matching everything', () => {
    for (const value of [null, undefined, '', '   ', []]) {
      const result = buildOne('senderDomain', 'is', value)

      expect(result.allConditionsDropped).toBe(true)
      expect(result.droppedConditions[0]?.reason).toBe('unsupported-operator-or-value')
      expect(toSql(result.sql)).toBe(baseScopeSql())
    }
  })

  it('reads the two columns independently — the fields never fuse into one key', () => {
    // S7: the unsubscribe safety gate has to tell a real list from a domain
    // guess, so the two fields must stay two conditions over two columns.
    const byList = buildWithSubquery('list', 'is', 'acme.com')
    const byDomain = buildWithSubquery('senderDomain', 'is', 'acme.com')

    expect(byList.result.droppedConditions).toEqual([])
    expect(byDomain.result.droppedConditions).toEqual([])
    expect(byList.sqlText).not.toBe(baseScopeSql())
    expect(byDomain.sqlText).not.toBe(baseScopeSql())
  })
})
