// packages/lib/src/apps/installations/app-field-provisioning.test.ts
// Pure-diff coverage for the app-field reconciler (create / drift / orphan) and its
// universe partition. No DB harness — both functions under test are DB-free by
// construction.

import type { CatalogAppField } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  computeAppFieldReconcileActions,
  type ExistingAppFieldRow,
  isManifestAppFieldRow,
} from './app-field-provisioning'

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

// The universe partition guarding the orphan sweep: template-installed owned-def
// columns share `(appInstallationId, appFieldKey)` with manifest app fields but must
// never enter the reconcile diff — the sweep would eat them (their keys are absent
// from `catalog.fields` by construction). Live repro: connector v471uzaw8ard1naqelld1krr.
describe('isManifestAppFieldRow', () => {
  const APP_OWNED_DEF_IDS = new Set(['def_shopify_orders'])

  it('keeps a manifest app field (no connector stamp, kind-resolved org def)', () => {
    expect(
      isManifestAppFieldRow(
        { dataConnectorId: null, entityDefinitionId: 'def_contact' },
        APP_OWNED_DEF_IDS
      )
    ).toBe(true)
  })

  it('excludes a template-installed owned-def column (dataConnectorId stamped)', () => {
    expect(
      isManifestAppFieldRow(
        { dataConnectorId: 'dc_1', entityDefinitionId: 'def_shopify_orders' },
        APP_OWNED_DEF_IDS
      )
    ).toBe(false)
  })

  it('excludes a connector column on a shared def (dataConnectorId stamped, org def)', () => {
    expect(
      isManifestAppFieldRow(
        { dataConnectorId: 'dc_1', entityDefinitionId: 'def_contact' },
        APP_OWNED_DEF_IDS
      )
    ).toBe(false)
  })

  it('excludes a keep-deleted owned-def column (FK set-nulled, def still app-owned)', () => {
    // deleteConnector with behavior keep/archive nulls `dataConnectorId` while
    // `appInstallationId` + `appFieldKey` survive — the row must still be excluded.
    expect(
      isManifestAppFieldRow(
        { dataConnectorId: null, entityDefinitionId: 'def_shopify_orders' },
        APP_OWNED_DEF_IDS
      )
    ).toBe(false)
  })

  it('keeps a defless row (defensive — manifest universe by elimination)', () => {
    expect(
      isManifestAppFieldRow({ dataConnectorId: null, entityDefinitionId: null }, APP_OWNED_DEF_IDS)
    ).toBe(true)
  })
})
