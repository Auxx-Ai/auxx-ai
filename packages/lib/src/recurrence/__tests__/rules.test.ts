// packages/lib/src/recurrence/__tests__/rules.test.ts

/**
 * The three things a caller of the shared `RecurrenceRule` door could get wrong, each of
 * which was a hand-typed copy before: which date an upsert writes where, whether the sweep
 * filters on the cursor, and what the batch read is keyed by.
 */

import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  listDueRecurrenceRules,
  listRecurrenceRules,
  type RecurrenceRuleRow,
  upsertRecurrenceRule,
} from '../rules'
import type { RecurrencePattern } from '../types'

const pattern: RecurrencePattern = { frequency: 'monthly', interval: 1, monthDay: 1 }

/**
 * The rendered predicate. Column NAMES come out blank — the schema declares columns without
 * an explicit name and a bare dialect has no casing cache — so assert on the operators and
 * the bound parameters, which is what the predicate actually decides.
 */
function renderSql(where: unknown): { sql: string; params: unknown[] } {
  const query = new PgDialect().sqlToQuery(where as SQL)
  return { sql: query.sql, params: query.params }
}

/** A `db` whose select/update/insert/delete chains record their arguments. */
function fakeDb(selected: unknown[], returned: unknown[] = []) {
  const calls = {
    selectWhere: [] as unknown[],
    limit: [] as number[],
    updateSet: null as Record<string, unknown> | null,
    insertValues: null as Record<string, unknown> | null,
  }
  const rows = {
    limit(n: number) {
      calls.limit.push(n)
      return Promise.resolve(selected)
    },
    then(resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(selected).then(resolve, reject)
    },
  }
  const selectBuilder = {
    from: () => selectBuilder,
    where: (where: unknown) => {
      calls.selectWhere.push(where)
      return rows
    },
  }
  const writeBuilder = {
    set(values: Record<string, unknown>) {
      calls.updateSet = values
      return writeBuilder
    },
    values(values: Record<string, unknown>) {
      calls.insertValues = values
      return writeBuilder
    },
    where: () => writeBuilder,
    returning: () => Promise.resolve(returned),
  }
  const db = {
    select: () => selectBuilder,
    update: () => writeBuilder,
    insert: () => writeBuilder,
    delete: () => writeBuilder,
  } as never
  return { db, calls }
}

const saved = { id: 'rule_1', subjectId: 'wo_1' } as unknown as RecurrenceRuleRow

