// packages/lib/src/ai/kopilot/capabilities/record-views/__tests__/build-view-config.test.ts

import { describe, expect, it } from 'vitest'
import type { Resource } from '../../../../../resources/registry/types'
import { buildViewConfig, buildViewConfigPatch } from '../build-view-config'

const ENTITY_DEF = 'def-1'

// Minimal resource — the key-presence contract below exercises the sort/column
// paths (which only need `findField`) and the filters-presence branch, so no
// field-type metadata is required.
const resource = {
  id: ENTITY_DEF,
  label: 'Contact',
  plural: 'Contacts',
  fields: [
    { id: 'name', key: 'name', systemAttribute: 'name' },
    { id: 'email', key: 'email', systemAttribute: 'email' },
  ],
} as unknown as Resource

describe('buildViewConfigPatch (merge unit for updates)', () => {
  it('returns an empty patch when nothing is specified', () => {
    const { patch } = buildViewConfigPatch({}, resource, ENTITY_DEF)
    expect(patch).toEqual({})
  })

  it('only emits `sorting` when a sort is given', () => {
    const { patch } = buildViewConfigPatch(
      { sort: { field: 'name', direction: 'desc' } },
      resource,
      ENTITY_DEF
    )
    expect(Object.keys(patch)).toEqual(['sorting'])
    expect(patch.sorting?.[0]?.desc).toBe(true)
  })

  it('only emits column keys when columns are given', () => {
    const { patch } = buildViewConfigPatch({ columns: ['name'] }, resource, ENTITY_DEF)
    expect(Object.keys(patch).sort()).toEqual(['columnOrder', 'columnVisibility'])
    expect(patch.columnOrder).toHaveLength(1)
  })

  it('emits an explicit empty `filters` array to clear filters', () => {
    const { patch } = buildViewConfigPatch({ filters: [] }, resource, ENTITY_DEF)
    expect(Object.keys(patch)).toEqual(['filters'])
    expect(patch.filters).toEqual([])
  })

  it('never touches sizing/pinning/formatting (so an edit preserves UI state)', () => {
    const { patch } = buildViewConfigPatch(
      { sort: { field: 'name', direction: 'asc' } },
      resource,
      ENTITY_DEF
    )
    expect(patch).not.toHaveProperty('columnSizing')
    expect(patch).not.toHaveProperty('columnPinning')
    expect(patch).not.toHaveProperty('columnFormatting')
  })
})

describe('buildViewConfig (create path unchanged)', () => {
  it('wraps an empty patch over full empty defaults', () => {
    const { config } = buildViewConfig({}, resource, ENTITY_DEF)
    expect(config).toEqual({
      filters: [],
      sorting: [],
      columnVisibility: {},
      columnOrder: [],
      columnSizing: {},
      viewType: 'table',
    })
  })

  it('folds a provided sort into the full config', () => {
    const { config } = buildViewConfig(
      { sort: { field: 'email', direction: 'desc' } },
      resource,
      ENTITY_DEF
    )
    expect(config.sorting).toHaveLength(1)
    expect(config.sorting[0]?.desc).toBe(true)
    // Untouched keys still carry their empty defaults.
    expect(config.columnSizing).toEqual({})
    expect(config.filters).toEqual([])
  })
})
