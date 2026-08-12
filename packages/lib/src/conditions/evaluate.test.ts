// packages/lib/src/conditions/evaluate.test.ts

import { describe, expect, it } from 'vitest'
import {
  evaluateConditions,
  evaluateConditionsWithDiagnostics,
  FIELD_NOT_RESOLVABLE,
  type FieldResolver,
  normalizeStatusConditions,
} from './evaluate'
import type { Condition, ConditionGroup } from './types'

type Entity = Record<string, unknown>

const resolver: FieldResolver<Entity> = (entity, fieldId) => entity[fieldId]

function condition(overrides: Partial<Condition> & Pick<Condition, 'fieldId'>): Condition {
  return {
    id: overrides.id ?? `c-${String(overrides.fieldId)}`,
    operator: 'is',
    value: '',
    ...overrides,
  } as Condition
}

function group(conditions: Condition[], logicalOperator: 'AND' | 'OR' = 'AND'): ConditionGroup {
  return { id: 'g1', conditions, logicalOperator }
}

describe('evaluateConditions', () => {
  it('matches everything when there are no groups', () => {
    expect(evaluateConditions({ status: 'open' }, [], resolver)).toBe(true)
  })

  it('ANDs the conditions inside a group', () => {
    const groups = [
      group([
        condition({ fieldId: 'status', operator: 'is', value: 'open' }),
        condition({ id: 'c2', fieldId: 'priority', operator: 'is', value: 'high' }),
      ]),
    ]

    expect(evaluateConditions({ status: 'open', priority: 'high' }, groups, resolver)).toBe(true)
    expect(evaluateConditions({ status: 'open', priority: 'low' }, groups, resolver)).toBe(false)
  })

  it('ORs the conditions inside a group when the group says so', () => {
    const groups = [
      group(
        [
          condition({ fieldId: 'status', operator: 'is', value: 'open' }),
          condition({ id: 'c2', fieldId: 'priority', operator: 'is', value: 'high' }),
        ],
        'OR'
      ),
    ]

    expect(evaluateConditions({ status: 'closed', priority: 'high' }, groups, resolver)).toBe(true)
    expect(evaluateConditions({ status: 'closed', priority: 'low' }, groups, resolver)).toBe(false)
  })

  it('ANDs groups at the top level', () => {
    const groups = [
      group([condition({ fieldId: 'status', operator: 'is', value: 'open' })]),
      {
        ...group([condition({ id: 'c2', fieldId: 'priority', operator: 'is', value: 'high' })]),
        id: 'g2',
      },
    ]

    expect(evaluateConditions({ status: 'open', priority: 'high' }, groups, resolver)).toBe(true)
    expect(evaluateConditions({ status: 'open', priority: 'low' }, groups, resolver)).toBe(false)
  })

  it('passes a field the caller cannot resolve client-side', () => {
    const unresolvable: FieldResolver<Entity> = () => FIELD_NOT_RESOLVABLE
    const groups = [group([condition({ fieldId: 'freeText', operator: 'contains', value: 'x' })])]

    expect(evaluateConditions({}, groups, unresolvable)).toBe(true)
  })

  it('resolves a currentUser value source from the context', () => {
    const groups = [
      group([
        condition({ fieldId: 'assignee', operator: 'is', value: '', valueSource: 'currentUser' }),
      ]),
    ]

    expect(
      evaluateConditions({ assignee: 'user-1' }, groups, resolver, { currentUserId: 'user-1' })
    ).toBe(true)
    expect(
      evaluateConditions({ assignee: 'user-2' }, groups, resolver, { currentUserId: 'user-1' })
    ).toBe(false)
  })

  it('compares strings case-insensitively, as the shared evaluator does', () => {
    const groups = [group([condition({ fieldId: 'status', operator: 'is', value: 'OPEN' })])]

    expect(evaluateConditions({ status: 'open' }, groups, resolver)).toBe(true)
  })

  it('evaluates `key equals`, which used to fall through to "match everything"', () => {
    const groups = [
      group([condition({ fieldId: 'meta', operator: 'key equals', value: 'status:paid' })]),
    ]

    expect(evaluateConditions({ meta: { status: 'paid' } }, groups, resolver)).toBe(true)
    expect(evaluateConditions({ meta: { status: 'unpaid' } }, groups, resolver)).toBe(false)
  })
})

