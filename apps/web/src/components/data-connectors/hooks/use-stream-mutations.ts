// apps/web/src/components/data-connectors/hooks/use-stream-mutations.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'

type Stream = RouterOutputs['dataConnector']['listStreams'][number]
type Mapping = RouterOutputs['dataConnector']['listMappings'][number]

/** Field-mapping record — `{ targetFieldKey: { expression, sourceFields } }`. */
export type FieldMappings = Record<
  string,
  { expression: string; sourceFields: Record<string, string> }
>
/** Per-field merge strategy — `{ targetFieldKey: strategy }`. */
export type MergeStrategies = Record<string, string>
/** Identity resolution strategy for a mapping (mirrors the router's `identityStrategySchema`). */
export type IdentityStrategy =
  | { kind: 'connectorExternalId' }
  | {
      kind: 'matchField'
      connectorFieldKey: string
      targetFieldId: string
      normalize?: 'email' | 'phone' | 'domain' | 'none'
    }
  | { kind: 'manualReview' }

/**
 * Optimistic stream + mapping mutations against the React-Query cache, with
 * rollback-on-error. The optimistic write mirrors the server's response shape,
 * so success needs no refetch — only failure restores the pre-edit snapshot.
 *
 * Mirrors `agents/.../use-toolset-mutations.ts` for the instant toggles. For
 * consistency this is the single mutation surface for a stream: it ALSO exposes
 * the deliberate/imperative mutations (`saveRequestConfig`, `setStreamSchema`,
 * `addMapping`, `sampleFetch`) which stay invalidate-on-success rather than
 * optimistic. See plans/data-connectors/claude/06-frontend-update-handling.md §5.
 */
export function useStreamMutations(connectorId: string) {
  const utils = api.useUtils()
  const invalidateStreams = () =>
    void utils.dataConnector.listStreams.invalidate({ id: connectorId })

  // Optimistic (instant-toggle) mutations — no invalidate, rollback on error.
  const setStreamRequestConfigM = api.dataConnector.setStreamRequestConfig.useMutation()
  const setMappingTargetM = api.dataConnector.setMappingTarget.useMutation()
  const setFieldMappingsM = api.dataConnector.setFieldMappings.useMutation()
  const setMergeStrategiesM = api.dataConnector.setMergeStrategies.useMutation()
  const setIdentityStrategyM = api.dataConnector.setIdentityStrategy.useMutation()
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
  const addMappingM = api.dataConnector.addMapping.useMutation({
    onSuccess: (_data, variables) =>
      void utils.dataConnector.listMappings.invalidate({
        streamId: variables.dataConnectorStreamId,
      }),
    onError: (e) => toastError({ title: 'Could not add mapping', description: e.message }),
  })
  const sampleFetchM = api.dataConnector.sampleFetch.useMutation({
    onError: (e) => toastError({ title: 'Test-fetch failed', description: e.message }),
  })

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
  const patchMappings = useCallback(
    async (
      streamId: string,
      next: (rows: Mapping[]) => Mapping[],
      run: () => Promise<unknown>,
      errorTitle: string
    ) => {
      const key = { streamId }
      const previous = utils.dataConnector.listMappings.getData(key)
      utils.dataConnector.listMappings.setData(key, (old) => (old ? next(old) : old))
      try {
        await run()
      } catch (err) {
        utils.dataConnector.listMappings.setData(key, previous)
        toastError({
          title: errorTitle,
          description: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    },
    [utils.dataConnector.listMappings]
  )

  // ── Mapping toggles ───────────────────────────────────────────────────────
  const setMappingTarget = useCallback(
    (
      streamId: string,
      input: {
        mappingId: string
        entityDefinitionId: string
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
        () => setMappingTargetM.mutateAsync(input),
        'Could not change target'
      ),
    [patchMappings, setMappingTargetM]
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
        () => setFieldMappingsM.mutateAsync({ mappingId, fieldMappings }),
        'Could not save field'
      ),
    [patchMappings, setFieldMappingsM]
  )

  const setMergeStrategies = useCallback(
    (streamId: string, mappingId: string, mergeStrategies: MergeStrategies) =>
      patchMappings(
        streamId,
        (rows) =>
          rows.map((m) =>
            m.id === mappingId
              ? { ...m, mergeStrategies: mergeStrategies as Mapping['mergeStrategies'] }
              : m
          ),
        () => setMergeStrategiesM.mutateAsync({ mappingId, mergeStrategies }),
        'Could not save merge strategy'
      ),
    [patchMappings, setMergeStrategiesM]
  )

  const setIdentityStrategy = useCallback(
    (streamId: string, mappingId: string, identityStrategy: IdentityStrategy) =>
      patchMappings(
        streamId,
        (rows) =>
          rows.map((m) =>
            m.id === mappingId
              ? { ...m, identityStrategy: identityStrategy as Mapping['identityStrategy'] }
              : m
          ),
        () => setIdentityStrategyM.mutateAsync({ mappingId, identityStrategy }),
        'Could not save identity'
      ),
    [patchMappings, setIdentityStrategyM]
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

  // ── Stream sync-mode toggle (atomic) ──────────────────────────────────────
  const setSyncMode = useCallback(
    (
      streamId: string,
      syncMode: 'snapshot' | 'incremental',
      requestConfig: { path?: string; method?: 'GET' | 'POST'; recordsPath?: string }
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
    (
      streamId: string,
      requestConfig: { path?: string; method?: 'GET' | 'POST'; recordsPath?: string }
    ) => saveRequestConfigM.mutateAsync({ streamId, requestConfig }),
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

  const addMapping = useCallback(
    (input: Parameters<typeof addMappingM.mutate>[0]) => addMappingM.mutate(input),
    [addMappingM]
  )

  const sampleFetch = useCallback(
    (input: Parameters<typeof sampleFetchM.mutateAsync>[0]) => sampleFetchM.mutateAsync(input),
    [sampleFetchM]
  )

  return {
    // Optimistic instant toggles
    setMappingTarget,
    setFieldMappings,
    setMergeStrategies,
    setIdentityStrategy,
    removeMapping,
    setSyncMode,
    // Deliberate / imperative (invalidate-based)
    saveRequestConfig,
    setStreamSchema,
    addMapping,
    sampleFetch,
    // Pending flags
    isSavingRequest: saveRequestConfigM.isPending,
    isAddingMapping: addMappingM.isPending,
    isSampling: sampleFetchM.isPending,
  }
}
