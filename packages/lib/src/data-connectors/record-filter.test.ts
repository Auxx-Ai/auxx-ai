// packages/lib/src/data-connectors/record-filter.test.ts
// The per-stream record filter's pure half (v11): the evaluator, its fail-open rule,
// and the invariant that its path reads and the mapping layer's are the SAME reads.

import { toResourceFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import type { ConditionGroup } from '../conditions/types'
import type { ConnectorRecord } from './connectors/types'
import { getByPath, mapRecord } from './map-record'
import { assertRecordFilterCompiles, recordMatchesFilter } from './record-filter'
import type { DecodedMapping } from './service'

function record(fields: Record<string, unknown>, over: Partial<ConnectorRecord> = {}) {
  return { streamKey: 'customer', externalId: 'c1', fields, ...over } as ConnectorRecord
}

function group(
  conditions: Array<{ fieldId: string; operator: string; value?: unknown }>,
  logicalOperator: 'AND' | 'OR' = 'AND'
): ConditionGroup[] {
  return [
    {
      id: 'g1',
      logicalOperator,
      conditions: conditions.map((c, i) => ({
        id: `c${i}`,
        fieldId: c.fieldId,
        operator: c.operator,
        value: c.value,
      })) as ConditionGroup['conditions'],
    },
  ]
}

describe('recordMatchesFilter', () => {
  it('matches everything when the filter is empty, null or undefined', () => {
    const r = record({ orders_count: 0 })
    for (const groups of [null, undefined, [] as ConditionGroup[]]) {
      expect(recordMatchesFilter(r, groups)).toEqual({ matched: true, diagnostics: [] })
    }
  })

  it('evaluates a scalar source path — the motivating `orders_count > 0` case', () => {
    const filter = group([{ fieldId: 'orders_count', operator: '>', value: 0 }])
    expect(recordMatchesFilter(record({ orders_count: 3 }), filter).matched).toBe(true)
    expect(recordMatchesFilter(record({ orders_count: 0 }), filter).matched).toBe(false)
    // A customer the source never gave a count for is not a customer with orders.
    expect(recordMatchesFilter(record({}), filter).matched).toBe(false)
  })

  it('resolves a nested source path (`customer.email`), not a ResourceFieldId', () => {
    const filter = group([{ fieldId: 'customer.email', operator: 'contains', value: '@auxx' }])
    expect(recordMatchesFilter(record({ customer: { email: 'a@auxx.ai' } }), filter).matched).toBe(
      true
    )
    expect(
      recordMatchesFilter(record({ customer: { email: 'a@other.com' } }), filter).matched
    ).toBe(false)
  })

  it('ANDs groups and honours each group’s own logical operator', () => {
    const r = record({ orders_count: 2, state: 'enabled' })
    const or = group(
      [
        { fieldId: 'orders_count', operator: '>', value: 5 },
        { fieldId: 'state', operator: 'is', value: 'enabled' },
      ],
      'OR'
    )
    expect(recordMatchesFilter(r, or).matched).toBe(true)
    const and = group([
      { fieldId: 'orders_count', operator: '>', value: 5 },
      { fieldId: 'state', operator: 'is', value: 'enabled' },
    ])
    expect(recordMatchesFilter(r, and).matched).toBe(false)
  })

  // 🔴 The load-bearing one. `conditions/evaluate.ts` makes an unrecognised operator
  // evaluate FALSE, so a fail-CLOSED filter would drop every record in the stream and
  // report a clean run. Here the record still goes through and the caller is told why.
  it('FAILS OPEN on an unrecognised operator — matches, and reports the diagnostic', () => {
    const filter = group([{ fieldId: 'orders_count', operator: 'greaterrr than', value: 0 }])
    const verdict = recordMatchesFilter(record({ orders_count: 0 }), filter)
    expect(verdict.matched).toBe(true)
    expect(verdict.diagnostics).toEqual([
      expect.objectContaining({ fieldId: 'orders_count', reason: 'unknown-operator' }),
    ])
  })

  it('fails open even when a SOUND condition in the same filter would have excluded the record', () => {
    const filter = group([
      { fieldId: 'orders_count', operator: '>', value: 0 },
      { fieldId: 'state', operator: 'not-an-operator', value: 'x' },
    ])
    // `orders_count: 0` alone would exclude this record; the broken sibling condition
    // means the filter as a whole is not what its author wrote, so none of it applies.
    const verdict = recordMatchesFilter(record({ orders_count: 0 }), filter)
    expect(verdict.matched).toBe(true)
    expect(verdict.diagnostics).toHaveLength(1)
  })

  it('fails open on a `currentUser` value source — a background sync has no current user', () => {
    const verdict = recordMatchesFilter(record({ owner: 'u1' }), [
      {
        id: 'g1',
        logicalOperator: 'AND',
        conditions: [
          { id: 'c0', fieldId: 'owner', operator: 'is', value: '', valueSource: 'currentUser' },
        ],
      } as ConditionGroup,
    ])
    expect(verdict.matched).toBe(true)
    expect(verdict.diagnostics).toEqual([
      expect.objectContaining({ reason: 'unresolved-value-source' }),
    ])
  })
})

describe('assertRecordFilterCompiles', () => {
  it('accepts an empty filter and a well-formed one', () => {
    expect(() => assertRecordFilterCompiles(null)).not.toThrow()
    expect(() => assertRecordFilterCompiles([])).not.toThrow()
    expect(() =>
      assertRecordFilterCompiles(group([{ fieldId: 'orders_count', operator: '>', value: 0 }]))
    ).not.toThrow()
  })

  it('rejects an unrecognised operator at SAVE time, naming the field and operator', () => {
    expect(() =>
      assertRecordFilterCompiles(
        group([{ fieldId: 'orders_count', operator: 'greaterrr', value: 0 }])
      )
    ).toThrow(/orders_count.*greaterrr/s)
  })

  it('rejects a `currentUser` value source', () => {
    expect(() =>
      assertRecordFilterCompiles([
        {
          id: 'g1',
          logicalOperator: 'AND',
          conditions: [
            { id: 'c0', fieldId: 'owner', operator: 'is', value: '', valueSource: 'currentUser' },
          ],
        } as ConditionGroup,
      ])
    ).toThrow(/dynamic value/)
  })
})

// ── One path walker, two readers ─────────────────────────────────────────────────
// The filter's vocabulary IS the mapping tree's source paths. If the filter resolved
// `line_items[0].sku` differently from how the mapping projects it, a user would set
// a filter against the value they can see in the mapping editor and get a different
// value at sync time. `record-filter.ts` uses map-record's own `getByPath` for exactly
// this reason; these tests are what would fail if someone forked a second walker.

describe('getByPath agrees with mapRecord for `a.b`, `a[].b` and `a[0].b`', () => {
  const fields = {
    customer: { email: 'a@auxx.ai' },
    line_items: [{ sku: 'AAA' }, { sku: 'BBB' }],
  }

  /** Project one source path through the real mapping layer and read the value back. */
  function throughMapRecord(rootPath: string, sourcePath: string): unknown[] {
    const mapping: DecodedMapping = {
      row: { id: 'm1' } as DecodedMapping['row'],
      rootPath,
      linkMode: 'upsert',
      targetMode: 'owned',
      entityDefinitionId: 'def1',
      parentMappingId: null,
      relationshipFieldKey: null,
      orphanBehavior: 'ignore',
      fieldMappings: [
        {
          id: 'fm1',
          targetFieldRef: toResourceFieldId('def1', 'value'),
          expression: '{v}',
          sourceFields: { v: sourcePath },
        } as DecodedMapping['fieldMappings'][number],
      ],
    }
    return mapRecord([mapping], record(fields))
      .filter((w) => w.projected)
      .map((w) => w.projected?.fields['def1:value'])
  }

  it('`a.b` — a nested scalar', () => {
    expect(getByPath(fields, 'customer.email')).toBe('a@auxx.ai')
    expect(throughMapRecord('', 'customer.email')).toEqual(['a@auxx.ai'])
  })

  it('`a[0].b` — an explicitly indexed element resolves ONE value, both ways', () => {
    expect(getByPath(fields, 'line_items[0].sku')).toBe('AAA')
    expect(getByPath(fields, 'line_items[1].sku')).toBe('BBB')
    expect(throughMapRecord('', 'line_items[0].sku')).toEqual(['AAA'])
    // Out of range resolves undefined, never a partial object.
    expect(getByPath(fields, 'line_items[9].sku')).toBeUndefined()
  })

  it('`a[].b` — the fan-out selector is the MAPPING’s, and getByPath never matches it', () => {
    // `line_items[]` fans the mapping out to one write per element…
    expect(throughMapRecord('line_items[]', 'sku')).toEqual(['AAA', 'BBB'])
    // …while `getByPath` (no digits in the segment) resolves nothing for it. A record
    // filter therefore addresses an element with `line_items[0].sku`, not `[]` — and
    // the filter and the mapping still agree on what that string means.
    expect(getByPath(fields, 'line_items[].sku')).toBeUndefined()
    expect(
      recordMatchesFilter(
        record(fields),
        group([{ fieldId: 'line_items[0].sku', operator: 'is', value: 'AAA' }])
      ).matched
    ).toBe(true)
  })

  it('a bare array path resolves the array itself in both readers', () => {
    expect(getByPath(fields, 'line_items')).toEqual(fields.line_items)
  })
})

describe('assertRecordFilterCompiles — fan-out paths', () => {
  // 🔴 The regression this exists for: `[]` produces NO diagnostics (the operator is
  // fine), so fail-open cannot catch it. Without the save-time reject, a filter on
  // `line_items[].sku` would look correct and silently match nothing.
  const fanOutGroup = (fieldId: string) => [
    {
      id: 'g1',
      logicalOperator: 'AND' as const,
      conditions: [{ id: 'c1', fieldId, operator: 'is' as const, value: 'X' }],
    },
  ]

  it('rejects a fan-out path', () => {
    expect(() => assertRecordFilterCompiles(fanOutGroup('line_items[].sku'))).toThrow(
      /repeated field/
    )
  })

  it('rejects an array-root leaf', () => {
    expect(() => assertRecordFilterCompiles(fanOutGroup('[].orders_count'))).toThrow(
      /repeated field/
    )
  })

  it('names the offending path in the message', () => {
    expect(() => assertRecordFilterCompiles(fanOutGroup('line_items[].sku'))).toThrow(
      /line_items\[\]\.sku/
    )
  })

  it('allows an INDEXED path, which getByPath does resolve', () => {
    expect(() => assertRecordFilterCompiles(fanOutGroup('line_items[0].sku'))).not.toThrow()
  })

  it('allows an ordinary scalar path', () => {
    expect(() => assertRecordFilterCompiles(fanOutGroup('orders_count'))).not.toThrow()
  })

  it('catches a fan-out path nested in subConditions', () => {
    expect(() =>
      assertRecordFilterCompiles([
        {
          id: 'g1',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'c1',
              fieldId: 'orders_count',
              operator: '>',
              value: 0,
              subConditions: [
                { id: 'c2', fieldId: 'line_items[].sku', operator: 'is', value: 'X' },
              ],
            },
          ],
        },
      ] as ConditionGroup[])
    ).toThrow(/repeated field/)
  })
})
