// packages/lib/src/data-connectors/sync-state.ts
//
// The per-cell sync state a contributing connector binding puts on a record
// (plans/money/tasks/40-per-field-sync-pin.md D2). Pure and browser-safe: the
// sink's drift query, the field-value read path and the badge all decide
// through the same two functions, so "will X overwrite this on the next sync"
// can never be answered differently in two places.

import type { FieldMergeStrategy, IdentityRole } from '../write-policy/types'

/** The subset of a mapping's `FieldMapping` entry the state rule reads. */
export interface SyncBinding {
  targetFieldRef: string | null
  mergeStrategy?: FieldMergeStrategy
  identityRole?: IdentityRole
}

/** The subset of a `CustomField` the state rule reads. */
export interface SyncFieldShape {
  options?: { multi?: boolean } | null
}

/**
 * One live `DataConnectorItem` on a record, as the read path loads it
 * (`item-bindings.ts`). A record bound by two mappings of one connector has
 * two entries with the same `connectorId`; the rule unions them.
 */
export interface InstanceConnectorBinding {
  connectorId: string
  /** Raw `targetFieldRef`s the connector writes on this record. */
  managedFields: string[]
  /** Concrete `CustomField` ids paused on this record. */
  pinnedFields: string[]
  /** The mapping's field bindings. */
  bindings: SyncBinding[]
}

export type CellSyncState = 'synced' | 'edited' | 'paused'

/** What the wire carries per cell; `null` when the field is not bound on the record. */
export interface CellSyncInfo {
  connectorId: string
  state: CellSyncState
  /**
   * Whether the connector re-asserts its value over a hand edit on the next run
   * (an `overwrite` binding). `false` on `fill_blank` and the other conservative
   * strategies, where "resume" restores nothing until the cell is cleared.
   */
  willOverwrite: boolean
}

/** `<defId>:<fieldId>` names the field; a bare id (legacy rows, tests) is accepted too. */
export function refNamesField(ref: string, fieldId: string): boolean {
  return ref === fieldId || ref.endsWith(`:${fieldId}`)
}

/**
 * Whether a binding would re-assert the source value over a hand edit: the
 * strategy is `overwrite` (or unset, which defaults to it), the field is not
 * identity-flagged (the sink forces those to fill-blank), and the field is not
 * multi-value (row-level semantics never re-assert another row). This is the
 * exact set `computeDriftedInstances` heals, so `edited` on the badge means
 * what it says.
 */
export function wouldHealField(
  binding: SyncBinding,
  field: SyncFieldShape | null | undefined
): boolean {
  if (binding.identityRole?.kind === 'externalId') return false
  const strategy = binding.mergeStrategy ?? 'overwrite'
  if (strategy !== 'overwrite') return false
  if (field?.options?.multi === true) return false
  return true
}

/**
 * Collapse a cell's marker and the record's live bindings to one state, in
 * this order: `paused` (an item pins the field; wins over any marker and names
 * the pinning connector), `synced` (a row of the cell carries the marker),
 * `edited` (no marker, but a binding would heal the cell), else `null`.
 */
export function resolveCellSyncState(input: {
  fieldId: string
  field: SyncFieldShape | null | undefined
  markerConnectorId: string | null
  bindings: readonly InstanceConnectorBinding[]
}): CellSyncInfo | null {
  const { fieldId, field, markerConnectorId, bindings } = input
  if (bindings.length === 0 && !markerConnectorId) return null

  const bindingFor = (item: InstanceConnectorBinding): SyncBinding | undefined =>
    item.bindings.find((b) => b.targetFieldRef != null && refNamesField(b.targetFieldRef, fieldId))
  const healsOn = (connectorId: string): boolean =>
    bindings.some((item) => {
      if (item.connectorId !== connectorId) return false
      const binding = bindingFor(item)
      return !!binding && wouldHealField(binding, field)
    })

  const pinned = bindings.find((item) => item.pinnedFields.includes(fieldId))
  if (pinned) {
    return {
      connectorId: pinned.connectorId,
      state: 'paused',
      willOverwrite: healsOn(pinned.connectorId),
    }
  }

  if (markerConnectorId) {
    return {
      connectorId: markerConnectorId,
      state: 'synced',
      willOverwrite: healsOn(markerConnectorId),
    }
  }

  const edited = bindings.find((item) => {
    if (!item.managedFields.some((ref) => refNamesField(ref, fieldId))) return false
    const binding = bindingFor(item)
    return !!binding && wouldHealField(binding, field)
  })
  if (edited) return { connectorId: edited.connectorId, state: 'edited', willOverwrite: true }

  return null
}
