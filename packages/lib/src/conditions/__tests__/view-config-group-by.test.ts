// packages/lib/src/conditions/__tests__/view-config-group-by.test.ts

import { describe, expect, it } from 'vitest'
import { tableViewPreferenceConfigSchema, viewConfigSchema } from '../view-config'

const baseConfig = {
  filters: [],
  sorting: [{ id: 'def:createdAt', desc: true }],
  columnVisibility: {},
  columnOrder: [],
  columnSizing: {},
}

describe('viewConfigSchema group-by keys', () => {
  it('round-trips groupBy and columnAggregates', () => {
    const config = {
      ...baseConfig,
      groupBy: { fieldId: 'def:closeDate', desc: true, dateGranularity: 'month' },
      columnAggregates: { 'def:amount': 'sum', 'def:qty': 'avg' },
    }

    const parsed = viewConfigSchema.parse(config)
    expect(parsed.groupBy).toEqual(config.groupBy)
    expect(parsed.columnAggregates).toEqual(config.columnAggregates)
    expect(viewConfigSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })

  it('still parses a legacy config without the new keys', () => {
    const parsed = viewConfigSchema.parse(baseConfig)
    expect(parsed).not.toHaveProperty('groupBy')
    expect(parsed).not.toHaveProperty('columnAggregates')
  })

  it('rejects unknown aggregate ops and granularities', () => {
    expect(() =>
      viewConfigSchema.parse({ ...baseConfig, columnAggregates: { a: 'median' } })
    ).toThrow()
    expect(() =>
      viewConfigSchema.parse({
        ...baseConfig,
        groupBy: { fieldId: 'def:closeDate', dateGranularity: 'hour' },
      })
    ).toThrow()
  })
})

describe('tableViewPreferenceConfigSchema group-by keys', () => {
  it('round-trips columnAggregates and collapsedGroups and strips groupBy', () => {
    const parsed = tableViewPreferenceConfigSchema.parse({
      columnVisibility: {},
      columnOrder: [],
      columnSizing: {},
      columnAggregates: { 'def:amount': 'max' },
      collapsedGroups: { 'def:status': ['open', '__empty__'] },
      groupBy: { fieldId: 'def:status' },
    })

    expect(parsed).toEqual({
      columnVisibility: {},
      columnOrder: [],
      columnSizing: {},
      columnAggregates: { 'def:amount': 'max' },
      collapsedGroups: { 'def:status': ['open', '__empty__'] },
    })
  })
})
