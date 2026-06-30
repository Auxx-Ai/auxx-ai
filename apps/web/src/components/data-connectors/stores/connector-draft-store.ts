// apps/web/src/components/data-connectors/stores/connector-draft-store.ts
'use client'

import { generateId } from '@auxx/utils'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { FieldMapping, UiRequestConfig } from '../hooks/use-stream-mutations'

/**
 * The unified connector saving model (plans/data-connectors/v4). A single Zustand
 * draft store is the client source of truth for a connector's *configuration* —
 * every editor (source, schedule, request, mappings) reads + writes the draft, and
 * NOTHING the worker can act on persists until `commit()` (the live-safety invariant,
 * plan §P3). This replaces the three legacy save mechanisms (`use-stream-mutations`
 * optimistic-immediate, `use-buffered-config`, `use-connector-edits` registry).
 *
 * Modeled on the house stores (`resources/store/resource-store.ts`,
 * `field-value-store.ts`): `create()(subscribeWithSelector())` so a keystroke in one
 * field doesn't re-render the whole tree, server-snapshot + overlay shape, temp-id
 * creates, `reset()` on teardown. The deliberate difference: this store is DEFERRED —
 * setters accumulate the overlay and a single `commit()` (in `use-connector-commit`)
 * flushes it; there is NO per-edit confirm/rollback choreography (plan §4).
 *
 * The store holds NO `api`/network imports — the bridge hook
 * (`use-connector-draft-sync`) seeds it from queries, and `use-connector-commit`
 * reads `getState()` and issues the mutations. State lives here; network lives in hooks.
 */

export type SyncBehavior = 'manual' | 'scheduled' | 'webhook'
export type SyncMode = 'snapshot' | 'incremental'
export type SchemaSource = 'catalog' | 'inferred' | 'manual'

/**
 * The persisted owned-def + edge declaration for a LAZILY-provisioned owned mapping
 * (05e). Read-only in the draft (the user never edits it) — carried so the mapping
 * editor can render the POTENTIAL entity before its def exists. Structural mirror of
 * `ConnectorMappingTargetSpec` (server) — kept local so the client store imports no
 * server type.
 */
export interface DraftTargetSpec {
  ownedDef?: {
    apiSlug: string
    singular: string
    plural: string
    icon?: string
    primaryDisplayFieldKey?: string
  }
  relationship?: {
    fieldKey: string
    name: string
    cardinality: string
    inverseName?: string
    targetRef?: { ownedApiSlug: string } | { entityKind: string }
  }
}

/**
 * A draft mapping row. `id` is a server id, or `temp_…` for a not-yet-created row
 * (fan-out). `parentMappingId` may reference a temp id (a child of an uncommitted
 * parent) — the commit resolves it. `_deleted` tombstones a removed row: the row
 * stays for the diff but is hidden from rendering, and commit translates it to a
 * `removeMapping`.
 */
export interface DraftMapping {
  id: string
  parentMappingId: string | null
  rootPath: string
  relationshipFieldKey: string | null
  linkMode: 'upsert' | 'reference'
  targetMode: 'owned' | 'contributing'
  entityDefinitionId: string | null
  /** Lazy owned-def + edge declaration (05e). Null/absent for contributing / real-def rows. */
  targetSpec?: DraftTargetSpec | null
  orphanBehavior: 'archive' | 'mark_deleted' | 'ignore'
  fieldMappings: FieldMapping[]
  _deleted?: boolean
}

/** A draft stream: editable request/schema config + its mappings. */
export interface DraftStream {
  id: string
  streamKey: string
  enabled: boolean
  syncMode: SyncMode
  requestConfig: UiRequestConfig
  sourceSchema: Record<string, unknown> | null
  schemaSource: SchemaSource | null
  mappings: DraftMapping[]
}

/** The editable connector surface — everything the worker could act on. */
export interface ConnectorDraft {
  name: string
  syncBehavior: SyncBehavior
  scheduleConfig: Record<string, unknown> | null
  /** The connector-level config blob (endpoint, backfillWindowSpan, webhookTrigger…). */
  config: Record<string, unknown>
  streams: DraftStream[]
}

