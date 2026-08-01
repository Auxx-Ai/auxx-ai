// packages/lib/src/resources/query-builder/system-condition-builder.test.ts
//
// The system builder's twin of the entity builder's guarantees:
//   1. an operator with no case produces NO SQL (a recorded drop), never a
//      guessed `=` — the one failure mode that is invisible to every diagnostic
//      PR #1470 added, because it yields a clause and so is never dropped;
//   2. `before` / `after` compile on date columns, as they always have on
//      entities (`entity-condition-builder.ts`);
//   3. a FieldValue-backed relationship (`article:tags`) compiles to the
//      FieldValue EXISTS subquery instead of falling through "no dbColumn" into
//      a drop that silently returns every article.
//
// `@auxx/database`'s `schema` is a Proxy of empty objects under this package's
// Vitest setup, so column-level SQL renders as nothing
// (`project_drizzle_columns_undefined_in_vitest`). This file pins the three
// tables it needs to REAL Drizzle tables through `createSchemaMock`, which
// keeps the auto-vivifying proxy for everything else in the import graph.

import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import type { Operator } from '../../conditions/operator-definitions'
import type { ConditionGroup, GenericCondition } from './base-condition-builder'
import { systemConditionBuilder } from './system-condition-builder'

// Tables are built INSIDE the factory: `vi.mock` is hoisted above every
// top-level binding in this file.
vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  const { boolean, pgTable, text, timestamp } = await import('drizzle-orm/pg-core')

  return {
    database: createChainableDatabaseMock(),
    schema: createSchemaMock({
      Article: pgTable('Article', {
        id: text('id').primaryKey(),
        title: text('title'),
        status: text('status'),
        publishedAt: timestamp('publishedAt'),
        isPublished: boolean('isPublished'),
      }),
      Thread: pgTable('Thread', {
        id: text('id').primaryKey(),
        subject: text('subject'),
      }),
      FieldValue: pgTable('FieldValue', {
        id: text('id').primaryKey(),
        fieldId: text('fieldId'),
        entityId: text('entityId'),
        relatedEntityId: text('relatedEntityId'),
        valueText: text('valueText'),
      }),
      CustomField: pgTable('CustomField', {
        id: text('id').primaryKey(),
        systemAttribute: text('systemAttribute'),
      }),
    }),
    IntegrationProviderTypeValues: ['google', 'outlook'],
  }
})

const dialect = new PgDialect()
const render = (clause: SQL<unknown> | undefined) =>
  clause ? dialect.sqlToQuery(clause) : undefined

const group = (conditions: GenericCondition[]): ConditionGroup[] => [
  { id: 'g1', logicalOperator: 'AND', conditions },
]

const condition = (fieldId: string, operator: string, value?: unknown): GenericCondition => ({
  id: `c-${fieldId}-${operator}`,
  fieldId,
  operator: operator as Operator,
  value,
})

describe('SystemConditionBuilder — unknown operators are drops, not guesses', () => {
  it.each([
    'length =',
    'has key',
    'key equals',
    'exists',
  ])("records '%s' as a dropped condition instead of compiling an equality", (operator) => {
    const result = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      group([condition('article:title', operator, 'x')]),
      'article'
    )

    expect(result.sql).toBeUndefined()
    expect(result.allConditionsDropped).toBe(true)
    expect(result.droppedConditions).toEqual([
      expect.objectContaining({
        fieldRef: 'article:title',
        operator,
        reason: 'unresolved-field-or-operator',
      }),
    ])
  })

  it('reports the drop even when a sibling condition survives', () => {
    // The dangerous case: `allConditionsDropped` stays false, so only
    // `droppedConditions` tells the AI boundary the filter was ignored.
    const result = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      group([
        condition('article:status', 'is', 'PUBLISHED'),
        condition('article:title', 'length =', 5),
      ]),
      'article'
    )

    expect(render(result.sql)?.sql).toContain('"Article"."status"')
    expect(result.allConditionsDropped).toBe(false)
    expect(result.droppedConditions).toHaveLength(1)
    expect(result.droppedConditions[0]?.operator).toBe('length =')
  })
})