describe('upsertRecurrenceRule', () => {
  it('keeps the caller anchor on insert and starts the rule effective there', async () => {
    // The journal lane: a template repeats from its own accounting date, not from today.
    const { db, calls } = fakeDb([], [saved])
    const { rule, previous } = await upsertRecurrenceRule(db, 'org_1', {
      subjectType: 'recurring_journals',
      subjectId: 'je_1',
      pattern,
      timezone: 'America/New_York',
      anchor: '2026-01-15',
      effectiveFrom: '2026-09-21',
    })

    expect(previous).toBeNull()
    expect(rule).toBe(saved)
    expect(calls.insertValues).toMatchObject({
      organizationId: 'org_1',
      subjectType: 'recurring_journals',
      subjectId: 'je_1',
      anchor: '2026-01-15',
      effectiveFrom: '2026-01-15',
      startMinute: null,
      durationMinutes: null,
      defaultAssigneeWorkerId: null,
    })
  })

  it('writes the anchor the invoice lane sets, which is today', async () => {
    const { db, calls } = fakeDb([], [saved])
    await upsertRecurrenceRule(db, 'org_1', {
      subjectType: 'invoice_drafts',
      subjectId: 'wo_1',
      pattern,
      timezone: 'UTC',
      anchor: '2026-09-21',
      effectiveFrom: '2026-09-21',
    })
    expect(calls.insertValues).toMatchObject({ anchor: '2026-09-21', effectiveFrom: '2026-09-21' })
  })

  it('moves effectiveFrom and never touches the anchor on an edit', async () => {
    const existing = { id: 'rule_1', anchor: '2026-01-15' } as unknown as RecurrenceRuleRow
    const { db, calls } = fakeDb([existing], [saved])
    const { previous } = await upsertRecurrenceRule(db, 'org_1', {
      subjectType: 'recurring_journals',
      subjectId: 'je_1',
      pattern,
      timezone: 'America/New_York',
      anchor: '2026-01-15',
      effectiveFrom: '2026-09-21',
    })

    expect(previous).toBe(existing)
    expect(calls.updateSet).toMatchObject({ effectiveFrom: '2026-09-21' })
    expect(calls.updateSet).not.toHaveProperty('anchor')
    expect(calls.updateSet).not.toHaveProperty('materializedUntil')
  })

  it('carries the visit template columns through', async () => {
    const { db, calls } = fakeDb([], [saved])
    await upsertRecurrenceRule(db, 'org_1', {
      subjectType: 'work_order_visits',
      subjectId: 'wo_1',
      pattern,
      timezone: 'UTC',
      anchor: '2026-09-21',
      effectiveFrom: '2026-09-21',
      startMinute: 540,
      durationMinutes: 90,
      defaultAssigneeWorkerId: 'worker_1',
    })
    expect(calls.insertValues).toMatchObject({
      startMinute: 540,
      durationMinutes: 90,
      defaultAssigneeWorkerId: 'worker_1',
    })
  })
})

describe('listDueRecurrenceRules', () => {
  it('filters on the cursor when a `now` is given, and is not org-scoped', async () => {
    const { db, calls } = fakeDb([])
    const now = new Date('2026-09-21T00:00:00.000Z')
    await listDueRecurrenceRules(db, { subjectType: 'invoice_drafts', now })
    const { sql, params } = renderSql(calls.selectWhere[0])
    expect(sql).toBe('( = $1 and ( is null or  < $2))')
    expect(params).toEqual(['invoice_drafts', now])
  })

  it('reads every rule of the type when `now` is omitted', async () => {
    const { db, calls } = fakeDb([])
    await listDueRecurrenceRules(db, { subjectType: 'work_order_visits' })
    const { sql, params } = renderSql(calls.selectWhere[0])
    expect(sql).toBe(' = $1')
    expect(params).toEqual(['work_order_visits'])
  })

  it('applies a limit only when one is asked for', async () => {
    const { db, calls } = fakeDb([])
    await listDueRecurrenceRules(db, { subjectType: 'invoice_drafts' })
    expect(calls.limit).toEqual([])
    await listDueRecurrenceRules(db, { subjectType: 'invoice_drafts', limit: 50 })
    expect(calls.limit).toEqual([50])
  })
})

describe('listRecurrenceRules', () => {
  it('keys the map by subjectId, not by rule id', async () => {
    const rows = [
      { id: 'rule_1', subjectId: 'wo_1' },
      { id: 'rule_2', subjectId: 'wo_2' },
    ] as unknown as RecurrenceRuleRow[]
    const { db } = fakeDb(rows)
    const map = await listRecurrenceRules(db, 'org_1', {
      subjectType: 'invoice_drafts',
      subjectIds: ['wo_1', 'wo_2', 'wo_3'],
    })
    expect([...map.keys()]).toEqual(['wo_1', 'wo_2'])
    expect(map.get('wo_1')?.id).toBe('rule_1')
    expect(map.has('wo_3')).toBe(false)
  })

  it('asks nothing of the database for an empty subject list', async () => {
    const { db, calls } = fakeDb([{ id: 'rule_1', subjectId: 'wo_1' }])
    const map = await listRecurrenceRules(db, 'org_1', {
      subjectType: 'invoice_drafts',
      subjectIds: [],
    })
    expect(map.size).toBe(0)
    expect(calls.selectWhere).toEqual([])
  })
})
