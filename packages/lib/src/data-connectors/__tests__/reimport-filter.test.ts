// packages/lib/src/data-connectors/__tests__/reimport-filter.test.ts

import { describe, expect, it } from 'vitest'
import type { ConditionGroup } from '../../conditions/types'
import { recordMatchesFilter } from '../record-filter'
import { runFilterGroup, validateReimportFilter } from '../reimport-filter'

const AUGUST = {
  fieldId: 'createdAt',
  operator: 'between',
  value: { from: '2026-08-01', to: '2026-09-01T00:00:00Z' },
}

describe('validateReimportFilter', () => {
  it('normalises a between to ISO bounds and marks every clause exact', () => {
    const result = validateReimportFilter([
      AUGUST,
      { fieldId: 'status', operator: 'is', value: 'x' },
    ])
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'period',
      clauses: [
        {
          fieldId: 'createdAt',
          operator: 'between',
          value: { from: new Date('2026-08-01').toISOString(), to: '2026-09-01T00:00:00.000Z' },
          exact: true,
        },
        { fieldId: 'status', operator: 'is', value: 'x', exact: true },
      ],
    })
  })

  it('reads exactly one `$externalId in` clause as an id run, deduped', () => {
    const result = validateReimportFilter([
      { fieldId: '$externalId', operator: 'in', value: ['1', '2', '1'] },
    ])
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'id',
      clauses: [{ fieldId: '$externalId', operator: 'in', value: ['1', '2'], exact: true }],
    })
  })

  it('reads `$externalId in` next to another clause as a period run', () => {
    const result = validateReimportFilter([
      AUGUST,
      { fieldId: '$externalId', operator: 'in', value: ['1'] },
    ])
    expect(result._unsafeUnwrap().kind).toBe('period')
  })

  it.each([
    ['an empty field', [{ fieldId: ' ', operator: 'is', value: 'x' }]],
    ['a relative operator', [{ fieldId: 'createdAt', operator: 'within_days', value: 7 }]],
    ['an unknown operator', [{ fieldId: 'createdAt', operator: 'sounds_like', value: 'x' }]],
    [
      'an unparseable between',
      [{ fieldId: 'createdAt', operator: 'between', value: { from: 'nope' } }],
    ],
    [
      'an inverted between',
      [
        {
          fieldId: 'createdAt',
          operator: 'between',
          value: { from: '2026-09-01', to: '2026-08-01' },
        },
      ],
    ],
    ['a fan-out path', [{ fieldId: 'line_items[].sku', operator: 'is', value: 'x' }]],
    [
      '`$externalId` with another operator',
      [{ fieldId: '$externalId', operator: 'is', value: '1' }],
    ],
    ['no ids', [{ fieldId: '$externalId', operator: 'in', value: [] }]],
    [
      'too many ids',
      [
        {
          fieldId: '$externalId',
          operator: 'in',
          value: Array.from({ length: 51 }, (_, i) => String(i)),
        },
      ],
    ],
    ['a non-string id', [{ fieldId: '$externalId', operator: 'in', value: [5] }]],
  ])('refuses %s', (_label, filter) => {
    const result = validateReimportFilter(filter)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().name).toBe('BadRequestError')
  })
})

describe('the effective post-fetch filter (stream AND run)', () => {
  const stream: ConditionGroup[] = [
    {
      id: 'g',
      logicalOperator: 'AND',
      conditions: [{ id: 'c', fieldId: 'orders_count', operator: '>', value: 0 }],
    },
  ]

  it('keeps only records matching both', () => {
    const clauses = validateReimportFilter([
      { fieldId: '$externalId', operator: 'in', value: ['42'] },
    ])._unsafeUnwrap().clauses
    const effective = [...stream, runFilterGroup(clauses)]
    const record = (externalId: string, count: number) => ({
      streamKey: 'customer',
      externalId,
      fields: { orders_count: count },
    })

    expect(recordMatchesFilter(record('42', 3), effective).matched).toBe(true)
    expect(recordMatchesFilter(record('43', 3), effective).matched).toBe(false)
    expect(recordMatchesFilter(record('42', 0), effective).matched).toBe(false)
  })
})