describe('SystemConditionBuilder — before / after on date columns', () => {
  it("compiles 'after' to a greater-than, not an equality", () => {
    const result = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      group([condition('article:publishedAt', 'after', '2025-01-01T00:00:00.000Z')]),
      'article'
    )

    const rendered = render(result.sql)
    expect(rendered?.sql).toBe('"Article"."publishedAt" > $1')
    // A real Date reached the column encoder — a passthrough string would have
    // thrown in Drizzle's timestamp mapper instead of binding.
    expect(String(rendered?.params[0])).toContain('2025-01-01')
    expect(result.droppedConditions).toHaveLength(0)
  })

  it("compiles 'before' to a less-than", () => {
    const result = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      group([condition('article:publishedAt', 'before', '2025-01-01T00:00:00.000Z')]),
      'article'
    )

    expect(render(result.sql)?.sql).toBe('"Article"."publishedAt" < $1')
  })

  it('drops before/after on a non-date column rather than comparing a string', () => {
    const result = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      group([condition('article:title', 'after', '2025-01-01')]),
      'article'
    )

    expect(result.sql).toBeUndefined()
    expect(result.allConditionsDropped).toBe(true)
  })

  it('drops an unparseable date instead of handing Drizzle a raw string', () => {
    // Drizzle calls .toISOString() on whatever it gets for a timestamp column,
    // so a passthrough here throws at build time instead of dropping.
    const result = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      group([condition('article:publishedAt', 'after', 'not-a-date')]),
      'article'
    )

    expect(result.sql).toBeUndefined()
    expect(result.allConditionsDropped).toBe(true)
  })
})

describe('SystemConditionBuilder — FieldValue-backed relationships', () => {
  it('routes article:tags to a FieldValue EXISTS subquery keyed by systemAttribute', () => {
    const result = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      group([condition('article:tags', 'is', 'entdef_tag:tag_123')]),
      'article'
    )

    const rendered = render(result.sql)
    expect(result.droppedConditions).toHaveLength(0)
    expect(rendered?.sql).toContain('EXISTS')
    expect(rendered?.sql).toContain('"FieldValue" fv')
    expect(rendered?.sql).toContain('"CustomField" cf')
    // Correlated to the outer row — not a self-join.
    expect(rendered?.sql).toContain('fv."entityId" = "Article"."id"')
    // The RecordId prefix comes off: FieldValue stores the bare instance id.
    expect(rendered?.params).toEqual(['article_tags', 'tag_123'])
  })

  it("treats 'in' as a set membership over the related ids", () => {
    const result = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      group([condition('article:tags', 'in', ['entdef_tag:tag_1', 'tag_2'])]),
      'article'
    )

    const rendered = render(result.sql)
    expect(rendered?.sql).toContain('fv."relatedEntityId" IN ($2, $3)')
    expect(rendered?.params).toEqual(['article_tags', 'tag_1', 'tag_2'])
  })

  it("compiles 'is not' as NOT EXISTS — a record with other tags must not match", () => {
    const result = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      group([condition('article:tags', 'is not', 'tag_123')]),
      'article'
    )

    expect(render(result.sql)?.sql.startsWith('NOT EXISTS')).toBe(true)
  })

  it('answers empty / not empty from row existence', () => {
    const empty = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      group([condition('article:tags', 'empty')]),
      'article'
    )
    const notEmpty = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      group([condition('article:tags', 'not empty')]),
      'article'
    )

    expect(render(empty.sql)?.sql.startsWith('NOT EXISTS')).toBe(true)
    expect(render(notEmpty.sql)?.sql.startsWith('EXISTS')).toBe(true)
  })

  it('accepts the { recordId } value shape the relation picker produces', () => {
    const result = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      group([condition('article:tags', 'is', { recordId: 'entdef_tag:tag_9' })]),
      'article'
    )

    expect(render(result.sql)?.params).toEqual(['article_tags', 'tag_9'])
  })

  it('drops a tags condition with no usable value rather than matching everything', () => {
    const result = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      group([condition('article:tags', 'is', [])]),
      'article'
    )

    expect(result.sql).toBeUndefined()
    expect(result.allConditionsDropped).toBe(true)
  })

  it('generalizes to thread:tags — the rule is the declaration, not the field name', () => {
    const result = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      group([condition('thread:tags', 'is', 'tag_7')]),
      'thread'
    )

    expect(render(result.sql)?.sql).toContain('fv."entityId" = "Thread"."id"')
    expect(render(result.sql)?.params).toEqual(['thread_tags', 'tag_7'])
  })

  it('does NOT route article:children — an FK inverse has no FieldValue rows', () => {
    // `children` is the inverse of `parent` (Article.parentId), so a FieldValue
    // subquery would match nothing: fail-closed and silent. A recorded drop is
    // the honest outcome until it gets a real self-join implementation.
    const result = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      group([condition('article:children', 'is', 'art_1')]),
      'article'
    )

    expect(result.sql).toBeUndefined()
    expect(result.droppedConditions).toHaveLength(1)
  })

  it('leaves column-backed fields on their column', () => {
    const result = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      group([condition('article:status', 'is', 'PUBLISHED')]),
      'article'
    )

    const rendered = render(result.sql)
    expect(rendered?.sql).toBe('"Article"."status" = $1')
    expect(rendered?.sql).not.toContain('FieldValue')
  })
})
