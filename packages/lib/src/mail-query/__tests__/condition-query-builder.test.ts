// packages/lib/src/mail-query/__tests__/condition-query-builder.test.ts

import type { Rung } from '@auxx/database/enums'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import type { ConditionGroup } from '../../conditions/types'
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
