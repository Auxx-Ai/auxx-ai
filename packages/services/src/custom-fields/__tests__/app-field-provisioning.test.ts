// packages/services/src/custom-fields/__tests__/app-field-provisioning.test.ts
// Pure-diff coverage for the app-field reconciler (create / drift / orphan). No DB
// harness — `computeAppFieldReconcileActions` is DB-free by construction.

import type { CatalogAppField } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'

// The pure diff under test touches no DB — but importing the module pulls
// `@auxx/database` (DATABASE_URL at load). Stub it; the diff never reads it.
vi.mock('@auxx/database', () => ({ database: {}, schema: {} }))

import {
  computeAppFieldReconcileActions,
  type ExistingAppFieldRow,
} from '../app-field-provisioning'

const APP_SLUG = 'shopify'

function field(overrides: Partial<CatalogAppField> = {}): CatalogAppField {
  return {
    appFieldKey: 'customerId',
    scope: 'installation',
    targetEntity: 'contact',
    type: 'TEXT',
    name: 'Customer ID',
    ...overrides,
  }
}

function row(overrides: Partial<ExistingAppFieldRow> = {}): ExistingAppFieldRow {
  return {
    id: 'cf_1',
    appFieldKey: 'customerId',
    connectionId: null,
    type: 'TEXT',
    name: 'Customer ID',
    description: null,
    isIdentity: false,
    appSlug: APP_SLUG,
    options: null,
    required: false,
    isUnique: false,
    isCreatable: true,
    isUpdatable: true,
    isComputed: false,
    isSortable: true,
    isFilterable: true,
    isHidden: false,
    ...overrides,
  }
}

const NO_VALUES = () => false
const HAS_VALUES = () => true

function run(params: {
  catalogFields: CatalogAppField[]
  existingRows?: ExistingAppFieldRow[]
  connectionIds?: string[]
  hasValues?: (id: string) => boolean
}) {
  return computeAppFieldReconcileActions({
    catalogFields: params.catalogFields,
    existingRows: params.existingRows ?? [],
    connectionIds: params.connectionIds ?? [],
    hasValues: params.hasValues ?? NO_VALUES,
    appSlug: APP_SLUG,
  })
}

