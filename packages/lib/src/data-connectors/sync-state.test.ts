// packages/lib/src/data-connectors/sync-state.test.ts
// The pure per-cell sync-state rule (plans/money/tasks/40 D2). `wouldHealField`
// is the set `computeDriftedInstances` re-asserts and what the badge calls
// `edited`; `resolveCellSyncState` orders paused > synced > edited > null.

import { describe, expect, it } from 'vitest'
import {
  type InstanceConnectorBinding,
  refNamesField,
  resolveCellSyncState,
  type SyncBinding,
  wouldHealField,
} from './sync-state'

const FIELD = 'fld_desc'
const REF = `def_product:${FIELD}`
const OTHER_FIELD = 'fld_title'

const scalar = { options: {} }
const multi = { options: { multi: true } }

function binding(over: Partial<SyncBinding> = {}): SyncBinding {
  return { targetFieldRef: REF, ...over }
}

function item(over: Partial<InstanceConnectorBinding> = {}): InstanceConnectorBinding {
  return {
    connectorId: 'dc_shopify',
    managedFields: [REF],
    pinnedFields: [],
    bindings: [binding()],
    ...over,
  }
}

describe('refNamesField', () => {
  it('matches the `<defId>:<fieldId>` form and a bare id', () => {
    expect(refNamesField(REF, FIELD)).toBe(true)
    expect(refNamesField(FIELD, FIELD)).toBe(true)
    expect(refNamesField(`def_product:${OTHER_FIELD}`, FIELD)).toBe(false)
    // A suffix that is not a whole segment must not match.
    expect(refNamesField(`def_product:x${FIELD}`, FIELD)).toBe(false)
  })
})

describe('wouldHealField', () => {
  it('overwrite heals', () => {
    expect(wouldHealField(binding({ mergeStrategy: 'overwrite' }), scalar)).toBe(true)
  })

  it('an unset strategy defaults to overwrite and heals', () => {
    expect(wouldHealField(binding(), scalar)).toBe(true)
    expect(wouldHealField(binding(), null)).toBe(true)
    expect(wouldHealField(binding(), undefined)).toBe(true)
  })

  it('fill_blank never re-asserts', () => {
    expect(wouldHealField(binding({ mergeStrategy: 'fill_blank' }), scalar)).toBe(false)
  })

  it('an identity-flagged binding never re-asserts, whatever its strategy says', () => {
    expect(
      wouldHealField(
        binding({ mergeStrategy: 'overwrite', identityRole: { kind: 'externalId' } }),
        scalar
      )
    ).toBe(false)
  })

  it('a multi-value field is row-scoped out of healing', () => {
    expect(wouldHealField(binding({ mergeStrategy: 'overwrite' }), multi)).toBe(false)
  })

  it('ignore and the other conservative strategies do not heal', () => {
    expect(wouldHealField(binding({ mergeStrategy: 'ignore' }), scalar)).toBe(false)
    expect(wouldHealField(binding({ mergeStrategy: 'connector_owned_only' }), scalar)).toBe(false)
    expect(wouldHealField(binding({ mergeStrategy: 'manual_review' }), scalar)).toBe(false)
  })
})

describe('resolveCellSyncState', () => {
  it('returns null for empty inputs', () => {
    expect(
      resolveCellSyncState({ fieldId: FIELD, field: scalar, markerConnectorId: null, bindings: [] })
    ).toBeNull()
  })

  it('paused beats a foreign marker and names the pinning connector', () => {
    const state = resolveCellSyncState({
      fieldId: FIELD,
      field: scalar,
      markerConnectorId: 'dc_other',
      bindings: [item({ pinnedFields: [FIELD] })],
    })
    expect(state).toEqual({ connectorId: 'dc_shopify', state: 'paused', willOverwrite: true })
  })

  it('paused on a fill_blank binding reports willOverwrite false, so resume copy can say so', () => {
    const state = resolveCellSyncState({
      fieldId: FIELD,
      field: scalar,
      markerConnectorId: null,
      bindings: [
        item({ pinnedFields: [FIELD], bindings: [binding({ mergeStrategy: 'fill_blank' })] }),
      ],
    })
    expect(state).toEqual({ connectorId: 'dc_shopify', state: 'paused', willOverwrite: false })
  })

  it('a marker with no pin is synced', () => {
    const state = resolveCellSyncState({
      fieldId: FIELD,
      field: scalar,
      markerConnectorId: 'dc_shopify',
      bindings: [item()],
    })
    expect(state).toEqual({ connectorId: 'dc_shopify', state: 'synced', willOverwrite: true })
  })

  it('a marker alone (no item loaded) is still synced', () => {
    const state = resolveCellSyncState({
      fieldId: FIELD,
      field: scalar,
      markerConnectorId: 'dc_shopify',
      bindings: [],
    })
    expect(state).toEqual({ connectorId: 'dc_shopify', state: 'synced', willOverwrite: false })
  })

  it('no marker on a healing binding is edited', () => {
    const state = resolveCellSyncState({
      fieldId: FIELD,
      field: scalar,
      markerConnectorId: null,
      bindings: [item()],
    })
    expect(state).toEqual({ connectorId: 'dc_shopify', state: 'edited', willOverwrite: true })
  })

  it('an identity field with no marker is null, not edited', () => {
    const state = resolveCellSyncState({
      fieldId: FIELD,
      field: scalar,
      markerConnectorId: null,
      bindings: [item({ bindings: [binding({ identityRole: { kind: 'externalId' } })] })],
    })
    expect(state).toBeNull()
  })

  it('a fill_blank field with no marker is null, not edited', () => {
    const state = resolveCellSyncState({
      fieldId: FIELD,
      field: scalar,
      markerConnectorId: null,
      bindings: [item({ bindings: [binding({ mergeStrategy: 'fill_blank' })] })],
    })
    expect(state).toBeNull()
  })

  it('a multi field with no marker is null, not edited', () => {
    const state = resolveCellSyncState({
      fieldId: FIELD,
      field: multi,
      markerConnectorId: null,
      bindings: [item()],
    })
    expect(state).toBeNull()
  })

  it('a field the item does not manage on this record is null even with a healing binding', () => {
    const state = resolveCellSyncState({
      fieldId: FIELD,
      field: scalar,
      markerConnectorId: null,
      bindings: [item({ managedFields: [`def_product:${OTHER_FIELD}`] })],
    })
    expect(state).toBeNull()
  })

  it('two items of one connector on one instance union their lists', () => {
    // The customer-stream item pins the field; the order.customer item only manages it.
    const pinnedOnOne = resolveCellSyncState({
      fieldId: FIELD,
      field: scalar,
      markerConnectorId: 'dc_shopify',
      bindings: [item({ pinnedFields: [] }), item({ pinnedFields: [FIELD], managedFields: [] })],
    })
    expect(pinnedOnOne?.state).toBe('paused')

    // Only the second item manages the field, and neither pins it: edited.
    const managedOnOne = resolveCellSyncState({
      fieldId: FIELD,
      field: scalar,
      markerConnectorId: null,
      bindings: [item({ managedFields: [] }), item()],
    })
    expect(managedOnOne).toEqual({
      connectorId: 'dc_shopify',
      state: 'edited',
      willOverwrite: true,
    })
  })
})
