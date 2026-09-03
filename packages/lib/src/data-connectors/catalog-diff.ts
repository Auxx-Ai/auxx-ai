// packages/lib/src/data-connectors/catalog-diff.ts
// Three-way diff behind "Update available" (plans/money/tasks/41-connector-catalog-update.md
// section 5.2): what the APP changed between the catalog the connector was seeded from
// (`derivedOld`) and the installation's current catalog (`derivedNew`), applied against
// the rows the merchant actually has (`persisted`). A row the merchant edited that the app
// also changed is a conflict (D3); a merchant edit the app did not touch is never listed.
// Impact per entry comes from the same classifier the interactive mutations run
// (`edit-impact.ts`), computed against the persisted row exactly as `applyConnectorCatalogUpdate`
// will patch it. Pure: no DB, no cache.

import {
  type BindingShape,
  bindingKey,
  type DerivedMapping,
  type DerivedStream,
  hashMappingShape,
  hashStreamShape,
  mappingKey,
  type PersistedMapping,
  type PersistedStream,
  type StreamShape,
  stableStringify,
} from './catalog-shape'
import {
  classifyMappingChange,
  classifyStreamRequestChange,
  type StructuralImpact,
} from './edit-impact'
import type { FieldMapping, FieldMergeStrategy, StreamRequestConfig, SyncMode } from './types'

// ── Public entry shape ────────────────────────────────────────────────────────

/** What a binding does, in the words the dialog prints. */
export interface BindingSummary {
  /** The source path the value comes from (null for a connection-metadata write). */
  sourcePath: string | null
  role: 'match' | 'match-exclusive' | 'externalId' | null
  mergeStrategy: FieldMergeStrategy
  connectionMetaKey: string | null
}

export type StreamShapeField = 'syncMode' | 'webhookTrigger' | 'sourceSchema'

export type CatalogChange =
  | { kind: 'stream'; op: 'add'; streamKey: string; mappingCount: number }
  | { kind: 'stream'; op: 'remove'; streamKey: string }
  | {
      kind: 'stream'
      op: 'change'
      streamKey: string
      fields: StreamShapeField[]
      before: { syncMode: SyncMode }
      after: { syncMode: SyncMode }
    }
  | {
      kind: 'mapping'
      op: 'add' | 'remove'
      streamKey: string
      mappingKey: string
      /** Target label: the entity kind or owned entity key. */
      target: string
      rootPath: string
    }
  | {
      kind: 'mapping'
      op: 'change'
      streamKey: string
      mappingKey: string
      target: string
      rootPath: string
      fields: Array<'relationshipFieldKey'>
    }
  | {
      kind: 'binding'
      op: 'add' | 'remove' | 'change'
      streamKey: string
      mappingKey: string
      /** The mapping's target label (the entity kind or owned entity key). */
      mappingTarget: string
      /** Normalized target ref (`@app:<slug>:<key>`, `<defId>:<fieldId>`, or `anchor:...`). */
      target: string
      /** Human label for the target field (system attribute / app field key). */
      targetLabel: string
      before: BindingSummary | null
      after: BindingSummary | null
    }

export interface CatalogDiffEntry {
  /** Stable id the client echoes back to `applyConnectorCatalogUpdate`. */
  id: string
  change: CatalogChange
  impact: StructuralImpact
  /** The merchant edited what this change touches; the dialog defaults to keep-mine. */
  conflict: boolean
}

/** How `applyConnectorCatalogUpdate` realizes one entry, keyed by entry id. */
export type CatalogApplyStep =
  | { kind: 'stream-add'; derived: DerivedStream }
  | {
      kind: 'stream-change'
      persisted: PersistedStream
      derived: DerivedStream
      fields: StreamShapeField[]
    }
  | { kind: 'stream-remove'; persisted: PersistedStream }
  | {
      kind: 'mapping-add'
      persistedStream: PersistedStream
      derivedStream: DerivedStream
      derived: DerivedMapping
    }
  | { kind: 'mapping-change'; persisted: PersistedMapping; derived: DerivedMapping }
  | { kind: 'mapping-remove'; persistedStream: PersistedStream; persisted: PersistedMapping }
  | {
      kind: 'binding'
      op: 'add' | 'remove' | 'change'
      persisted: PersistedMapping
      derived: DerivedMapping
      bindingKey: string
    }

export interface ConnectorCatalogDiff {
  entries: CatalogDiffEntry[]
  steps: Map<string, CatalogApplyStep>
}

export interface DiffOptions {
  /** Human label for a normalized binding target (defaults to the ref itself). */
  labelTarget?: (target: string | null) => string
}

// ── Helpers shared with apply ─────────────────────────────────────────────────

/**
 * The `requestConfig` a stream row gets when the catalog's webhook steering changes:
 * every other key is preserved, `webhookTrigger` is replaced or dropped.
 */
