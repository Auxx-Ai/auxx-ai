// apps/web/src/components/data-connectors/hooks/use-connector-commit.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api, type RouterInputs } from '~/trpc/react'
import {
  type CommitPlan,
  type ConnectorUpdatePatch,
  diffConnectorDraft,
  isEmptyPlan,
} from '../lib/connector-commit-diff'
import { getConnectorDraftState, useConnectorDraftStore } from '../stores/connector-draft-store'

type ConnectorUpdateInput = RouterInputs['dataConnector']['update']

/**
 * Widen the plan's connector patch into the `dataConnector.update` input.
 *
 * The draft holds `scheduleConfig` as an opaque `Record<string, unknown>` by design:
 * `schedule-section` builds a real cadence and widens it on the way into the store, and
 * `connector-commit-diff` is deliberately field-generic — it passes the blob through
 * untouched (locked in by its own test, which uses a partial cadence). This mutation is
 * the only place the blob meets the structured type, so the reconciliation belongs here.
 * Asserting is safe rather than lax: `scheduleConfigSchema` validates the payload
 * server-side, so a malformed blob still fails loudly instead of being silently dropped.
 * `scheduleConfig` is re-attached only when the patch carries it, so an untouched
 * schedule stays absent from the payload.
 */
function toConnectorUpdateInput(id: string, patch: ConnectorUpdatePatch): ConnectorUpdateInput {
  const { scheduleConfig, ...rest } = patch
  const input: ConnectorUpdateInput = { ...rest, id }
  if ('scheduleConfig' in patch) {
    input.scheduleConfig = scheduleConfig as ConnectorUpdateInput['scheduleConfig']
  }
  return input
}

/**
 * The commit/flush engine (plan §5) — the ONLY place connector configuration is
 * written. Reads the draft store imperatively, diffs it against the committed
 * snapshot, issues the minimal ordered set of tRPC mutations (resolving temp ids to
 * server ids), then reconciles the draft IN PLACE (`applyCommit`): it adopts the new
 * server ids for created mappings and re-baselines the snapshot — no getById/listStreams
 * refetch, because re-seeding would erase keystrokes typed during the round-trip. The
 * client draft is authoritative. Nothing here fires on keystroke — only on `commit()`
 * (invariant P3).
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
        independent.push(
          update.mutateAsync(toConnectorUpdateInput(connectorId, plan.connectorUpdate))
        )
      }
      for (const r of plan.streamRenames) {
        independent.push(
          updateStream.mutateAsync({
            streamId: r.streamId,
            ...(r.streamKey !== undefined ? { streamKey: r.streamKey } : {}),
            ...(r.enabled !== undefined ? { enabled: r.enabled } : {}),
          })
        )
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

      // The temp→real id map the caller uses to reconcile the draft in place (no refetch).
      return tempToReal
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
   * reconciles the draft in place (adopt created-mapping ids + re-baseline the
   * snapshot) — no refetch. All-or-nothing: any failure rolls the draft back to the
   * snapshot and surfaces one toast (plan §R2).
   */
  const commit = useCallback(async () => {
    const state = getConnectorDraftState()
    const { connectorId, snapshot, draft, meta } = state
    if (!connectorId || !snapshot || !meta) return
    const plan = diffConnectorDraft(snapshot, draft)
    if (isEmptyPlan(plan)) return

    // The baseline we're about to persist — captured BEFORE the round-trip so edits
    // typed during it stay in the live draft (they're not in `committed`).
    const committed = JSON.parse(JSON.stringify(draft)) as typeof draft

    setSaving(true)
    try {
      const tempToReal = await runPlan(connectorId, plan)

      // Reconcile the draft IN PLACE — adopt the freshly-minted server ids for created
      // mappings and re-baseline the snapshot to `committed`. Deliberately NO
      // getById/listStreams refetch + re-seed: a re-seed replaces the live draft and
      // erases keystrokes made during the round-trip (the page-query-invalidate
      // anti-pattern the agents editor calls out). The client draft is authoritative;
      // anything edited since this commit stays dirty and flushes on the next autosave.
      getConnectorDraftState().applyCommit(committed, tempToReal)

      // One status nudge per commit, only for a resync-affecting change (§5.3). This is
      // `getStatus` only (the status pill / resync banner) — it never feeds a controlled
      // input, so it can't clobber typing. Kills the per-keystroke `getStatus` storm.
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
