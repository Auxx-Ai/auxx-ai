// apps/web/src/components/data-connectors/hooks/use-stream-mutations.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { generateId } from '@auxx/utils'
import { useCallback } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'

type Stream = RouterOutputs['dataConnector']['listStreams'][number]
type Mapping = Stream['mappings'][number]

/** Per-field merge strategy. Folded into each binding entry (absent ⇒ 'overwrite'). */
export type FieldMergeStrategy =
  | 'overwrite'
  | 'fill_blank'
  | 'connector_owned_only'
  | 'manual_review'
  | 'ignore'

/**
 * One binding entry. Identity is the stable `id`; `targetFieldKey` is nullable
 * (`null` = an unassigned draft formula the runtime skips). `match` flags the
 * bound field as a secondary identity key (external id stays primary).
 */
export type FieldMapping = {
  id: string
  targetFieldKey: string | null
  expression: string
  sourceFields: Record<string, string>
  match?: { normalize?: 'email' | 'phone' | 'domain' | 'none' }
  mergeStrategy?: FieldMergeStrategy
  /** Provisioning hint (template-seeded only; the UI never sets it, but preserves it). */
  provision?: { name: string; type: string; icon?: string; isHidden?: boolean }
}
/** A mapping's bindings — an ordered array of entries (not keyed by target). */
export type FieldMappings = FieldMapping[]

/**
 * Optimistic stream + mapping mutations against the React-Query cache, with
 * rollback-on-error. The optimistic write mirrors the server's response shape,
 * so success needs no refetch — only failure restores the pre-edit snapshot.
 *
 * Mirrors `agents/.../use-toolset-mutations.ts` for the instant toggles. For
 * consistency this is the single mutation surface for a stream: it ALSO exposes
 * the deliberate/imperative mutations (`saveRequestConfig`, `setStreamSchema`,
 * `sampleFetch`) which stay invalidate-on-success rather than optimistic. See
 * plans/data-connectors/claude/06-frontend-update-handling.md §5.
 *
 * Every mapping read lives in the `listStreams` cache (mappings nested per
 * stream — plan 08 §3), so the optimistic mapping patches target that array, not
 * a separate per-stream query. All mapping field writes route through the single
 * `updateMapping` mutation.
 */
