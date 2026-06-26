// apps/web/src/components/data-connectors/lib/connector-commit-diff.ts

import type { FieldMapping, UiRequestConfig } from '../hooks/use-stream-mutations'
import {
  type ConnectorDraft,
  type DraftMapping,
  isTempId,
  type SchemaSource,
  type SyncBehavior,
  type SyncMode,
} from '../stores/connector-draft-store'

/**
 * The pure commit diff (plan §5). Given the last-committed `snapshot` and the current
 * `draft`, produce the minimal, ORDERED set of server mutations. Pure + side-effect
 * free so the ordering (create chains, delete cascade, temp-id resolution) is unit
 * tested against fixtures before any UI rides it (plan §R1). The executor
 * (`use-connector-commit`) walks this plan and threads temp-id → server-id.
 */

/** Connector-level `update` patch — only the fields that changed. */
export interface ConnectorUpdatePatch {
  name?: string
  config?: Record<string, unknown>
  syncBehavior?: SyncBehavior
  scheduleConfig?: Record<string, unknown> | null
}

/** A new mapping to create (`addMapping`). `parentMappingId` may be a temp id. */
export interface MappingCreate {
  streamId: string
  tempId: string
  parentMappingId: string | null
  rootPath: string
  relationshipFieldKey: string | null
  linkMode: 'upsert' | 'reference'
  targetMode: 'owned' | 'contributing'
  entityDefinitionId: string
  orphanBehavior: 'archive' | 'mark_deleted' | 'ignore'
  fieldMappings: FieldMapping[]
}

/** The changed subset of a mapping (`updateMapping`). */
export interface MappingUpdatePatch {
  rootPath?: string
  relationshipFieldKey?: string | null
  linkMode?: 'upsert' | 'reference'
  targetMode?: 'owned' | 'contributing'
  entityDefinitionId?: string | null
  orphanBehavior?: 'archive' | 'mark_deleted' | 'ignore'
  fieldMappings?: FieldMapping[]
}