/** Immutable connector metadata the readiness predicate + commit need — never edited. */
export interface ConnectorMeta {
  definitionKind: string
  credentialId: string | null
  status: string
}

/** A fan-out / add-mapping draft input (everything but the id, which the store mints). */
export interface AddMappingDraft {
  parentMappingId: string | null
  rootPath: string
  relationshipFieldKey?: string | null
  linkMode: 'upsert' | 'reference'
  targetMode: 'owned' | 'contributing'
  entityDefinitionId: string | null
  orphanBehavior?: 'archive' | 'mark_deleted' | 'ignore'
  fieldMappings?: FieldMapping[]
}

/**
 * The mapping mutation surface the mapping tree calls. A draft-backed adapter
 * (`mapping-tree.tsx`) implements it against the store — same method shapes the old
 * `use-stream-mutations` exposed, so `mapping-node.tsx` is untouched. Every call is a
 * pure draft mutation now (temp-id / tombstone), so a live connector never syncs a
 * half-built config (plan §P3, the live-safety win).
 */
export interface MappingDraftMutations {
  fanOut: (streamId: string, input: AddMappingDraft) => void
  setFieldMappings: (streamId: string, mappingId: string, fieldMappings: FieldMapping[]) => void
  setMappingTarget: (
    streamId: string,
    input: {
      mappingId: string
      entityDefinitionId: string | null
      targetMode: 'owned' | 'contributing'
      linkMode: 'upsert' | 'reference'
    }
  ) => void
  removeMapping: (streamId: string, mappingId: string) => void
}

/** The subset of a mapping the UI patches (draft-only, no network). */
export type MappingPatch = Partial<
  Pick<
    DraftMapping,
    | 'rootPath'
    | 'relationshipFieldKey'
    | 'linkMode'
    | 'targetMode'
    | 'entityDefinitionId'
    | 'orphanBehavior'
    | 'fieldMappings'
  >
>

interface ConnectorDraftState {
  // ── meta (read-only after seed) ──
  connectorId: string | null
  meta: ConnectorMeta | null
  // ── state ──
  draft: ConnectorDraft
  /** Last-committed server shape — the diff baseline. Null until first seed. */
  snapshot: ConnectorDraft | null
  isSaving: boolean
  autoSave: boolean
  /** Per-stream validity (e.g. invalid request-body JSON) — commit is blocked while any is false. */
  streamValidity: Record<string, boolean>

  // ── lifecycle ──
  seed: (connectorId: string, meta: ConnectorMeta, server: ConnectorDraft) => void
  /**
   * Post-commit reconcile WITHOUT a server refetch (the commit no longer invalidates
   * getById/listStreams — a re-seed would clobber keystrokes typed during the
   * round-trip). Adopts the freshly-minted server ids for any created mappings
   * (`tempToReal`) in the live draft, and re-baselines the snapshot to `committed`
   * (the draft as it was when the commit began) so `isDirty` reflects only edits made
   * SINCE the commit — those stay in the draft and flush on the next autosave.
   */
  applyCommit: (committed: ConnectorDraft, tempToReal: Map<string, string>) => void
  reset: () => void
  setSaving: (isSaving: boolean) => void
  setAutoSave: (autoSave: boolean) => void
  setStreamValidity: (streamId: string, valid: boolean) => void

  // ── connector-level setters (draft-only) ──
  setName: (name: string) => void
  setConfig: (config: Record<string, unknown>) => void
  setSyncBehavior: (behavior: SyncBehavior) => void
  setScheduleConfig: (config: Record<string, unknown> | null) => void
  setBackfillWindowSpan: (span: string) => void

  // ── stream setters (draft-only) ──
  renameStream: (streamId: string, streamKey: string) => void
  setStreamEnabled: (streamId: string, enabled: boolean) => void
  setSyncMode: (streamId: string, syncMode: SyncMode) => void
  setRequestConfig: (streamId: string, requestConfig: UiRequestConfig) => void
  setStreamSchema: (
    streamId: string,
    sourceSchema: Record<string, unknown>,
    schemaSource: SchemaSource
  ) => void
  setWebhookSteering: (streamId: string, steering: Record<string, unknown> | undefined) => void