describe('unknown operators fail closed', () => {
  // 🔴 The dangerous half of the old evaluator: an operator with no case returned
  // `true`, so a filter built from retired vocabulary matched every record it was
  // pointed at — and record rules / sequence enrollment act on that answer.
  const groups = [
    group([condition({ fieldId: 'status', operator: 'equals' as never, value: 'open' })]),
  ]

  it('does not match', () => {
    expect(evaluateConditions({ status: 'open' }, groups, resolver)).toBe(false)
  })

  it('reports the condition through the diagnostics variant', () => {
    const { matched, diagnostics } = evaluateConditionsWithDiagnostics(
      { status: 'open' },
      groups,
      resolver
    )

    expect(matched).toBe(false)
    expect(diagnostics).toEqual([
      {
        conditionId: 'c-status',
        fieldId: 'status',
        operator: 'equals',
        reason: 'unknown-operator',
      },
    ])
  })

  it('flattens a relationship path into the diagnostic field id', () => {
    const { diagnostics } = evaluateConditionsWithDiagnostics(
      {},
      [
        group([
          condition({
            fieldId: ['work_order:contact', 'contact:name'] as never,
            operator: 'equals' as never,
          }),
        ]),
      ],
      resolver
    )

    expect(diagnostics[0]?.fieldId).toBe('work_order:contact::contact:name')
  })
})

describe('evaluateConditionsWithDiagnostics', () => {
  it('reports nothing for a condition set that evaluates as written', () => {
    const { matched, diagnostics } = evaluateConditionsWithDiagnostics(
      { status: 'open' },
      [group([condition({ fieldId: 'status', operator: 'is', value: 'open' })])],
      resolver
    )

    expect(matched).toBe(true)
    expect(diagnostics).toEqual([])
  })

  it('reports a dropped currentUser condition when there is no user in context', () => {
    const { matched, diagnostics } = evaluateConditionsWithDiagnostics(
      { assignee: 'user-1' },
      [
        group([
          condition({ fieldId: 'assignee', operator: 'is', value: '', valueSource: 'currentUser' }),
        ]),
      ],
      resolver
    )

    // Dropped conditions still leave the group matching — but the caller is told.
    expect(matched).toBe(true)
    expect(diagnostics).toEqual([
      {
        conditionId: 'c-assignee',
        fieldId: 'assignee',
        operator: 'is',
        reason: 'unresolved-value-source',
      },
    ])
  })

  it('collects diagnostics from later groups even when an earlier one already failed', () => {
    const { matched, diagnostics } = evaluateConditionsWithDiagnostics(
      { status: 'closed', priority: 'high' },
      [
        group([condition({ fieldId: 'status', operator: 'is', value: 'open' })]),
        {
          ...group([
            condition({
              id: 'c2',
              fieldId: 'priority',
              operator: 'equals' as never,
              value: 'high',
            }),
          ]),
          id: 'g2',
        },
      ],
      resolver
    )

    expect(matched).toBe(false)
    expect(diagnostics.map((d) => d.conditionId)).toEqual(['c2'])
  })
})

describe('normalizeStatusConditions', () => {
  it('expands a virtual status into a DB status plus an assignee condition', () => {
    const [normalized] = normalizeStatusConditions([
      group([condition({ fieldId: 'status', operator: 'is', value: 'unassigned' })]),
    ])

    expect(normalized?.conditions).toHaveLength(2)
    expect(normalized?.conditions[0]?.value).toBe('OPEN')
    expect(normalized?.conditions[1]).toMatchObject({ fieldId: 'assignee', operator: 'empty' })
  })

  it('leaves a DB status value alone', () => {
    const [normalized] = normalizeStatusConditions([
      group([condition({ fieldId: 'status', operator: 'is', value: 'ARCHIVED' })]),
    ])

    expect(normalized?.conditions).toHaveLength(1)
    expect(normalized?.conditions[0]?.value).toBe('ARCHIVED')
  })
})
