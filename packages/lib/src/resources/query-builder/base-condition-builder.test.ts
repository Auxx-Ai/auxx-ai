// packages/lib/src/resources/query-builder/base-condition-builder.test.ts
//
// Retrieval plan §1.2 items 4 + 7 — the builder must hand its dropped conditions
// back to the caller instead of parking them on a module singleton, and a set of
// conditions must combine with ONE operator so dropping one can never
// re-associate the rest.

import { type SQL, sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import type { FieldOptionItem } from '../registry/option-helpers'
import {
  BaseConditionBuilder,
  type ConditionGroup,
  type GenericCondition,
} from './base-condition-builder'

/** Fields this stub knows how to build; anything else drops. */
type TestContext = { known: string[] }

class TestConditionBuilder extends BaseConditionBuilder<TestContext> {
  protected conditionToSql(
    condition: GenericCondition,
    context: TestContext
  ): SQL<unknown> | undefined {
    const ref = Array.isArray(condition.fieldId) ? condition.fieldId[0] : condition.fieldId
    if (typeof ref !== 'string' || !context.known.includes(ref)) return undefined
    return sql`${sql.raw(`"${ref}"`)} = ${String(condition.value)}`
  }

  buildOrderBySql(): SQL<unknown>[] | undefined {
    return undefined
  }

  protected getFieldType(fieldId: string, context: TestContext): string | undefined {
    return context.known.includes(fieldId) ? 'string' : undefined
  }

  protected getFieldOptions(): FieldOptionItem[] | undefined {
    return undefined
  }
}

const builder = new TestConditionBuilder()
const dialect = new PgDialect()
const render = (clause: SQL<unknown> | undefined) =>
  clause ? dialect.sqlToQuery(clause).sql : undefined

const condition = (
  id: string,
  fieldId: string,
  logicalOperator?: 'AND' | 'OR'
): GenericCondition => ({
  id,
  fieldId,
  operator: 'is',
  value: id,
  ...(logicalOperator ? { logicalOperator } : {}),
})

const group = (
  conditions: GenericCondition[],
  logicalOperator: 'AND' | 'OR' = 'AND'
): ConditionGroup => ({ id: 'g1', conditions, logicalOperator })

const ctx: TestContext = { known: ['status', 'stage'] }

describe('BaseConditionBuilder — drop diagnostics', () => {
  it('returns the dropped conditions with the clause instead of stashing them', () => {
    const result = builder.buildGroupedQueryWithDiagnostics(
      [group([condition('c1', 'status'), condition('c2', 'nope')])],
      ctx
    )

    expect(result.requestedConditions).toBe(2)
    expect(result.droppedConditions).toHaveLength(1)
    expect(result.droppedConditions[0]).toMatchObject({
      conditionId: 'c2',
      fieldRef: 'nope',
      operator: 'is',
      reason: 'unresolved-field-or-operator',
    })
    // The surviving condition still builds — this IS the fail-open the AI
    // boundary has to refuse: a narrower filter than the caller asked for.
    expect(result.sql).toBeDefined()
    expect(result.allConditionsDropped).toBe(false)
  })

  it('does not accumulate diagnostics across calls (no singleton state)', () => {
    const first = builder.buildGroupedQueryWithDiagnostics([group([condition('c1', 'nope')])], ctx)
    const second = builder.buildGroupedQueryWithDiagnostics(
      [group([condition('c2', 'status')])],
      ctx
    )
    // The flat entry point used to append without ever resetting.
    const third = builder.buildWhereSqlWithDiagnostics([condition('c3', 'nope')], ctx)

    expect(first.droppedConditions).toHaveLength(1)
    expect(second.droppedConditions).toHaveLength(0)
    expect(third.droppedConditions).toHaveLength(1)
  })

  it('separates "no filter given" from "every filter dropped"', () => {
    const noFilter = builder.buildGroupedQueryWithDiagnostics([], ctx)
    expect(noFilter.sql).toBeUndefined()
    expect(noFilter.allConditionsDropped).toBe(false)

    const allDropped = builder.buildGroupedQueryWithDiagnostics(
      [group([condition('c1', 'nope'), condition('c2', 'also-nope')])],
      ctx
    )
    expect(allDropped.sql).toBeUndefined()
    expect(allDropped.allConditionsDropped).toBe(true)
  })

  it('flags an unresolved valueSource separately from an unknown field', () => {
    const result = builder.buildGroupedQueryWithDiagnostics(
      [group([{ ...condition('c1', 'status'), valueSource: 'currentUser' }])],
      ctx
    )

    expect(result.droppedConditions[0]).toMatchObject({
      reason: 'unresolved-value-source',
      detail: 'currentUser',
    })
  })

  it('projects to the bare clause through buildGroupedQuery', () => {
    const groups = [group([condition('c1', 'status'), condition('c2', 'nope')])]
    expect(render(builder.buildGroupedQuery(groups, ctx))).toBe(
      render(builder.buildGroupedQueryWithDiagnostics(groups, ctx).sql)
    )
  })
})

describe('BaseConditionBuilder — one operator per condition set', () => {
  it("honours the group's logicalOperator rather than the per-condition fold", () => {
    const or = render(
      builder.buildGroupedQuery(
        [group([condition('c1', 'status'), condition('c2', 'stage')], 'OR')],
        ctx
      )
    )
    expect(or).toContain(' or ')
    expect(or).not.toContain(' and ')
  })

  it('defaults a group to AND', () => {
    const and = render(
      builder.buildGroupedQuery([group([condition('c1', 'status'), condition('c2', 'stage')])], ctx)
    )
    expect(and).toContain(' and ')
    expect(and).not.toContain(' or ')
  })

  it('does not re-associate the survivors when a middle condition drops', () => {
    // Left-folding per-condition operators built `(a AND b) OR c`; dropping `b`
    // silently turned that into `a OR c`. One operator per group can't.
    const withMiddle = render(
      builder.buildGroupedQuery(
        [
          group(
            [condition('a', 'status'), condition('b', 'stage'), condition('c', 'status', 'OR')],
            'OR'
          ),
        ],
        ctx
      )
    )
    const withoutMiddle = render(
      builder.buildGroupedQuery(
        [group([condition('a', 'status'), condition('c', 'status', 'OR')], 'OR')],
        ctx
      )
    )

    expect(withMiddle).toContain(' or ')
    expect(withoutMiddle).toContain(' or ')
    expect(withoutMiddle).not.toContain(' and ')
  })

  it('derives a single operator for a flat (group-less) condition array', () => {
    const anyOr = render(
      builder.buildWhereSql(
        [condition('a', 'status'), condition('b', 'stage', 'OR'), condition('c', 'status')],
        ctx
      )
    )
    expect(anyOr).toContain(' or ')
    expect(anyOr).not.toContain(' and ')

    const allAnd = render(
      builder.buildWhereSql([condition('a', 'status'), condition('b', 'stage')], ctx)
    )
    expect(allAnd).toContain(' and ')
  })
})

describe('BaseConditionBuilder — validateConditions', () => {
  it('reports an unknown field', () => {
    const result = builder.validateConditions([condition('c1', 'nope')], ctx)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Unknown field: nope')
  })

  it('validates only the source hop of a dot-notation relationship path', () => {
    // 'status.name' is a relationship traversal the builder handles; validating
    // the whole string against this context would reject a legitimate filter.
    const result = builder.validateConditions([condition('c1', 'status.name')], ctx)
    expect(result.valid).toBe(true)
  })

  it('prefixes group validation errors with the group number', () => {
    const result = builder.validateConditionGroups([group([condition('c1', 'nope')])], ctx)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Group 1:')
  })
})