  // ── mapping setters (temp-id / tombstone, draft-only) ──
  addMapping: (streamId: string, mapping: AddMappingDraft) => string
  updateMapping: (streamId: string, mappingId: string, patch: MappingPatch) => void
  removeMapping: (streamId: string, mappingId: string) => void
}

const EMPTY_DRAFT: ConnectorDraft = {
  name: '',
  syncBehavior: 'manual',
  scheduleConfig: null,
  config: {},
  streams: [],
}

/** A temp id the server has never seen — minted for fan-out/add until commit. */
export function isTempId(id: string): boolean {
  return id.startsWith('temp_')
}

/**
 * Replace temp mapping ids (and any child `parentMappingId` that points at one) with
 * their committed server ids. A no-op when nothing was created — returns the same draft
 * reference so a config/field-only commit doesn't churn the mapping tree.
 */
function remapMappingIds(draft: ConnectorDraft, map: Map<string, string>): ConnectorDraft {
  if (map.size === 0) return draft
  return {
    ...draft,
    streams: draft.streams.map((s) => ({
      ...s,
      mappings: s.mappings.map((m) => ({
        ...m,
        id: map.get(m.id) ?? m.id,
        parentMappingId:
          m.parentMappingId && map.has(m.parentMappingId)
            ? (map.get(m.parentMappingId) as string)
            : m.parentMappingId,
      })),
    })),
  }
}

/** Map a draft stream's mappings, replacing the one with `mappingId`. */
function patchStreamMappings(
  draft: ConnectorDraft,
  streamId: string,
  next: (mappings: DraftMapping[]) => DraftMapping[]
): ConnectorDraft {
  return {
    ...draft,
    streams: draft.streams.map((s) =>
      s.id === streamId ? { ...s, mappings: next(s.mappings) } : s
    ),
  }
}

/** Map a draft stream, replacing the one with `streamId`. */
function patchStream(
  draft: ConnectorDraft,
  streamId: string,
  patch: (stream: DraftStream) => DraftStream
): ConnectorDraft {
  return {
    ...draft,
    streams: draft.streams.map((s) => (s.id === streamId ? patch(s) : s)),
  }
}

/**
 * The transitive set of a mapping + all its descendants (parentMappingId chain).
 * Removing a subtree root must hide the whole subtree (the server cascades the
 * delete via the FK, #975 — see commit §5.2).
 */
export function descendantIds(mappings: DraftMapping[], rootId: string): Set<string> {
  const removed = new Set([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const m of mappings) {
      if (m.parentMappingId && removed.has(m.parentMappingId) && !removed.has(m.id)) {
        removed.add(m.id)
        grew = true
      }
    }
  }
  return removed
}