export function useStreamMutations(connectorId: string) {
  const utils = api.useUtils()
  const invalidateStreams = () =>
    void utils.dataConnector.listStreams.invalidate({ id: connectorId })

  // Optimistic (instant-toggle) mutations — no invalidate, rollback on error.
  const updateStreamM = api.dataConnector.updateStream.useMutation()
  const setStreamRequestConfigM = api.dataConnector.setStreamRequestConfig.useMutation()
  const updateMappingM = api.dataConnector.updateMapping.useMutation()
  const removeMappingM = api.dataConnector.removeMapping.useMutation()

  // Deliberate / imperative mutations — invalidate-on-success + error toast.
  // Co-located here for consistency (one mutation surface per stream) even
  // though they aren't optimistic. A second `setStreamRequestConfig` instance
  // backs the explicit Save (the bare one above stays optimistic for setSyncMode).
  const saveRequestConfigM = api.dataConnector.setStreamRequestConfig.useMutation({
    onSuccess: invalidateStreams,
    onError: (e) => toastError({ title: 'Could not save request', description: e.message }),
  })
  const setStreamSchemaM = api.dataConnector.setStreamSchema.useMutation({
    onSuccess: invalidateStreams,
    onError: (e) => toastError({ title: 'Could not save schema', description: e.message }),
  })
  const sampleFetchM = api.dataConnector.sampleFetch.useMutation({
    onError: (e) => toastError({ title: 'Test-fetch failed', description: e.message }),
  })
  // Bare instance for the optimistic fan-out — invalidate + rollback are handled
  // inline in `fanOut` so the temp child row reconciles to the server row.
  const addChildMappingM = api.dataConnector.addMapping.useMutation()

  // ── Stream-cache optimistic runner ────────────────────────────────────────
  const patchStream = useCallback(
    async (
      streamId: string,
      patch: Partial<Stream>,
      run: () => Promise<unknown>,
      errorTitle: string
    ) => {
      const key = { id: connectorId }
      const previous = utils.dataConnector.listStreams.getData(key)
      utils.dataConnector.listStreams.setData(key, (old) =>
        old?.map((s) => (s.id === streamId ? { ...s, ...patch } : s))
      )
      try {
        await run()
      } catch (err) {
        utils.dataConnector.listStreams.setData(key, previous)
        toastError({
          title: errorTitle,
          description: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    },
    [connectorId, utils.dataConnector.listStreams]
  )

  // ── Mapping-cache optimistic runner ───────────────────────────────────────
  // Mappings live nested in the `listStreams` cache; patch the matching stream's
  // `mappings` array and roll the whole snapshot back on error.
  const patchMappings = useCallback(
    async (
      streamId: string,
      next: (rows: Mapping[]) => Mapping[],
      run: () => Promise<unknown>,
      errorTitle: string
    ) => {
      const key = { id: connectorId }
      const previous = utils.dataConnector.listStreams.getData(key)
      utils.dataConnector.listStreams.setData(key, (old) =>
        old?.map((s) => (s.id === streamId ? { ...s, mappings: next(s.mappings) } : s))
      )
      try {
        await run()
      } catch (err) {
        utils.dataConnector.listStreams.setData(key, previous)
        toastError({
          title: errorTitle,
          description: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    },
    [connectorId, utils.dataConnector.listStreams]
  )

  // ── Mapping toggles ───────────────────────────────────────────────────────
  const setMappingTarget = useCallback(
    (
      streamId: string,
      input: {
        mappingId: string
        entityDefinitionId: string | null
        targetMode: 'owned' | 'contributing'
        linkMode: 'upsert' | 'reference'
      }
    ) =>
      patchMappings(
        streamId,
        (rows) =>
          rows.map((m) =>
            m.id === input.mappingId
              ? {
                  ...m,
                  targetMode: input.targetMode,
                  linkMode: input.linkMode,
                  entityDefinitionId: input.entityDefinitionId,
                }
              : m
          ),
        () => updateMappingM.mutateAsync(input),
        'Could not change target'
      ),
    [patchMappings, updateMappingM]
  )

  const setRootPath = useCallback(
    (streamId: string, mappingId: string, rootPath: string) =>
      patchMappings(
        streamId,
        (rows) => rows.map((m) => (m.id === mappingId ? { ...m, rootPath } : m)),
        () => updateMappingM.mutateAsync({ mappingId, rootPath }),
        'Could not change root path'
      ),
    [patchMappings, updateMappingM]
  )

  const setFieldMappings = useCallback(
    (streamId: string, mappingId: string, fieldMappings: FieldMappings) =>
      patchMappings(
        streamId,
        (rows) =>
          rows.map((m) =>
            m.id === mappingId
              ? { ...m, fieldMappings: fieldMappings as Mapping['fieldMappings'] }
              : m
          ),
        () => updateMappingM.mutateAsync({ mappingId, fieldMappings }),
        'Could not save field'
      ),
    [patchMappings, updateMappingM]
  )

  // ── Fan-out / reference (materialize a child mapping) ─────────────────────
  // Optimistic insert of a temp child row so the branch re-renders as a
  // MappingNode immediately, reconciled to the server row on settle. Mirrors the
  // `patchMappings` rollback pattern (plan §5.1, §8.4).
  const fanOut = useCallback(
    (
      streamId: string,
      input: {
        /** Null for a top-level mapping created straight off a source row. */
        parentMappingId: string | null
        rootPath: string
        linkMode: 'upsert' | 'reference'
        targetMode: 'owned' | 'contributing'
        entityDefinitionId: string
        /** Parent→child relation field key; null until provisioning wires it (plan §8.1). */
        relationshipFieldKey?: string | null
      }
    ) => {
      const key = { id: connectorId }
      const previous = utils.dataConnector.listStreams.getData(key)
      const streamMappings = previous?.find((s) => s.id === streamId)?.mappings
      const tempId = `temp_${generateId()}`
      // Prefer cloning an existing row (every column present), but an empty stream
      // has none — fall back to a literal temp row. Either way it reconciles to the
      // server row on invalidate.
      const template =
        (input.parentMappingId
          ? streamMappings?.find((m) => m.id === input.parentMappingId)
          : undefined) ?? streamMappings?.[0]
      const tempRow: Mapping = template
        ? {
            ...template,
            id: tempId,
            parentMappingId: input.parentMappingId,
            rootPath: input.rootPath,
            linkMode: input.linkMode,
            targetMode: input.targetMode,
            entityDefinitionId: input.entityDefinitionId,
            relationshipFieldKey: input.relationshipFieldKey ?? null,
            fieldMappings: [] as Mapping['fieldMappings'],
          }
        : {
            id: tempId,
            dataConnectorStreamId: streamId,
            organizationId: '',
            parentMappingId: input.parentMappingId,
            rootPath: input.rootPath,
            linkMode: input.linkMode,
            relationshipFieldKey: input.relationshipFieldKey ?? null,
            targetMode: input.targetMode,
            entityDefinitionId: input.entityDefinitionId,
            fieldMappings: [] as Mapping['fieldMappings'],
            orphanBehavior: 'ignore',
            createdAt: new Date(),
            updatedAt: new Date(),
          }
      utils.dataConnector.listStreams.setData(key, (old) =>
        old?.map((s) => (s.id === streamId ? { ...s, mappings: [...s.mappings, tempRow] } : s))
      )
      addChildMappingM
        .mutateAsync({
          dataConnectorStreamId: streamId,
          parentMappingId: input.parentMappingId,
          rootPath: input.rootPath,
          linkMode: input.linkMode,
          targetMode: input.targetMode,
          entityDefinitionId: input.entityDefinitionId,
          relationshipFieldKey: input.relationshipFieldKey ?? null,
        })
        .then(() => void utils.dataConnector.listStreams.invalidate(key))
        .catch((err) => {
          utils.dataConnector.listStreams.setData(key, previous)
          toastError({
            title: 'Could not add mapping',
            description: err instanceof Error ? err.message : 'Unknown error',
          })
        })
    },
    [connectorId, utils.dataConnector.listStreams, addChildMappingM]
  )

  const removeMapping = useCallback(
    (streamId: string, mappingId: string) =>
      patchMappings(
        streamId,
        // Drop the row and any descendants (parentMappingId chain).
        (rows) => {
          const removed = new Set([mappingId])
          let grew = true
          while (grew) {
            grew = false
            for (const m of rows) {
              if (m.parentMappingId && removed.has(m.parentMappingId) && !removed.has(m.id)) {
                removed.add(m.id)
                grew = true
              }
            }
          }
          return rows.filter((m) => !removed.has(m.id))
        },
        () => removeMappingM.mutateAsync({ mappingId }),
        'Could not remove mapping'
      ),
    [patchMappings, removeMappingM]
  )

  // ── Stream rename (optimistic) ────────────────────────────────────────────
  const renameStream = useCallback(
    (streamId: string, streamKey: string) =>
      patchStream(
        streamId,
        { streamKey } as Partial<Stream>,
        () => updateStreamM.mutateAsync({ streamId, streamKey }),
        'Could not rename stream'
      ),
    [patchStream, updateStreamM]
  )

  // ── Stream sync-mode toggle (atomic) ──────────────────────────────────────
  const setSyncMode = useCallback(
    (
      streamId: string,
      syncMode: 'snapshot' | 'incremental',
      requestConfig: { path?: string; method?: 'GET' | 'POST' }
    ) =>
      patchStream(
        streamId,
        { syncMode } as Partial<Stream>,
        () => setStreamRequestConfigM.mutateAsync({ streamId, requestConfig, syncMode }),
        'Could not save sync mode'
      ),
    [patchStream, setStreamRequestConfigM]
  )

  // ── Deliberate / imperative wrappers (invalidate-based) ───────────────────
  const saveRequestConfig = useCallback(
    (streamId: string, requestConfig: { path?: string; method?: 'GET' | 'POST' }) =>
      saveRequestConfigM.mutateAsync({ streamId, requestConfig }),
    [saveRequestConfigM]
  )

  const setStreamSchema = useCallback(
    (
      streamId: string,
      sourceSchema: Record<string, unknown>,
      schemaSource: 'inferred' | 'manual'
    ) => setStreamSchemaM.mutate({ streamId, sourceSchema, schemaSource }),
    [setStreamSchemaM]
  )

  const sampleFetch = useCallback(
    (input: Parameters<typeof sampleFetchM.mutateAsync>[0]) => sampleFetchM.mutateAsync(input),
    [sampleFetchM]
  )

  return {
    // Optimistic instant toggles
    setMappingTarget,
    setRootPath,
    setFieldMappings,
    fanOut,
    removeMapping,
    renameStream,
    setSyncMode,
    // Deliberate / imperative (invalidate-based)
    saveRequestConfig,
    setStreamSchema,
    sampleFetch,
    // Pending flags
    isSavingRequest: saveRequestConfigM.isPending,
    isSampling: sampleFetchM.isPending,
  }
}
