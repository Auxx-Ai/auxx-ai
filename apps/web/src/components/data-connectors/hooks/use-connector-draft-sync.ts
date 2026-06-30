// apps/web/src/components/data-connectors/hooks/use-connector-draft-sync.ts
'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { RouterOutputs } from '~/trpc/react'
import {
  type ConnectorDraft,
  type ConnectorMeta,
  selectIsDirty,
  useConnectorDraftStore,
} from '../stores/connector-draft-store'

type Connector = NonNullable<RouterOutputs['dataConnector']['getById']>
type Stream = RouterOutputs['dataConnector']['listStreams'][number]

/** Single debounce for the whole connector editor (plan §6 — the dormant 800ms is gone). */
const AUTOSAVE_DEBOUNCE_MS = 700

/**
 * Map the `getById` + `listStreams` server shapes into the draft the store holds.
 * Pure — the bridge seeds the store with this; the store never touches `api`.
 */
export function toConnectorDraft(connector: Connector, streams: Stream[]): ConnectorDraft {
  return {
    name: connector.name,
    syncBehavior: (connector.syncBehavior as ConnectorDraft['syncBehavior']) ?? 'manual',
    scheduleConfig: (connector.scheduleConfig as Record<string, unknown> | null) ?? null,
    config: (connector.config as Record<string, unknown> | null) ?? {},
    streams: streams.map((s) => ({
      id: s.id,
      streamKey: s.streamKey ?? '',
      enabled: s.enabled,
      syncMode: (s.syncMode as 'snapshot' | 'incremental') ?? 'snapshot',
      requestConfig: (s.requestConfig as ConnectorDraft['streams'][number]['requestConfig']) ?? {},
      sourceSchema: (s.sourceSchema as Record<string, unknown> | null) ?? null,
      schemaSource: (s.schemaSource as 'catalog' | 'inferred' | 'manual' | null) ?? null,
      mappings: s.mappings.map((m) => ({
        id: m.id,
        parentMappingId: m.parentMappingId ?? null,
        rootPath: m.rootPath ?? '',
        relationshipFieldKey: m.relationshipFieldKey ?? null,
        linkMode: (m.linkMode as 'upsert' | 'reference') ?? 'upsert',
        targetMode: (m.targetMode as 'owned' | 'contributing') ?? 'owned',
        entityDefinitionId: m.entityDefinitionId ?? null,
        orphanBehavior: (m.orphanBehavior as 'archive' | 'mark_deleted' | 'ignore') ?? 'ignore',
        fieldMappings: (m.fieldMappings ??
          []) as ConnectorDraft['streams'][number]['mappings'][number]['fieldMappings'],
      })),
    })),
  }
}

export function toConnectorMeta(connector: Connector): ConnectorMeta {
  return {
    definitionKind: connector.definitionKind,
    credentialId: connector.credentialId ?? null,
    status: connector.status,
  }
}

/**
 * Bridge between the server queries and the draft store (plan §4.3). Seeds the store
 * from `getById` + `listStreams` on mount, re-seeds on connector-id change, and
 * re-seeds on a server move ONLY while the draft is clean — a background poll or
 * realtime frame mid-edit must never clobber an uncommitted edit (invariant I1). Owns
 * the single autosave debounce (setup / `pending` connectors): when `autoSave` is on,
 * a settled dirty draft flushes via `commit` once.
 *
 * `commit` is passed in (it lives in `use-connector-commit`, which imports `api`) so
 * this hook and the store stay free of the commit's network surface.
 */
export function useConnectorDraftSync(input: {
  connector: Connector
  streams: Stream[] | undefined
  autoSave: boolean
  commit: () => Promise<void>
}): void {
  const { connector, streams, autoSave, commit } = input

  const seed = useConnectorDraftStore((s) => s.seed)
  const setAutoSave = useConnectorDraftStore((s) => s.setAutoSave)
  const reset = useConnectorDraftStore((s) => s.reset)

  // The server-derived draft + a stable comparison key. `streams` may be undefined on
  // the first render (query in flight) — seed connector-only until it resolves, then
  // re-seed with streams (still clean, so the gate allows it).
  const serverDraft = useMemo(
    () => toConnectorDraft(connector, streams ?? []),
    [connector, streams]
  )
  const serverKey = useMemo(() => JSON.stringify(serverDraft), [serverDraft])
  const meta = useMemo(() => toConnectorMeta(connector), [connector])

  const lastSeededKey = useRef<string | null>(null)

  // Seed / re-seed. Seed whenever the store isn't already holding THIS connector —
  // a fresh mount, a connector-id change (page-scoped lifecycle), or a store that was
  // wiped by the unmount `reset()` cleanup. The last case is what React StrictMode
  // exercises in dev: it runs every effect setup → cleanup → setup, so the cleanup
  // resets the store while this effect's refs survive — guarding on the live store
  // `connectorId` (not a ref) is what lets the second setup re-seed. Otherwise re-seed
  // only when the server shape changed AND the draft is clean (a background refresh
  // must never clobber an uncommitted edit, invariant I1).
  useEffect(() => {
    const state = useConnectorDraftStore.getState()
    const notSeeded = state.connectorId !== connector.id
    const dirty = selectIsDirty(state)
    if (notSeeded || (serverKey !== lastSeededKey.current && !dirty)) {
      seed(connector.id, meta, serverDraft)
      lastSeededKey.current = serverKey
    }
  }, [connector.id, serverKey, serverDraft, meta, seed])

  // Keep the store's autoSave flag in sync (drives the save bar + this debounce).
  useEffect(() => {
    setAutoSave(autoSave)
  }, [autoSave, setAutoSave])

  // Reset the store when the editor unmounts so the next connector starts clean.
  useEffect(() => () => reset(), [reset])

  // Autosave debounce (setup mode). Subscribe to dirty/saving; a settled dirty draft
  // flushes once. Continuous edits re-arm; a save in flight or a clean draft arms
  // nothing (mirrors the legacy `use-connector-edits` debounce).
  const isDirty = useConnectorDraftStore(selectIsDirty)
  const isSaving = useConnectorDraftStore((s) => s.isSaving)
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => {
    if (!autoSave || !isDirty || isSaving) return
    const timer = setTimeout(() => void commitRef.current(), AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [autoSave, isDirty, isSaving])

  // Nav-away guard (invariant I5) — warn before a tab close / reload drops an unsaved
  // manual draft. New behavior the immediate model never needed (edits can now sit
  // uncommitted). Autosave mode flushes on its own, so it never needs the prompt.
  useEffect(() => {
    if (autoSave || !isDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [autoSave, isDirty])
}