export const useConnectorDraftStore = create<ConnectorDraftState>()(
  subscribeWithSelector((set, get) => ({
    connectorId: null,
    meta: null,
    draft: EMPTY_DRAFT,
    snapshot: null,
    isSaving: false,
    autoSave: false,
    streamValidity: {},

    seed: (connectorId, meta, server) => {
      // Deep clone via structured serialize so draft and snapshot never alias —
      // a draft mutation must not also mutate the diff baseline.
      const clone = (): ConnectorDraft => JSON.parse(JSON.stringify(server)) as ConnectorDraft
      set({
        connectorId,
        meta,
        draft: clone(),
        snapshot: clone(),
        // A fresh seed clears any leftover validity for a different connector.
        streamValidity: {},
      })
    },

    applyCommit: (committed, tempToReal) =>
      set((s) => ({
        draft: remapMappingIds(s.draft, tempToReal),
        snapshot: remapMappingIds(committed, tempToReal),
      })),

    reset: () =>
      set({
        connectorId: null,
        meta: null,
        draft: EMPTY_DRAFT,
        snapshot: null,
        isSaving: false,
        autoSave: false,
        streamValidity: {},
      }),

    setSaving: (isSaving) => set({ isSaving }),
    setAutoSave: (autoSave) => set({ autoSave }),
    setStreamValidity: (streamId, valid) =>
      set((s) => ({ streamValidity: { ...s.streamValidity, [streamId]: valid } })),

    setName: (name) => set((s) => ({ draft: { ...s.draft, name } })),
    setConfig: (config) => set((s) => ({ draft: { ...s.draft, config } })),
    setSyncBehavior: (syncBehavior) => set((s) => ({ draft: { ...s.draft, syncBehavior } })),
    setScheduleConfig: (scheduleConfig) => set((s) => ({ draft: { ...s.draft, scheduleConfig } })),
    setBackfillWindowSpan: (span) =>
      set((s) => ({
        draft: { ...s.draft, config: { ...s.draft.config, backfillWindowSpan: span } },
      })),

    renameStream: (streamId, streamKey) =>
      set((s) => ({ draft: patchStream(s.draft, streamId, (st) => ({ ...st, streamKey })) })),

    setStreamEnabled: (streamId, enabled) =>
      set((s) => ({ draft: patchStream(s.draft, streamId, (st) => ({ ...st, enabled })) })),

    setSyncMode: (streamId, syncMode) =>
      set((s) => ({ draft: patchStream(s.draft, streamId, (st) => ({ ...st, syncMode })) })),

    setRequestConfig: (streamId, requestConfig) =>
      set((s) => ({ draft: patchStream(s.draft, streamId, (st) => ({ ...st, requestConfig })) })),

    setStreamSchema: (streamId, sourceSchema, schemaSource) =>
      set((s) => ({
        draft: patchStream(s.draft, streamId, (st) => ({ ...st, sourceSchema, schemaSource })),
      })),

    setWebhookSteering: (streamId, steering) =>
      set((s) => ({
        draft: patchStream(s.draft, streamId, (st) => ({
          ...st,
          requestConfig: { ...st.requestConfig, webhookTrigger: steering },
        })),
      })),

    addMapping: (streamId, mapping) => {
      const tempId = `temp_${generateId()}`
      set((s) => ({
        draft: patchStreamMappings(s.draft, streamId, (rows) => [
          ...rows,
          {
            id: tempId,
            parentMappingId: mapping.parentMappingId,
            rootPath: mapping.rootPath,
            relationshipFieldKey: mapping.relationshipFieldKey ?? null,
            linkMode: mapping.linkMode,
            targetMode: mapping.targetMode,
            entityDefinitionId: mapping.entityDefinitionId,
            // Fan-out / hand-added rows are never lazy owned — they bind to a real def.
            targetSpec: null,
            orphanBehavior: mapping.orphanBehavior ?? 'ignore',
            fieldMappings: mapping.fieldMappings ?? [],
          },
        ]),
      }))
      return tempId
    },

    updateMapping: (streamId, mappingId, patch) =>
      set((s) => ({
        draft: patchStreamMappings(s.draft, streamId, (rows) =>
          rows.map((m) => (m.id === mappingId ? { ...m, ...patch } : m))
        ),
      })),

    removeMapping: (streamId, mappingId) =>
      set((s) => ({
        draft: patchStreamMappings(s.draft, streamId, (rows) => {
          const removed = descendantIds(rows, mappingId)
          // A temp row the server never saw: drop it outright. A real row: tombstone
          // it (keep for the diff → translates to removeMapping on commit).
          return rows
            .filter((m) => !(removed.has(m.id) && isTempId(m.id)))
            .map((m) => (removed.has(m.id) ? { ...m, _deleted: true } : m))
        }),
      })),
  }))
)

/** Imperative snapshot for the commit engine. */
export function getConnectorDraftState() {
  return useConnectorDraftStore.getState()
}

// ── derived selectors ──────────────────────────────────────────────────────────

/** `true` when the draft differs from the last-committed snapshot. */
export function selectIsDirty(s: ConnectorDraftState): boolean {
  if (!s.snapshot) return false
  return JSON.stringify(s.draft) !== JSON.stringify(s.snapshot)
}

/** Commit is allowed when the draft is dirty AND no stream is flagged invalid. */
export function selectCanCommit(s: ConnectorDraftState): boolean {
  if (!selectIsDirty(s)) return false
  return Object.values(s.streamValidity).every(Boolean)
}

/** A stream's live (non-tombstoned) mappings — the render set. */
export function visibleMappings(stream: DraftStream): DraftMapping[] {
  return stream.mappings.filter((m) => !m._deleted)
}