describe('computeAppFieldReconcileActions', () => {
  it('creates a missing installation-scope cell with connectionId null', () => {
    const { actions, errors } = run({ catalogFields: [field()] })
    expect(errors).toEqual([])
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      kind: 'create',
      appFieldKey: 'customerId',
      connectionId: null,
    })
  })

  it('creates one cell per connection for missing connection-scope fields (the incident shape)', () => {
    // Catalog declares 2 connection-scoped fields, 1 org-scoped connection, 0 rows → 2 creates.
    const { actions, errors } = run({
      catalogFields: [
        field({ appFieldKey: 'customerId', scope: 'connection' }),
        field({ appFieldKey: 'storeDomain', scope: 'connection', name: 'Store Domain' }),
      ],
      connectionIds: ['conn_1'],
    })
    expect(errors).toEqual([])
    expect(actions).toHaveLength(2)
    expect(actions.every((a) => a.kind === 'create' && a.connectionId === 'conn_1')).toBe(true)
    expect(actions.map((a) => a.appFieldKey).sort()).toEqual(['customerId', 'storeDomain'])
  })

  it('creates a connection-scope field once per connection', () => {
    const { actions } = run({
      catalogFields: [field({ scope: 'connection' })],
      connectionIds: ['conn_1', 'conn_2'],
    })
    expect(actions).toHaveLength(2)
    expect(actions.map((a) => a.connectionId).sort()).toEqual(['conn_1', 'conn_2'])
  })

  it('emits no action when an existing row matches the catalog exactly', () => {
    const { actions, errors } = run({ catalogFields: [field()], existingRows: [row()] })
    expect(errors).toEqual([])
    expect(actions).toEqual([])
  })

  it('updates only the drifted name column', () => {
    const { actions } = run({
      catalogFields: [field({ name: 'Renamed Customer ID' })],
      existingRows: [row({ name: 'Customer ID' })],
    })
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: 'update', existingFieldId: 'cf_1' })
    expect(actions[0]!.changes).toEqual({ name: 'Renamed Customer ID' })
  })

  it('updates a drifted capability column only', () => {
    const { actions } = run({
      catalogFields: [field({ capabilities: { hidden: true } })],
      existingRows: [row({ isHidden: false })],
    })
    expect(actions).toHaveLength(1)
    expect(actions[0]!.changes).toEqual({ isHidden: true })
  })

  it('adds isIdentity when the catalog flags identity: true', () => {
    const { actions } = run({
      catalogFields: [field({ identity: true })],
      existingRows: [row({ isIdentity: false })],
    })
    expect(actions).toHaveLength(1)
    expect(actions[0]!.changes).toEqual({ isIdentity: true })
  })

  it('re-stamps a null appSlug on drift', () => {
    const { actions } = run({
      catalogFields: [field()],
      existingRows: [row({ appSlug: null })],
    })
    expect(actions).toHaveLength(1)
    expect(actions[0]!.changes).toEqual({ appSlug: APP_SLUG })
  })

  it('does NOT update when select options only differ by key order (jsonb reorder)', () => {
    const selectField = field({
      type: 'SINGLE_SELECT',
      options: [
        { value: 'a', label: 'A', color: 'red' },
        { value: 'b', label: 'B', color: 'blue' },
      ],
    })
    // Stored options: wrapped, keys reordered, same content.
    const stored = {
      isCustom: true,
      options: [
        { color: 'red', label: 'A', value: 'a' },
        { label: 'B', value: 'b', color: 'blue' },
      ],
    }
    const { actions } = run({
      catalogFields: [selectField],
      existingRows: [row({ type: 'SINGLE_SELECT', options: stored })],
    })
    expect(actions).toEqual([])
  })

  it('updates options when the select set actually changes, preserving the wrapper', () => {
    const selectField = field({
      type: 'SINGLE_SELECT',
      options: [{ value: 'a', label: 'A' }],
    })
    const { actions } = run({
      catalogFields: [selectField],
      existingRows: [
        row({ type: 'SINGLE_SELECT', options: { isCustom: true, options: [{ value: 'z' }] } }),
      ],
    })
    expect(actions).toHaveLength(1)
    expect(actions[0]!.changes?.options).toMatchObject({
      isCustom: true,
      options: [{ value: 'a', label: 'A' }],
    })
  })

  it('errors (no action) on a type change — parks the sync', () => {
    const { actions, errors } = run({
      catalogFields: [field({ type: 'NUMBER' })],
      existingRows: [row({ type: 'TEXT' })],
    })
    expect(actions).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]!.appFieldKey).toBe('customerId')
    expect(errors[0]!.reason).toContain('type changed')
  })

  it('hides an orphaned row that holds values', () => {
    const { actions } = run({
      catalogFields: [],
      existingRows: [row({ id: 'cf_old', appFieldKey: 'removedField' })],
      hasValues: HAS_VALUES,
    })
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: 'orphan-hide', existingFieldId: 'cf_old' })
  })

  it('deletes an orphaned row with no values', () => {
    const { actions } = run({
      catalogFields: [],
      existingRows: [row({ id: 'cf_old', appFieldKey: 'removedField' })],
      hasValues: NO_VALUES,
    })
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: 'orphan-delete', existingFieldId: 'cf_old' })
  })

  it('does not re-hide an already-hidden orphan with values', () => {
    const { actions } = run({
      catalogFields: [],
      existingRows: [row({ id: 'cf_old', appFieldKey: 'removedField', isHidden: true })],
      hasValues: HAS_VALUES,
    })
    expect(actions).toEqual([])
  })

  it('takes no action and raises no error for a RELATIONSHIP field', () => {
    const { actions, errors } = run({
      catalogFields: [field({ type: 'RELATIONSHIP', appFieldKey: 'orders' })],
    })
    expect(actions).toEqual([])
    expect(errors).toEqual([])
  })
})