export function nextStreamRequestConfig(
  row: PersistedStream['row'],
  derived: StreamShape
): StreamRequestConfig {
  const next = { ...(row.requestConfig ?? {}) } as StreamRequestConfig
  if (derived.webhookTrigger) next.webhookTrigger = derived.webhookTrigger
  else delete next.webhookTrigger
  return next
}

/**
 * A mapping row's `fieldMappings` after one binding op. `add` appends the derived entry
 * (its fresh id is fine, nothing referenced it yet); `change` keeps the persisted entry's
 * id and takes everything else from the derived entry; `remove` drops the persisted one.
 */
export function applyBindingOp(
  fieldMappings: readonly FieldMapping[],
  op: 'add' | 'remove' | 'change',
  persisted: FieldMapping | undefined,
  derived: FieldMapping | undefined
): FieldMapping[] {
  if (op === 'add') return derived ? [...fieldMappings, derived] : [...fieldMappings]
  if (!persisted) return [...fieldMappings]
  if (op === 'remove') return fieldMappings.filter((fm) => fm.id !== persisted.id)
  return fieldMappings.map((fm) =>
    fm.id === persisted.id && derived ? { ...derived, id: persisted.id } : fm
  )
}

/** Summarize a binding for the dialog. */
export function summarizeBinding(binding: BindingShape): BindingSummary {
  const role = binding.identityRole
  return {
    sourcePath:
      binding.connectionMetaKey != null
        ? null
        : (Object.keys(binding.sourceFields)[0] ?? binding.expression.replace(/^\{|\}$/g, '')),
    role:
      role?.kind === 'externalId'
        ? 'externalId'
        : role?.kind === 'match'
          ? role.exclusive
            ? 'match-exclusive'
            : 'match'
          : null,
    mergeStrategy: binding.mergeStrategy,
    connectionMetaKey: binding.connectionMetaKey,
  }
}

// ── The diff ──────────────────────────────────────────────────────────────────

