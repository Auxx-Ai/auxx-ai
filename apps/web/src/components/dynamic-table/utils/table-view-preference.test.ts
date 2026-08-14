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
