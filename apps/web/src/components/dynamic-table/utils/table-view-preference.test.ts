// apps/web/src/components/dynamic-table/utils/table-view-preference.test.ts

import { tableViewPreferenceConfigSchema } from '@auxx/lib/conditions/client'
import { describe, expect, it } from 'vitest'
import {
  hasPresentationPreference,
  toPersonalOverlayConfig,
  toTableViewPreferenceConfig,
} from './table-view-preference'

describe('table view preferences', () => {
  it('keeps presentation state and drops transient/shared-view state', () => {
    const preference = toTableViewPreferenceConfig({
      sorting: [{ id: 'name', desc: false }],
      columnVisibility: { email: false },
      columnOrder: ['name', 'email'],
      columnSizing: { name: 280 },
      columnPinning: { left: ['name'] },
      viewType: 'kanban',
      kanban: { groupByFieldId: 'status' },
    })

    expect(preference).toEqual({
      columnVisibility: { email: false },
      columnOrder: ['name', 'email'],
      columnSizing: { name: 280 },
      columnPinning: { left: ['name'] },
      columnLabels: undefined,
      columnFormatting: undefined,
      rowHeight: undefined,
      columnAggregates: undefined,
      collapsedGroups: undefined,
    })
    expect(preference).not.toHaveProperty('sorting')
    expect(preference).not.toHaveProperty('viewType')
    expect(preference).not.toHaveProperty('kanban')
  })

  it('treats sort-only interaction as transient', () => {
    const preference = toTableViewPreferenceConfig({
      sorting: [{ id: 'createdAt', desc: true }],
    })

    expect(hasPresentationPreference(preference)).toBe(false)
  })

  it('keeps column aggregates and stored collapsed groups but drops groupBy', () => {
    const preference = toTableViewPreferenceConfig(
      {
        groupBy: { fieldId: 'def:status', desc: true },
        columnAggregates: { 'def:amount': 'sum' },
      },
      { 'def:status': ['open', '__empty__'] }
    )

    expect(preference.columnAggregates).toEqual({ 'def:amount': 'sum' })
    expect(preference.collapsedGroups).toEqual({ 'def:status': ['open', '__empty__'] })
    expect(preference).not.toHaveProperty('groupBy')
    expect(tableViewPreferenceConfigSchema.parse(preference)).toMatchObject({
      columnAggregates: { 'def:amount': 'sum' },
      collapsedGroups: { 'def:status': ['open', '__empty__'] },
    })
  })

  it('treats group-by-only interaction as transient', () => {
    const preference = toTableViewPreferenceConfig({ groupBy: { fieldId: 'def:status' } })

    expect(hasPresentationPreference(preference)).toBe(false)
  })

  it('counts aggregates and non-empty collapsed groups as presentation', () => {
    expect(
      hasPresentationPreference(toTableViewPreferenceConfig({ columnAggregates: { a: 'avg' } }))
    ).toBe(true)
    expect(
      hasPresentationPreference(toTableViewPreferenceConfig({}, { 'def:status': ['open'] }))
    ).toBe(true)
    expect(hasPresentationPreference(toTableViewPreferenceConfig({}, { 'def:status': [] }))).toBe(
      false
    )
  })

  it('keeps collapsed groups out of the personal overlay', () => {
    const overlay = toPersonalOverlayConfig({
      columnVisibility: {},
      columnOrder: [],
      columnSizing: {},
      columnAggregates: { 'def:amount': 'max' },
      collapsedGroups: { 'def:status': ['open'] },
    })

    expect(overlay).toEqual({ columnAggregates: { 'def:amount': 'max' } })
  })

  it('drops empty containers when hydrating a personal overlay', () => {
    const overlay = toPersonalOverlayConfig({
      columnVisibility: {},
      columnOrder: [],
      columnSizing: { name: 280 },
      columnPinning: { left: ['_checkbox', 'name'] },
    })

    expect(overlay).toEqual({
      columnSizing: { name: 280 },
      columnPinning: { left: ['_checkbox', 'name'] },
    })
  })

  it('validates only the presentation payload accepted by the router', () => {
    const parsed = tableViewPreferenceConfigSchema.parse({
      columnVisibility: {},
      columnOrder: [],
      columnSizing: { name: 240 },
      sorting: [{ id: 'name', desc: false }],
    })

    expect(parsed).toEqual({
      columnVisibility: {},
      columnOrder: [],
      columnSizing: { name: 240 },
    })
  })
})
