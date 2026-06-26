// apps/web/src/components/data-connectors/hooks/use-connector-commit.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import { type CommitPlan, diffConnectorDraft, isEmptyPlan } from '../lib/connector-commit-diff'
import { getConnectorDraftState, useConnectorDraftStore } from '../stores/connector-draft-store'
import { toConnectorDraft, toConnectorMeta } from './use-connector-draft-sync'

/**
 * The commit/flush engine (plan §5) — the ONLY place connector configuration is
 * written. Reads the draft store imperatively, diffs it against the committed
 * snapshot, issues the minimal ordered set of tRPC mutations (resolving temp ids to
 * server ids), then re-seeds the store from the authoritative refetch so the draft
 * adopts real ids + server-derived fields (`linkMode`, §5.4). Nothing here fires on
 * keystroke — only on `commit()` (invariant P3).
 *
 * Lives in a hook (not the store) so the store stays free of `api`/network imports.
 */
export function useConnectorCommit() {
  const utils = api.useUtils()
  const setSaving = useConnectorDraftStore((s) => s.setSaving)

  // The commit-time mutation surface. These are called ONLY from `commit()` — the
  // editors no longer touch them (they mutate the draft instead).
  const update = api.dataConnector.update.useMutation()
  const updateStream = api.dataConnector.updateStream.useMutation()
  const setStreamRequestConfig = api.dataConnector.setStreamRequestConfig.useMutation()
  const setStreamSchema = api.dataConnector.setStreamSchema.useMutation()
  const addMapping = api.dataConnector.addMapping.useMutation()
  const updateMapping = api.dataConnector.updateMapping.useMutation()
  const removeMapping = api.dataConnector.removeMapping.useMutation()

  const runPlan = useCallback(
    async (connectorId: string, plan: CommitPlan) => {
      // 1. Connector-level + per-stream config — independent, fire in parallel.
      const independent: Array<Promise<unknown>> = []
      if (plan.connectorUpdate) {
        independent.push(update.mutateAsync({ id: connectorId, ...plan.connectorUpdate }))
      }
      for (const r of plan.streamRenames) {
        independent.push(updateStream.mutateAsync({ streamId: r.streamId, streamKey: r.streamKey }))
      }
      for (const rc of plan.streamRequestConfigs) {
        independent.push(
          setStreamRequestConfig.mutateAsync({
            streamId: rc.streamId,
            requestConfig: rc.requestConfig,
            ...(rc.syncMode ? { syncMode: rc.syncMode } : {}),
          })
        )
      }
      for (const sc of plan.streamSchemas) {
        independent.push(
          setStreamSchema.mutateAsync({
            streamId: sc.streamId,
            sourceSchema: sc.sourceSchema,
            schemaSource: sc.schemaSource,
          })
        )
      }

      // 2. Mapping creates — SERIALIZED parents-before-children so a child's temp
      //    parentMappingId resolves to the parent's freshly-minted server id (I2).
      const tempToReal = new Map<string, string>()
      const createChain = (async () => {
        for (const c of plan.mappingCreates) {
          const parentMappingId =
            c.parentMappingId && tempToReal.has(c.parentMappingId)
              ? tempToReal.get(c.parentMappingId)!
              : c.parentMappingId
          const row = await addMapping.mutateAsync({
            dataConnectorStreamId: c.streamId,
            rootPath: c.rootPath,
            linkMode: c.linkMode,
            targetMode: c.targetMode,
            entityDefinitionId: c.entityDefinitionId,
            parentMappingId,
            relationshipFieldKey: c.relationshipFieldKey,
            fieldMappings: c.fieldMappings,
            orphanBehavior: c.orphanBehavior,
          })
          tempToReal.set(c.tempId, row.id)
        }
      })()

      // 3. Mapping updates — independent of the create chain (real ids).
      for (const u of plan.mappingUpdates) {
        independent.push(updateMapping.mutateAsync({ mappingId: u.mappingId, ...u.patch }))
      }

      await Promise.all([...independent, createChain])

      // 4. Deletes last — after creates/updates settle, so a cascade can't race a
      //    sibling write. Subtree roots only; the server cascades children (§5.2).
      for (const d of plan.mappingDeletes) {
        await removeMapping.mutateAsync({ mappingId: d.mappingId })
      }
    },
    [
      update,
      updateStream,
      setStreamRequestConfig,
      setStreamSchema,
      addMapping,
      updateMapping,
      removeMapping,
    ]
  )

  /**
   * Flush the draft. Diffs against the snapshot, runs the ordered mutations, then
   * re-seeds from the authoritative refetch. All-or-nothing: any failure rolls the
   * draft back to the snapshot and surfaces one toast (plan §R2).
   */
  const commit = useCallback(async () => {
    const state = getConnectorDraftState()
    const { connectorId, snapshot, draft, meta } = state
    if (!connectorId || !snapshot || !meta) return
    const plan = diffConnectorDraft(snapshot, draft)
    if (isEmptyPlan(plan)) return

    setSaving(true)
    try {
      await runPlan(connectorId, plan)

      // Re-seed from the authoritative shape — real ids, server-derived `linkMode`.
      // The single intentional post-commit refetch (replaces the per-edit storm, §5.4).
      await Promise.all([
        utils.dataConnector.getById.invalidate({ id: connectorId }),
        utils.dataConnector.listStreams.invalidate({ id: connectorId }),
      ])
      const [connector, streams] = await Promise.all([
        utils.dataConnector.getById.fetch({ id: connectorId }),
        utils.dataConnector.listStreams.fetch({ id: connectorId }),
      ])
      if (connector) {
        getConnectorDraftState().seed(
          connectorId,
          toConnectorMeta(connector),
          toConnectorDraft(connector, streams)
        )
      }

      // One status nudge per commit, only for a resync-affecting change (§5.3) — kills
      // the per-keystroke `getStatus` storm.
      if (plan.structural) {
        void utils.dataConnector.getStatus.invalidate({ id: connectorId })
      }
    } catch (err) {
      // Roll the draft back to the committed snapshot — no partial-commit confusion.
      const s = getConnectorDraftState()
      if (s.snapshot) s.seed(connectorId, meta, s.snapshot)
      toastError({
        title: 'Could not save changes',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      getConnectorDraftState().setSaving(false)
    }
  }, [utils, runPlan, setSaving])

  return commit
}