export interface CommitPlan {
  connectorUpdate: ConnectorUpdatePatch | null
  streamRenames: Array<{ streamId: string; streamKey: string }>
  streamRequestConfigs: Array<{
    streamId: string
    requestConfig: UiRequestConfig
    syncMode?: SyncMode
  }>
  streamSchemas: Array<{
    streamId: string
    sourceSchema: Record<string, unknown>
    schemaSource: SchemaSource
  }>
  mappingCreates: MappingCreate[]
  mappingUpdates: Array<{ mappingId: string; patch: MappingUpdatePatch }>
  mappingDeletes: Array<{ mappingId: string }>
  /** Whether the commit warrants a single `getStatus` nudge (resync-affecting change). */
  structural: boolean
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The mapping fields whose change is "structural" (resync-affecting), excluding pure bindings. */
const STRUCTURAL_FIELDS: Array<keyof MappingUpdatePatch> = [
  'rootPath',
  'relationshipFieldKey',
  'linkMode',
  'targetMode',
  'entityDefinitionId',
]

/** Diff one mapping (real id, not deleted) against its snapshot row → changed subset. */
function diffMapping(prev: DraftMapping, next: DraftMapping): MappingUpdatePatch | null {
  const patch: MappingUpdatePatch = {}
  if (prev.rootPath !== next.rootPath) patch.rootPath = next.rootPath
  if (prev.relationshipFieldKey !== next.relationshipFieldKey)
    patch.relationshipFieldKey = next.relationshipFieldKey
  if (prev.linkMode !== next.linkMode) patch.linkMode = next.linkMode
  if (prev.targetMode !== next.targetMode) patch.targetMode = next.targetMode
  if (prev.entityDefinitionId !== next.entityDefinitionId)
    patch.entityDefinitionId = next.entityDefinitionId
  if (prev.orphanBehavior !== next.orphanBehavior) patch.orphanBehavior = next.orphanBehavior
  if (!eq(prev.fieldMappings, next.fieldMappings)) patch.fieldMappings = next.fieldMappings
  return Object.keys(patch).length > 0 ? patch : null
}

/** Order creates parents-before-children so a temp parent commits before its temp child (I2). */
function orderCreates(creates: MappingCreate[]): MappingCreate[] {
  const tempIds = new Set(creates.map((c) => c.tempId))
  const emitted = new Set<string>()
  const ordered: MappingCreate[] = []
  let remaining = creates
  while (remaining.length > 0) {
    const ready = remaining.filter(
      (c) =>
        c.parentMappingId === null ||
        !tempIds.has(c.parentMappingId) ||
        emitted.has(c.parentMappingId)
    )
    if (ready.length === 0) {
      // Defensive: a cycle/orphan can't happen from fan-out (parent added first), but
      // never drop rows — emit the remainder in array order.
      ordered.push(...remaining)
      break
    }
    for (const c of ready) {
      ordered.push(c)
      emitted.add(c.tempId)
    }
    remaining = remaining.filter((c) => !emitted.has(c.tempId))
  }
  return ordered
}

/** Diff a single stream's mappings into creates / updates / deletes. */
function diffStreamMappings(
  streamId: string,
  prev: DraftMapping[],
  next: DraftMapping[]
): {
  creates: MappingCreate[]
  updates: Array<{ mappingId: string; patch: MappingUpdatePatch }>
  deletes: Array<{ mappingId: string }>
  structural: boolean
} {
  const prevById = new Map(prev.map((m) => [m.id, m]))
  const creates: MappingCreate[] = []
  const updates: Array<{ mappingId: string; patch: MappingUpdatePatch }> = []
  let structural = false

  // The set of real ids the draft tombstoned, so we only emit subtree-root deletes.
  const deletedIds = new Set(next.filter((m) => m._deleted && !isTempId(m.id)).map((m) => m.id))

  for (const m of next) {
    if (m._deleted) continue
    if (isTempId(m.id)) {
      // A new row. Untargeted creates (no def) can't persist — there's nowhere to land;
      // skip them (an incomplete draft row), don't fail the commit.
      if (!m.entityDefinitionId) continue
      creates.push({
        streamId,
        tempId: m.id,
        parentMappingId: m.parentMappingId,
        rootPath: m.rootPath,
        relationshipFieldKey: m.relationshipFieldKey,
        linkMode: m.linkMode,
        targetMode: m.targetMode,
        entityDefinitionId: m.entityDefinitionId,
        orphanBehavior: m.orphanBehavior,
        fieldMappings: m.fieldMappings,
      })
      structural = true
      continue
    }
    const before = prevById.get(m.id)
    if (!before) continue // a real id with no snapshot row — shouldn't happen; ignore
    const patch = diffMapping(before, m)
    if (patch) {
      updates.push({ mappingId: m.id, patch })
      if (STRUCTURAL_FIELDS.some((f) => f in patch)) structural = true
    }
  }

  // Deletes — only subtree roots; the server cascades children via the FK (#975, §5.2).
  const deletes: Array<{ mappingId: string }> = []
  for (const m of next) {
    if (!m._deleted || isTempId(m.id)) continue
    const parentDeleted = m.parentMappingId != null && deletedIds.has(m.parentMappingId)
    if (!parentDeleted) deletes.push({ mappingId: m.id })
  }
  if (deletes.length > 0) structural = true

  return { creates, updates, deletes, structural }
}

/** Build the ordered commit plan for the whole connector. */
export function diffConnectorDraft(snapshot: ConnectorDraft, draft: ConnectorDraft): CommitPlan {
  // ── connector-level ──
  const connectorUpdate: ConnectorUpdatePatch = {}
  if (snapshot.name !== draft.name) connectorUpdate.name = draft.name
  if (!eq(snapshot.config, draft.config)) connectorUpdate.config = draft.config
  if (snapshot.syncBehavior !== draft.syncBehavior)
    connectorUpdate.syncBehavior = draft.syncBehavior
  if (!eq(snapshot.scheduleConfig, draft.scheduleConfig))
    connectorUpdate.scheduleConfig = draft.scheduleConfig
  const hasConnectorUpdate = Object.keys(connectorUpdate).length > 0
  const scheduleChanged = 'syncBehavior' in connectorUpdate || 'scheduleConfig' in connectorUpdate

  // ── per-stream ──
  const prevStreams = new Map(snapshot.streams.map((s) => [s.id, s]))
  const streamRenames: CommitPlan['streamRenames'] = []
  const streamRequestConfigs: CommitPlan['streamRequestConfigs'] = []
  const streamSchemas: CommitPlan['streamSchemas'] = []
  const mappingCreates: MappingCreate[] = []
  const mappingUpdates: CommitPlan['mappingUpdates'] = []
  const mappingDeletes: CommitPlan['mappingDeletes'] = []
  let structural = scheduleChanged

  for (const stream of draft.streams) {
    if (isTempId(stream.id)) continue // whole-stream creates aren't editor-driven in v1
    const prev = prevStreams.get(stream.id)
    if (!prev) continue

    if (prev.streamKey !== stream.streamKey)
      streamRenames.push({ streamId: stream.id, streamKey: stream.streamKey })

    const requestChanged = !eq(prev.requestConfig, stream.requestConfig)
    const syncModeChanged = prev.syncMode !== stream.syncMode
    if (requestChanged || syncModeChanged) {
      streamRequestConfigs.push({
        streamId: stream.id,
        requestConfig: stream.requestConfig,
        ...(syncModeChanged ? { syncMode: stream.syncMode } : {}),
      })
      structural = true
    }

    if (!eq(prev.sourceSchema, stream.sourceSchema) && stream.sourceSchema && stream.schemaSource) {
      streamSchemas.push({
        streamId: stream.id,
        sourceSchema: stream.sourceSchema,
        schemaSource: stream.schemaSource,
      })
      structural = true
    }

    const m = diffStreamMappings(stream.id, prev.mappings, stream.mappings)
    mappingCreates.push(...m.creates)
    mappingUpdates.push(...m.updates)
    mappingDeletes.push(...m.deletes)
    if (m.structural) structural = true
  }

  return {
    connectorUpdate: hasConnectorUpdate ? connectorUpdate : null,
    streamRenames,
    streamRequestConfigs,
    streamSchemas,
    mappingCreates: orderCreates(mappingCreates),
    mappingUpdates,
    mappingDeletes,
    structural,
  }
}

/** Whether a plan has any work to do (an all-clean diff → no network). */
export function isEmptyPlan(plan: CommitPlan): boolean {
  return (
    plan.connectorUpdate === null &&
    plan.streamRenames.length === 0 &&
    plan.streamRequestConfigs.length === 0 &&
    plan.streamSchemas.length === 0 &&
    plan.mappingCreates.length === 0 &&
    plan.mappingUpdates.length === 0 &&
    plan.mappingDeletes.length === 0
  )
}
