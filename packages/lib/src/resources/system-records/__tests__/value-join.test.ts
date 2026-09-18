// packages/lib/src/resources/system-records/__tests__/value-join.test.ts
//
// `owner` is what lets one join helper serve both shapes the cluster writes:
// the value hanging off the instance the query selects from, and the value
// hanging off a record it joined (a line's order, a build's order).

import { describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/database', async () => ({
  schema: await import('../../../../../database/src/db/schema/index'),
}))

import { schema } from '@auxx/database'
import { alias } from 'drizzle-orm/pg-core'
import { systemValueJoin } from '../value-join'

describe('systemValueJoin', () => {
  it('joins the value to EntityInstance by default', () => {
    const value = alias(schema.FieldValue, 'v')
    const sql = systemValueJoin(value, 'f_1')
    expect(sql).toBeDefined()
    const refs = columnNames(sql)
    expect(refs).toContain('entityId')
    expect(refs).toContain('organizationId')
    expect(refs).toContain('fieldId')
    expect(tableNames(sql)).toContain('EntityInstance')
  })

  it('joins the value to a supplied owner alias instead', () => {
    const value = alias(schema.FieldValue, 'v')
    const owner = alias(schema.EntityInstance, 'order_ei')
    const sql = systemValueJoin(value, 'f_1', owner)
    expect(sql).toBeDefined()
    // The owner's alias, not `EntityInstance`, is what the join now names.
    expect(tableNames(sql)).toContain('order_ei')
  })
})

/** The column names any depth of the composed `and(...)` refers to. */
function columnNames(sql: unknown): string[] {
  return walk(sql).map((column) => column.name)
}

function tableNames(sql: unknown): string[] {
  return walk(sql).map((column) => column.table?.[Symbol.for('drizzle:Name')] ?? '')
}

// biome-ignore lint/suspicious/noExplicitAny: walking drizzle's SQL chunk tree
function walk(node: any): any[] {
  if (!node) return []
  if (node.name && node.table) return [node]
  if (Array.isArray(node)) return node.flatMap(walk)
  if (node.queryChunks) return walk(node.queryChunks)
  return []
}