function eq(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

const STREAM_FIELDS: StreamShapeField[] = ['syncMode', 'webhookTrigger', 'sourceSchema']

/**
 * Whether a persisted row still carries the app default it was seeded with, when no
 * old catalog is available to compare against. A row with no `catalogHash` and no old
 * catalog is unknowable, so it counts as edited: the merchant decides.
 */
function editedWithoutOld(currentHash: string, catalogHash: string | null): boolean {
  return catalogHash == null || currentHash !== catalogHash
}

/**
 * Persisted owned rows whose target could not be named (targetKey `?`) are paired with
 * the one derived mapping at the same parent + rootPath + targetMode, and their keys
 * (and their children's) rewritten so hashes and lookups line up.
 */
export function resolveWildcardKeys(
  persisted: PersistedStream,
  derived: DerivedStream
): PersistedMapping[] {
  const byRowId = new Map<string, PersistedMapping>()
  const parentFirst = [...persisted.mappings].sort(
    (a, b) => a.shape.key.split('>').length - b.shape.key.split('>').length
  )
  for (const pm of parentFirst) {
    const parentRow = pm.row.parentMappingId ? byRowId.get(pm.row.parentMappingId) : undefined
    const parentKey = parentRow ? parentRow.shape.key : pm.shape.parentKey
    let targetKey = pm.shape.targetKey
    let targetLabel = pm.shape.targetLabel
    if (targetKey === '?') {
      const candidates = derived.mappings.filter(
        (m) =>
          m.parentKey === parentKey &&
          m.rootPath === pm.shape.rootPath &&
          m.targetMode === pm.shape.targetMode
      )
      if (candidates.length === 1 && candidates[0]) {
        targetKey = candidates[0].targetKey
        targetLabel = candidates[0].targetLabel
      }
    }
    const resolved: PersistedMapping = {
      ...pm,
      shape: {
        ...pm.shape,
        parentKey,
        targetKey,
        targetLabel,
        key: mappingKey(parentKey, pm.shape.rootPath, pm.shape.targetMode, targetKey),
      },
    }
    byRowId.set(pm.row.id, resolved)
  }
  return persisted.mappings.map((pm) => byRowId.get(pm.row.id) ?? pm)
}

function bindingsByKey(bindings: readonly BindingShape[]): Map<string, BindingShape> {
  const out = new Map<string, BindingShape>()
  for (const b of bindings) if (!out.has(bindingKey(b))) out.set(bindingKey(b), b)
  return out
}

/**
 * Diff the persisted rows against the app's new catalog shape, using the seeding
 * catalog's shape (when available) to tell app changes from merchant edits. See the
 * file header for the rules; `steps` carries what apply needs per entry.
 */
export function diffConnectorCatalog(
  persisted: readonly PersistedStream[],
  derivedNew: readonly DerivedStream[],
  derivedOld: readonly DerivedStream[] | null,
  options: DiffOptions = {}
): ConnectorCatalogDiff {
  const labelTarget = options.labelTarget ?? ((t) => t ?? 'external id')
  const entries: CatalogDiffEntry[] = []
  const steps = new Map<string, CatalogApplyStep>()
  const push = (entry: CatalogDiffEntry, step: CatalogApplyStep) => {
    entries.push(entry)
    steps.set(entry.id, step)
  }

  const persistedByKey = new Map(persisted.map((s) => [s.shape.key, s]))
  const oldByKey = new Map((derivedOld ?? []).map((s) => [s.key, s]))
  const newByKey = new Map(derivedNew.map((s) => [s.key, s]))

  for (const N of derivedNew) {
    const P = persistedByKey.get(N.key)
    const O = oldByKey.get(N.key) ?? null

    if (!P) {
      push(
        {
          id: `stream:${N.key}`,
          change: { kind: 'stream', op: 'add', streamKey: N.key, mappingCount: N.mappings.length },
          impact: { level: 'cosmetic', reasons: ['stream-added'] },
          // The seeding catalog had it and the merchant removed it.
          conflict: O != null,
        },
        { kind: 'stream-add', derived: N }
      )
      continue
    }

    // Stream-level fields.
    const streamEdited = editedWithoutOld(hashStreamShape(P.shape), P.row.catalogHash)
    const changedFields: StreamShapeField[] = []
    let streamConflict = false
    for (const field of STREAM_FIELDS) {
      const appChanged = O ? !eq(O[field], N[field]) : !eq(P.shape[field], N[field])
      if (!appChanged || eq(P.shape[field], N[field])) continue
      changedFields.push(field)
      if (O ? !eq(P.shape[field], O[field]) : streamEdited) streamConflict = true
    }
    if (changedFields.length > 0) {
      const patch: { requestConfig?: StreamRequestConfig; syncMode?: SyncMode } = {}
      if (changedFields.includes('webhookTrigger')) {
        patch.requestConfig = nextStreamRequestConfig(P.row, N)
      }
      if (changedFields.includes('syncMode')) patch.syncMode = N.syncMode
      push(
        {
          id: `stream:${N.key}`,
          change: {
            kind: 'stream',
            op: 'change',
            streamKey: N.key,
            fields: changedFields,
            before: { syncMode: P.shape.syncMode },
            after: { syncMode: N.syncMode },
          },
          impact: classifyStreamRequestChange(P.row, patch),
          conflict: streamConflict,
        },
        { kind: 'stream-change', persisted: P, derived: N, fields: changedFields }
      )
    }

    // Mappings.
    const resolved = resolveWildcardKeys(P, N)
    const pByKey = new Map(resolved.map((pm) => [pm.shape.key, pm]))
    const nByKey = new Map(N.mappings.map((m) => [m.key, m]))
    const oByKey = O ? new Map(O.mappings.map((m) => [m.key, m])) : null

    for (const M of N.mappings) {
      const PM = pByKey.get(M.key)
      const OM = oByKey?.get(M.key) ?? null
      if (!PM) {
        push(
          {
            id: `mapping:${N.key}:${M.key}`,
            change: {
              kind: 'mapping',
              op: 'add',
              streamKey: N.key,
              mappingKey: M.key,
              target: M.targetLabel,
              rootPath: M.rootPath,
            },
            // A new mapping on a synced connector needs a re-projection to fill in.
            impact: { level: 'rebackfill', reasons: ['mapping-added'] },
            conflict: OM != null,
          },
          { kind: 'mapping-add', persistedStream: P, derivedStream: N, derived: M }
        )
        continue
      }

      const rowEdited = editedWithoutOld(hashMappingShape(PM.shape), PM.row.catalogHash)

      // The relationship edge (cosmetic per the classifier, but part of the app default).
      const edgeAppChanged = oByKey
        ? OM != null && !eq(OM.relationshipFieldKey, M.relationshipFieldKey)
        : !eq(PM.shape.relationshipFieldKey, M.relationshipFieldKey)
      if (edgeAppChanged && !eq(PM.shape.relationshipFieldKey, M.relationshipFieldKey)) {
        push(
          {
            id: `mapping:${N.key}:${M.key}`,
            change: {
              kind: 'mapping',
              op: 'change',
              streamKey: N.key,
              mappingKey: M.key,
              target: M.targetLabel,
              rootPath: M.rootPath,
              fields: ['relationshipFieldKey'],
            },
            impact: classifyMappingChange(PM.row, {
              relationshipFieldKey: M.storedRelationshipFieldKey,
            }),
            conflict: OM ? !eq(PM.shape.relationshipFieldKey, OM.relationshipFieldKey) : rowEdited,
          },
          { kind: 'mapping-change', persisted: PM, derived: M }
        )
      }

      // Bindings.
      const pB = bindingsByKey(PM.shape.bindings)
      const nB = bindingsByKey(M.bindings)
      const oB = OM ? bindingsByKey(OM.bindings) : null
      const pushBinding = (
        op: 'add' | 'remove' | 'change',
        key: string,
        pb: BindingShape | undefined,
        nb: BindingShape | undefined,
        conflict: boolean
      ) => {
        const next = applyBindingOp(
          PM.row.fieldMappings ?? [],
          op,
          PM.fieldMappingByBindingKey[key],
          M.fieldMappingByBindingKey[key]
        )
        const target = pb?.target ?? nb?.target ?? null
        push(
          {
            id: `binding:${N.key}:${M.key}#${key}`,
            change: {
              kind: 'binding',
              op,
              streamKey: N.key,
              mappingKey: M.key,
              mappingTarget: M.targetLabel,
              target: key,
              targetLabel: labelTarget(target),
              before: pb ? summarizeBinding(pb) : null,
              after: nb ? summarizeBinding(nb) : null,
            },
            impact: classifyMappingChange(PM.row, { fieldMappings: next }),
            conflict,
          },
          { kind: 'binding', op, persisted: PM, derived: M, bindingKey: key }
        )
      }

      for (const [key, nb] of nB) {
        const pb = pB.get(key)
        if (pb && eq(pb, nb)) continue // already what the app wants
        if (oB) {
          const ob = oB.get(key)
          if (ob && eq(ob, nb)) continue // the app did not change it; a merchant edit stays
          // ob present: the app changed it; conflict unless the row still holds the old
          // default (or the merchant removed it). ob absent: a new app binding; conflict
          // only when the merchant already bound this target by hand.
          const conflict = ob ? (pb ? !eq(pb, ob) : true) : pb != null
          pushBinding(pb ? 'change' : 'add', key, pb, nb, conflict)
        } else {
          pushBinding(pb ? 'change' : 'add', key, pb, nb, rowEdited)
        }
      }
      for (const [key, pb] of pB) {
        if (nB.has(key)) continue
        if (oB) {
          const ob = oB.get(key)
          if (!ob) continue // merchant-added binding the app never had
          pushBinding('remove', key, pb, undefined, !eq(pb, ob))
        } else if (PM.row.catalogHash != null) {
          pushBinding('remove', key, pb, undefined, rowEdited)
        }
        // No old catalog and no hash: cannot tell an app removal from a merchant add; skip.
      }
    }

    // Mappings the app dropped.
    for (const PM of resolved) {
      if (nByKey.has(PM.shape.key)) continue
      let conflict: boolean
      if (oByKey) {
        const OM = oByKey.get(PM.shape.key)
        if (!OM) continue // merchant-added mapping
        conflict = hashMappingShape(PM.shape) !== hashMappingShape(OM)
      } else {
        if (PM.row.catalogHash == null) continue
        conflict = editedWithoutOld(hashMappingShape(PM.shape), PM.row.catalogHash)
      }
      push(
        {
          id: `mapping:${N.key}:${PM.shape.key}`,
          change: {
            kind: 'mapping',
            op: 'remove',
            streamKey: N.key,
            mappingKey: PM.shape.key,
            target: PM.shape.targetLabel,
            rootPath: PM.shape.rootPath,
          },
          impact: { level: 'cosmetic', reasons: ['mapping-removed'] },
          conflict,
        },
        { kind: 'mapping-remove', persistedStream: P, persisted: PM }
      )
    }
  }

  // Streams the app dropped.
  for (const P of persisted) {
    if (newByKey.has(P.shape.key)) continue
    let conflict: boolean
    if (derivedOld) {
      const O = oldByKey.get(P.shape.key)
      if (!O) continue // merchant-added stream
      const oByKey = new Map(O.mappings.map((m) => [m.key, m]))
      conflict =
        hashStreamShape(P.shape) !== hashStreamShape(O) ||
        P.mappings.some((pm) => {
          const OM = oByKey.get(pm.shape.key)
          return !OM || hashMappingShape(pm.shape) !== hashMappingShape(OM)
        })
    } else {
      if (P.row.catalogHash == null) continue
      conflict =
        editedWithoutOld(hashStreamShape(P.shape), P.row.catalogHash) ||
        P.mappings.some((pm) => editedWithoutOld(hashMappingShape(pm.shape), pm.row.catalogHash))
    }
    push(
      {
        id: `stream:${P.shape.key}`,
        change: { kind: 'stream', op: 'remove', streamKey: P.shape.key },
        impact: { level: 'cosmetic', reasons: ['stream-removed'] },
        conflict,
      },
      { kind: 'stream-remove', persisted: P }
    )
  }

  return { entries, steps }
}
