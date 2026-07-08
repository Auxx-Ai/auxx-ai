// apps/web/src/components/dashboard/lib/metric-ops.test.ts
import type { FieldType } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import {
  isAggregableFieldType,
  isGroupableFieldType,
  metricOpLabel,
  metricOpsForFieldType,
  metricTriggerLabel,
  supportsDateGranularity,
} from './metric-ops'

const opsFor = (ft: FieldType) => metricOpsForFieldType(ft).map((o) => o.op)

describe('metricOpsForFieldType', () => {
  it('offers numeric aggregates for NUMBER/CURRENCY', () => {
    for (const ft of ['NUMBER', 'CURRENCY'] as FieldType[]) {
      expect(opsFor(ft)).toEqual([
        'sum',
        'avg',
        'min',
        'max',
        'count',
        'countUnique',
        'countEmpty',
        'countNotEmpty',
      ])
    }
  })

  it('offers earliest/latest (min/max) for date fields, no sum/avg', () => {
    for (const ft of ['DATE', 'DATETIME', 'TIME'] as FieldType[]) {
      const ops = opsFor(ft)
      expect(ops).toEqual(['count', 'min', 'max', 'countEmpty', 'countNotEmpty'])
      expect(ops).not.toContain('sum')
      expect(ops).not.toContain('avg')
    }
    expect(metricOpLabel('min', 'DATE')).toBe('Earliest')
    expect(metricOpLabel('max', 'DATETIME')).toBe('Latest')
  })

  it('offers true/false counts only for CHECKBOX', () => {
    expect(opsFor('CHECKBOX' as FieldType)).toEqual(['countTrue', 'countFalse', 'count'])
    expect(opsFor('TEXT' as FieldType)).not.toContain('countTrue')
  })

  it('offers count-family for relationships/actors', () => {
    for (const ft of ['RELATIONSHIP', 'ACTOR'] as FieldType[]) {
      expect(opsFor(ft)).toEqual(['count', 'countUnique', 'countNotEmpty'])
    }
  })

  it('offers categorical ops for select/text-like fields', () => {
    for (const ft of [
      'SINGLE_SELECT',
      'MULTI_SELECT',
      'TAGS',
      'TEXT',
      'EMAIL',
      'URL',
      'PHONE_INTL',
    ] as FieldType[]) {
      expect(opsFor(ft)).toEqual([
        'count',
        'countUnique',
        'countEmpty',
        'countNotEmpty',
        'percentEmpty',
        'percentNotEmpty',
      ])
    }
  })

  it('never offers sum/avg on a non-numeric field (server would 422)', () => {
    for (const ft of ['TEXT', 'SINGLE_SELECT', 'CHECKBOX', 'RELATIONSHIP', 'DATE'] as FieldType[]) {
      expect(opsFor(ft)).not.toContain('sum')
      expect(opsFor(ft)).not.toContain('avg')
    }
  })
})

describe('field-type predicates', () => {
  it('excludes non-aggregable field types from the metric list', () => {
    for (const ft of [
      'CALC',
      'FILE',
      'JSON',
      'RICH_TEXT',
      'NAME',
      'ADDRESS',
      'ADDRESS_STRUCT',
    ] as FieldType[]) {
      expect(isAggregableFieldType(ft)).toBe(false)
    }
    expect(isAggregableFieldType('NUMBER' as FieldType)).toBe(true)
    expect(isAggregableFieldType(undefined)).toBe(false)
  })

  it('excludes non-groupable field types (mirror validateGroupBy)', () => {
    for (const ft of [
      'CALC',
      'FILE',
      'JSON',
      'RICH_TEXT',
      'NAME',
      'ADDRESS_STRUCT',
      'TIME',
    ] as FieldType[]) {
      expect(isGroupableFieldType(ft)).toBe(false)
    }
    expect(isGroupableFieldType('SINGLE_SELECT' as FieldType)).toBe(true)
  })

  it('offers date granularity only for DATE/DATETIME (not TIME)', () => {
    expect(supportsDateGranularity('DATE' as FieldType)).toBe(true)
    expect(supportsDateGranularity('DATETIME' as FieldType)).toBe(true)
    expect(supportsDateGranularity('TIME' as FieldType)).toBe(false)
  })
})

describe('metricTriggerLabel', () => {
  it('reads "Count of records" for a fieldless count', () => {
    expect(metricTriggerLabel('count', undefined, undefined)).toBe('Count of records')
  })

  it('reads "<Op> of <Field>" for a field metric', () => {
    expect(metricTriggerLabel('sum', 'CURRENCY' as FieldType, 'Amount')).toBe('Sum of Amount')
    expect(metricTriggerLabel('max', 'DATE' as FieldType, 'Closed at')).toBe('Latest of Closed at')
  })
})
