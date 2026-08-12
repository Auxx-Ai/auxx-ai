// apps/web/src/components/workflow/nodes/core/list/schema.test.ts

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Condition } from '~/components/conditions'
import { useFilterConditions } from './hooks/use-filter-conditions'
import { createListDefaultData, listNodeDataSchema, listNodeDefinition } from './schema'
import type { ListNodeData, ListOperation } from './types'
import { OPERATION_METADATA } from './types'

/**
 * The builder half of the list node's contract with `ListProcessor`.
 *
 * The parity suite cannot cover any of this: `filterConfig.logic` and
 * `uniqueConfig.caseSensitive` are read through a helper's PARAMETER in the
 * processor (`executeFilter(list, node.data.filterConfig)` → `config.logic`), and
 * its static reader only sees top-level `node.data.<key>` reads. So the agreement
 * has to be pinned here, by hand.
 */

function condition(id: string, overrides: Partial<Condition> = {}): Condition {
  return {
    id,
    fieldId: 'status',
    operator: 'is',
    value: 'open',
    isConstant: true,
    ...overrides,
  } as Condition
}

/**
 * How `ConditionList` decides which of AND / OR to display
 * (`components/conditions/components/condition-list.tsx:39`). The persisted
 * `filterConfig.logic` has to agree with this exact expression or the selector
 * shows one thing and the engine does another.
 */
function displayedLogic(conditions: Condition[]): 'AND' | 'OR' {
  return conditions.length > 1 ? (conditions[1]?.logicalOperator ?? 'AND') : 'AND'
}

function updateConditions(conditions: Condition[], data: ListNodeData = baseData()) {
  const setNodeData = vi.fn()
  const { result } = renderHook(() => useFilterConditions(data, setNodeData))
  result.current.handleConditionsChange(conditions)

  return (setNodeData.mock.calls[0]?.[0] as ListNodeData).filterConfig
}

function baseData(): ListNodeData {
  return createListDefaultData() as ListNodeData
}

describe('list node — filterConfig.logic mirrors the AND/OR selector', () => {
  it('seeds AND on a fresh node', () => {
    expect(createListDefaultData().filterConfig?.logic).toBe('AND')
  })

  it('writes AND for a single condition, which has no logical operator of its own', () => {
    const conditions = [condition('c1')]
    const config = updateConditions(conditions)

    expect(config?.logic).toBe('AND')
    expect(config?.logic).toBe(displayedLogic(conditions))
  })

  // The selector writes the choice onto every condition AFTER the first
  // (`condition-list.tsx:50`), and reads it back off `conditions[1]`. The first
  // condition's own `logicalOperator` is always cleared, so a reader that started
  // at index 0 would answer AND for an OR filter.
  it('writes OR when the selector has set OR on the conditions after the first', () => {
    const conditions = [
      condition('c1'),
      condition('c2', { logicalOperator: 'OR' }),
      condition('c3', { logicalOperator: 'OR' }),
    ]
    const config = updateConditions(conditions)

    expect(config?.logic).toBe('OR')
    expect(config?.logic).toBe(displayedLogic(conditions))
  })

  it('writes AND when the selector has set AND', () => {
    const conditions = [condition('c1'), condition('c2', { logicalOperator: 'AND' })]
    const config = updateConditions(conditions)

    expect(config?.logic).toBe('AND')
    expect(config?.logic).toBe(displayedLogic(conditions))
  })

  it('ignores a logical operator left on the first condition', () => {
    const conditions = [
      condition('c1', { logicalOperator: 'OR' }),
      condition('c2', { logicalOperator: 'AND' }),
    ]
    const config = updateConditions(conditions)

    expect(config?.logic).toBe('AND')
    expect(config?.logic).toBe(displayedLogic(conditions))
  })

  it('re-derives the logic on every conditions change, so a removal cannot strand a stale OR', () => {
    const stale = { ...baseData(), filterConfig: { conditions: [], logic: 'OR' as const } }
    const config = updateConditions([condition('c1')], stale)

    expect(config?.logic).toBe('AND')
  })

  it('exposes the persisted logic for the panel to read back', () => {
    const data = {
      ...baseData(),
      filterConfig: { conditions: [condition('c1')], logic: 'OR' as const },
    }
    const { result } = renderHook(() => useFilterConditions(data, vi.fn()))

    expect(result.current.logic).toBe('OR')
  })
})

describe('list node — the schema accepts everything the panels can write', () => {
  const valid = (data: Partial<ListNodeData>) =>
    listNodeDataSchema.safeParse({ id: 'list-1', type: 'list', inputList: '{{n1.items}}', ...data })

  // Every operation in `OPERATION_METADATA` is offered in the panel's operation
  // picker, so one the schema rejects is a node the builder marks invalid the
  // moment it is created. `unique` shipped exactly that way.
  it.each(
    Object.keys(OPERATION_METADATA) as ListOperation[]
  )('accepts the `%s` operation the picker offers', (operation) => {
    expect(valid({ operation }).success).toBe(true)
  })

  it('rejects an operation the engine has no case for', () => {
    expect(valid({ operation: 'reduce' as ListOperation }).success).toBe(false)
  })

  it('accepts uniqueConfig with keepFirst and caseSensitive, as panel.tsx seeds it', () => {
    const parsed = valid({
      operation: 'unique',
      uniqueConfig: { by: 'whole', keepFirst: true, caseSensitive: true },
    })

    expect(parsed.success).toBe(true)
  })

  // `NavigableFieldSelector` hands back a `FieldPath` array for a relationship
  // traversal, so a `z.string()` field marked every such node invalid.
  it.each([
    ['unique', { operation: 'unique', uniqueConfig: { by: 'field', field: ['a:b', 'b:c'] } }],
    ['pluck', { operation: 'pluck', pluckConfig: { field: ['a:b', 'b:c'] } }],
    ['join', { operation: 'join', joinConfig: { delimiter: ', ', field: ['a:b', 'b:c'] } }],
  ] as Array<
    [string, Partial<ListNodeData>]
  >)('%s accepts a FieldPath array as well as a single field id', (_label, data) => {
    expect(valid(data).success).toBe(true)
  })

  it('marks a unique node valid through the node definition validator', () => {
    const result = listNodeDefinition.validator?.({
      ...baseData(),
      id: 'list-1',
      type: 'list',
      inputList: '{{n1.items}}',
      operation: 'unique',
      filterConfig: undefined,
      uniqueConfig: { by: 'field', field: 'contact:email', keepFirst: true, caseSensitive: true },
    } as ListNodeData)

    expect(result?.isValid).toBe(true)
  })
})
