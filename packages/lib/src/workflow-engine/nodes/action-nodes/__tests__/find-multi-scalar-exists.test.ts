// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/find-multi-scalar-exists.test.ts
//
// The find node's custom-entity lane compiles field conditions with
// `entityConditionBuilder` into EXISTS subqueries over FieldValue rows
// (`executeCustomEntityQuery` → `buildGroupedQuery`). A multi-value scalar
// field (`options.multi` on EMAIL/URL/PHONE) stores one row PER value, so
// "email is X" matches a record when ANY of its rows — primary or alias —
// equals X. Plan 04-multi-email B4 pins that semantics here: the compiled
// predicate is a row-level EXISTS with no primary/sortKey restriction.

import { PgDialect, pgTable, text } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import type { ConditionGroup } from '../../../../resources/query-builder/base-condition-builder'
import {
  type EntityQueryContext,
  entityConditionBuilder,
} from '../../../../resources/query-builder/entity-condition-builder'
import { BaseType } from '../../../../resources/types'

// The builder only touches `outerTable.id` (the correlation column); the
// FieldValue side is raw SQL. A minimal real pgTable keeps the rendered SQL
// honest — the package-level schema proxy would render the column as nothing
// (project_drizzle_columns_undefined_in_vitest).
const EntityInstance = pgTable('EntityInstance', {
  id: text('id').primaryKey(),
})

/** Contact-shaped context: a multi EMAIL custom field stored in FieldValue. */
const context: EntityQueryContext = {
  fields: [
    {
      id: 'cf_email_1',
      key: 'primary_email',
      label: 'Email',
      type: BaseType.STRING,
      fieldType: 'EMAIL',
      options: { multi: true },
      capabilities: { filterable: true, sortable: true },
    } as any,
  ],
  outerTable: EntityInstance as any,
}

const dialect = new PgDialect()
const compile = (groups: ConditionGroup[]) => {
  const clause = entityConditionBuilder.buildGroupedQuery(groups, context)
  expect(clause).toBeDefined()
  return dialect.sqlToQuery(clause!)
}

const group = (operator: string, value?: unknown): ConditionGroup[] => [
  {
    id: 'g1',
    logicalOperator: 'AND',
    conditions: [{ id: 'c1', fieldId: 'primary_email', operator, value } as any],
  },
]

describe('find node — multi-scalar EMAIL conditions compile to any-row EXISTS', () => {
  it("'is X' is a bare EXISTS over FieldValue rows — an alias row matches", () => {
    const q = compile(group('is', 'alias@x.com'))

    // Row-level EXISTS correlated on the entity, equality on the typed column.
    expect(q.sql).toMatch(/EXISTS \(\s*SELECT 1 FROM "FieldValue"/i)
    expect(q.sql).toContain('"FieldValue"."entityId" = "EntityInstance"."id"')
    expect(q.sql).toContain('"FieldValue"."valueText" =')
    expect(q.params).toContain('cf_email_1')
    expect(q.params).toContain('alias@x.com')

    // No primary-row restriction: nothing pins the subquery to the first row,
    // so ANY alias row satisfies the predicate.
    expect(q.sql).not.toMatch(/sortKey/i)
    expect(q.sql).not.toMatch(/LIMIT/i)
  })

  it("'is not X' stays NULL-correct — unset records match, any-row inequality otherwise", () => {
    const q = compile(group('is not', 'alias@x.com'))

    expect(q.sql).toMatch(/NOT EXISTS/i)
    expect(q.sql).toMatch(/OR EXISTS/i)
    expect(q.params).toContain('alias@x.com')
  })

  it("'not empty' is EXISTS over any row of the field", () => {
    const q = compile(group('not empty'))

    expect(q.sql).toMatch(/EXISTS \(\s*SELECT 1 FROM "FieldValue"/i)
    expect(q.params).toContain('cf_email_1')
  })
})
