// apps/web/src/components/workflow/providers/workflow-save-provider.tsx

'use client'

import {
  DEHYDRATION_OPTIONS,
  dehydrateGraph,
  deriveTriggerColumns,
  stripDerivedKeys,
} from '@auxx/lib/workflow-engine/client'
import { toastError } from '@auxx/ui/components/toast'
import { debounce } from '@auxx/utils'
import { useStoreApi } from '@xyflow/react'
import type React from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { useAnalytics } from '~/hooks/use-analytics'
import { api } from '~/trpc/react'
import { useReadOnly } from '../hooks/use-read-only'
import { unifiedNodeRegistry } from '../nodes/unified-registry'
import { useCanvasStore } from '../store/canvas-store'
import { useRunStore } from '../store/run-store'
import { useTestInputStore } from '../store/test-input-store'
import type { WorkflowPendingChanges } from '../store/types'
import { useVarStore } from '../store/use-var-store'
import { useWorkflowStore } from '../store/workflow-store'
import type { FlowEdge, FlowNode } from '../types'
import {
  diffProjections,
  type ProjectedGraph,
  projectEnvVars,
  projectGraph,
} from '../utils/save-baseline'

/**
 * Quiet period after the last edit (plan 22 §5 D3). Was a flat 5 s with no
 * upper bound, which meant a continuous typing session never persisted at all.
 */
const DEBOUNCE_MS = 1500

/** Hard ceiling on how long a burst may defer the write. */
const MAX_WAIT_MS = 10_000

/** All possible pending changes. Re-exported for the hook's public signature. */
export type PendingChanges = WorkflowPendingChanges

/**
 * Everything `useWorkflowSave()` hands back. Declared explicitly so the
 * out-of-editor no-op below is checked against the full surface rather than
 * being cast into place.
 */
export interface WorkflowSaveApi {
  saveGraph: () => void
  saveMetadata: (updates: { name?: string; description?: string }) => void
  saveIcon: (icon: { iconId: string; color: string }) => void
  saveShareSettings: (
    updates: Pick<
      PendingChanges,
      'webEnabled' | 'apiEnabled' | 'accessMode' | 'config' | 'rateLimit'
    >
  ) => void
  saveEnvVars: () => void
  saveNow: () => Promise<boolean>
  cancelPendingSave: () => void

  /** Backwards compatibility — the names existing call sites already use. */
  save: () => Promise<boolean>
  debouncedSave: () => void
  getWorkflowSavePayload: () => Record<string, unknown> | null
  syncWorkflowWhenPageClose: () => void

  isDirty: boolean
  isSaving: boolean
}

/**
 * A request the content guard has not looked at yet: the payload, plus the
 * projected content of whichever halves it carries, so the guard can compare
 * them without rebuilding (or re-dehydrating) anything.
 */
interface SaveRequest {
  payload: Record<string, unknown>
  /** Present iff `payload.graph` is set. Projection of the DEHYDRATED graph. */
  graph?: ProjectedGraph
  /** Present iff `payload.envVars` is set. */
  envText?: string
}

const WorkflowSaveContext = createContext<WorkflowSaveApi | null>(null)

/**
 * No-op surface for contexts that render canvas components without an editor —
 * the public `WorkflowViewer` and version previews both mount `FLOW_NODE_TYPES`
 * (the note node calls `useNodeCrud`) outside this provider. Those surfaces are
 * read-only anyway, so every save was already a no-op there.
 */
const NOOP_SAVE_API: WorkflowSaveApi = {
  saveGraph: () => {},
  saveMetadata: () => {},
  saveIcon: () => {},
  saveShareSettings: () => {},
  saveEnvVars: () => {},
  saveNow: () => Promise.resolve(false),
  cancelPendingSave: () => {},
  save: () => Promise.resolve(false),
  debouncedSave: () => {},
  getWorkflowSavePayload: () => null,
  syncWorkflowWhenPageClose: () => {},
  isDirty: false,
  isSaving: false,
}

/**
 * The one owner of the draft write path (plan 22 §2 R1).
 *
 * Before this provider, `useWorkflowSave()` was a plain hook and every one of
 * its ~15 call sites owned a private pending set, a private 5 s debounce timer,
 * a private conflict latch and its own `visibilitychange` + `beforeunload`
 * listeners. Two edits of different kinds therefore scheduled two independent
 * writes that raced each other's compare-and-swap token, and a single 409
 * re-toasted once per copy.
 *
 * Everything now lives here, exactly once:
 *
 * - **one debounce timer** and **one in-flight mutation**, so a tab can no
 *   longer race itself;
 * - **single-flight**: a save queued while one is in flight sets `saveAgain`
 *   and runs *after* the response refreshed `workflow.graphHash`, so the
 *   follow-up carries a fresh CAS token. Every caller awaits the same chain, so
 *   `saveNow()` still resolves on the save that actually persisted its work;
 * - **one conflict latch** → one toast, with a Reload action;
 * - **one** unload listener pair.
 *
 * …and, since phases C–E, the one place that asks whether a save is *worth
 * sending at all*:
 *
 * - **content-guarded, not trigger-guarded** (§2 R2): `runSave` projects the
 *   dehydrated payload graph and drops every half that equals the baseline. A
 *   plain open — with its selection replay, panel mount, measurement writeback
 *   and re-centring pan — produces no request, without anyone having to
 *   enumerate which effect fired;
 * - **one canonical storage form** (§2 R4): the payload graph is the output of
 *   `dehydrateGraph`, built once and used for both the comparison and the body;
 * - **one terminal path** (§2 R5): `pagehide` + a `keepalive` fetch whose
 *   status is read, `markClean` on 2xx only. No `sendBeacon`.
 */
export function WorkflowSaveProvider({ children }: { children: React.ReactNode }) {
  const store = useStoreApi<FlowNode, FlowEdge>()
  const { isReadOnly } = useReadOnly()
  const posthog = useAnalytics()

  const pendingRef = useRef<PendingChanges>({})

  /**
   * Set when a save was rejected with 409 CONFLICT — another tab/user saved the
   * draft after this editor loaded it. Once conflicted, this editor stops
   * saving entirely (autosave, beacon, manual): its in-memory graph is stale
   * and every retry would just re-conflict (or clobber). The user reloads to
   * continue; a reload remounts the provider and clears the flag.
   */
  const conflictRef = useRef(false)

  /**
   * The currently running save chain, or `null` when idle. Its presence IS the
   * single-flight lock — see {@link saveAgainRef}.
   */
  const inFlightRef = useRef<Promise<boolean> | null>(null)

  /** Set when a save is requested mid-flight; drained by the chain's loop. */
  const saveAgainRef = useRef(false)

  const workflowAppId = useWorkflowStore((s) => s.workflowAppId)
  const isDirty = useWorkflowStore((s) => s.isDirty)
  const markClean = useWorkflowStore((s) => s.markClean)
  const markDirty = useWorkflowStore((s) => s.markDirty)

  // Read fresh inside the async chain — `isReadOnly` can flip mid-save (a
  // Kopilot turn takes the draft) and the closure would hold the stale value.
  const isReadOnlyRef = useRef(isReadOnly)
  isReadOnlyRef.current = isReadOnly

  // Single tRPC mutation for all updates
  const updateMutation = api.workflow.update.useMutation({
    onError: (error) => {
      if (error.data?.code === 'CONFLICT') {
        // One latch, one toast — this used to fire once per hook copy.
        if (conflictRef.current) return
        conflictRef.current = true
        toastError({
          title: 'Workflow changed elsewhere',
          description: `${error.message} Your unsaved changes here will not be saved automatically.`,
          actions: [
            {
              label: 'Reload',
              onClick: () => {
                window.location.reload()
              },
            },
          ],
        })
        return
      }
      toastError({
        title: 'Failed to save',
        description: error.message,
      })
    },
    onSuccess: (updatedWorkflow) => {
      // Sync the workflow object from backend response to ensure all fields are
      // up-to-date. Critically, this refreshes `graphHash` — the CAS token the
      // next save (including a queued `saveAgain`) sends.
      useWorkflowStore.getState().setWorkflow(updatedWorkflow)
      markClean()

      // Track workflow save
      if (workflowAppId) {
        const nodes = store.getState().nodes
        posthog?.capture('workflow_updated', {
          workflow_id: workflowAppId,
          node_count: nodes?.length ?? 0,
        })
      }
    },
  })

  /**
   * Build the save payload from the pending set — and, for the halves it
   * carries, the projection the content guard compares.
   *
   * The graph is **dehydrated once** here and that one document is used for
   * both the projection and the request body (plan 22 §2 R2). Projecting the
   * live canvas graph instead would compare the canvas's shape against the
   * server's and report a diff on every open forever, which is the trap that
   * sank the previous attempts.
   */
  const buildRequest = useCallback((): SaveRequest | null => {
    const workflow = useWorkflowStore.getState().workflow
    const metadata = useWorkflowStore.getState().metadata
    const pending = pendingRef.current

    if (!workflow || !metadata || !workflowAppId) return null

    // No "…but the store is dirty, so send the graph" fallback any more. Every
    // consumer now queues the key it actually dirtied (plan 22 §10), and the
    // content guard — not a global boolean — decides whether it is worth a
    // request. The fallback used to turn an env-var or test-input edit into a
    // GRAPH write, losing the change that was actually dirty.
    if (Object.keys(pending).length === 0) return null

    const payload: Record<string, unknown> = { id: workflowAppId }
    const request: SaveRequest = { payload }

    // Graph data
    if (pending.graph) {
      const { nodes, edges } = store.getState()

      // Validation: require at least one node
      if (!nodes || nodes.length === 0) {
        console.warn('Cannot build save payload: no nodes in workflow')
        return null
      }

      // Clean nodes/edges — derived (canvas-owned) keys never persist. The rule
      // lives in lib (`stripDerivedKeys`) so this and the agent's own save seam
      // (`graph-edit/persist.ts` cleanGraphForSave) can never drift apart.
      const cleanNodes = nodes.map((node) => ({
        ...node,
        data: stripDerivedKeys(node.data || {}),
      }))

      const cleanEdges = edges.map((edge) => {
        if (!edge.data) return edge
        const cleanData = stripDerivedKeys(edge.data)
        return { ...edge, data: Object.keys(cleanData).length > 0 ? cleanData : undefined }
      })

      // Detect trigger type from the graph. The derivation and its two
      // load-bearing quirks (manual → FORM; resource-trigger only counts when
      // both operation and entityDefinitionId are set) live in lib
      // (`deriveTriggerColumns`, node-catalog §6b) so every writer computes
      // the same columns. The registry-backed resolver covers what the
      // catalog cannot see yet: not-yet-migrated triggers (webhook,
      // webhook-endpoint) and dynamic app triggers.
      const derived = deriveTriggerColumns(cleanNodes, {
        resolveTriggerType: (nodeType) => unifiedNodeRegistry.getDefinition(nodeType)?.triggerType,
      })
      const triggerType = derived.triggerType ?? workflow.triggerType
      // `null`, not `undefined` — the service only writes the column when the
      // key is not `undefined`, so posting `undefined` for a graph that no
      // longer has a resource trigger left the OLD entity id on the row next
      // to the new trigger type. `null` is the explicit clear.
      const entityDefinitionId = derived.entityDefinitionId ?? null

      // ONE dehydrate, used for the projection AND the body. `viewport` is the
      // value this editor LOADED, verbatim: the payload replaces the whole
      // `graph` object, so posting the live camera would rewrite the authored
      // starting view on every save, and omitting the key would erase it.
      const authoredViewport = useWorkflowStore.getState().authoredViewport
      // DEHYDRATION_OPTIONS is NOT optional here — it is the shared policy every
      // reader is paired with, and passing nothing means storing a differently
      // shaped document from every other writer. It used to be worse than a
      // shape difference: the option it carried deleted real config
      // (`http.method`, `resource-trigger.operation`) on the first canvas save
      // (#1770 → #1771). That layer is deleted; the pairing discipline is not.
      const stored = dehydrateGraph(
        {
          nodes: cleanNodes,
          edges: cleanEdges,
          ...(authoredViewport ? { viewport: authoredViewport } : {}),
        } as Parameters<typeof dehydrateGraph>[0],
        DEHYDRATION_OPTIONS
      )

      payload.graph = stored
      payload.triggerType = triggerType
      payload.entityDefinitionId = entityDefinitionId
      request.graph = projectGraph(stored)

      // Optimistic-concurrency token: hash of the graph this editor loaded or
      // last saved (seeded by `getById`, refreshed from each save's response
      // via `setWorkflow`). ECHOED, never recomputed — the server re-hashes the
      // RAW stored column inside its transaction, so a client-side hash of a
      // hydrated or dehydrated graph would 409 forever.
      const graphHash = (workflow as { graphHash?: string | null }).graphHash
      if (graphHash) payload.expectedGraphHash = graphHash
    }

    // Metadata fields
    if (pending.name !== undefined) payload.name = pending.name
    if (pending.description !== undefined) payload.description = pending.description
    if (pending.icon) payload.icon = pending.icon

    // Access settings
    if (pending.webEnabled !== undefined) payload.webEnabled = pending.webEnabled
    if (pending.apiEnabled !== undefined) payload.apiEnabled = pending.apiEnabled
    if (pending.accessMode) payload.accessMode = pending.accessMode
    if (pending.config) payload.config = pending.config
    if (pending.rateLimit) payload.rateLimit = pending.rateLimit

    // Environment variables
    if (pending.envVars) {
      const envVars = Array.from(useVarStore.getState().environmentVariables.values())
      const variables = useTestInputStore.getState().getVariablesForSave(metadata.id)
      payload.envVars = envVars
      payload.variables = variables
      request.envText = projectEnvVars(envVars, variables)
    }

    return request
  }, [workflowAppId, store])

  /** The public `getWorkflowSavePayload()` — the body only, guard not applied. */
  const buildPayload = useCallback(
    (): Record<string, unknown> | null => buildRequest()?.payload ?? null,
    [buildRequest]
  )

  /**
   * Drop from the request every half whose content equals the baseline, and
   * report whether anything worth sending is left (plan 22 §2 R2).
   *
   * This is the whole plan in one function: a save is content-guarded, not
   * trigger-guarded. Opening a workflow, replaying the restored selection,
   * mounting the panel that selection opens, panning, clicking and every
   * `ResizeObserver` writeback all project to the baseline string and stop
   * here — with no need to enumerate which effect fired.
   */
  const applyContentGuard = useCallback((request: SaveRequest): boolean => {
    const baseline = useWorkflowStore.getState().saveBaseline

    if (request.graph && baseline.graph && request.graph.text === baseline.graph.text) {
      // The graph-derived columns and the CAS token go with it — they cannot
      // have changed if the graph did not.
      delete request.payload.graph
      delete request.payload.triggerType
      delete request.payload.entityDefinitionId
      delete request.payload.expectedGraphHash
      request.graph = undefined
    } else if (request.graph && baseline.graph && process.env.NODE_ENV !== 'production') {
      // Printed at SAVE time regardless of who queued the save (plan 22 §9.2):
      // `handleNodeDataUpdate` queues nothing, so a panel's mount-time write
      // surfaces here with no nearby cause, and an app panel's iframe write is
      // otherwise indistinguishable from a user edit. The node type plus the
      // changed key set is what makes it attributable.
      console.debug(
        '[workflow-save] graph diff vs baseline:',
        diffProjections(baseline.graph.projection, request.graph.projection)
      )
    }

    if (request.envText !== undefined && request.envText === baseline.envText) {
      delete request.payload.envVars
      delete request.payload.variables
      request.envText = undefined
    }

    // `id` is addressing, not content.
    return Object.keys(request.payload).some((key) => key !== 'id')
  }, [])

  /**
   * One round trip. Never call this directly — {@link executeSave} owns the
   * single-flight lock that keeps two of these from overlapping.
   */
  const runSave = useCallback(async (): Promise<boolean> => {
    // Since phase D the pending set is the COMPLETE record of what needs
    // writing — every consumer queues the key it dirtied. Nothing queued is
    // therefore "already up to date", a success: `saveNow()` resolves `true` so
    // the explicit Save and the save-before-run gate
    // (`use-run-single-node.ts:109`) don't report a failure for a workflow with
    // nothing to write. This replaces the old "…but the store is dirty, so send
    // the graph" fallback, which turned an env-var edit into a graph write.
    if (Object.keys(pendingRef.current).length === 0) {
      markClean()
      return true
    }

    const request = buildRequest()
    if (!request) return false

    // THE content test (plan 22 §2 R2). Nothing to send is a success: the
    // editor and the server agree, so the store is clean and no request goes
    // out. This is what makes opening a workflow — and every mount effect the
    // open cascades into — free.
    if (!applyContentGuard(request)) {
      pendingRef.current = {}
      markClean()
      return true
    }

    // Take the keys this request carries BEFORE awaiting: anything queued while
    // the request is in flight belongs to the follow-up save, not to this one.
    const sent = pendingRef.current
    pendingRef.current = {}

    try {
      await updateMutation.mutateAsync(
        request.payload as Parameters<typeof updateMutation.mutateAsync>[0]
      )
      // The second (and only other) place the baseline is set: what we just
      // sent IS what the server now holds. Taken from the request rather than
      // the response so it cannot depend on which fields the router echoes.
      useWorkflowStore.getState().setSaveBaseline({
        ...(request.graph ? { graph: request.graph } : {}),
        ...(request.envText !== undefined ? { envText: request.envText } : {}),
      })
      return true
    } catch {
      // Failed — put this request's keys back under anything queued since.
      pendingRef.current = { ...sent, ...pendingRef.current }
      return false
    }
  }, [buildRequest, applyContentGuard, markClean, updateMutation])

  // Refs so the debounce timer and the in-flight chain always call the latest
  // closures without being re-created (and re-armed) on every render.
  const runSaveRef = useRef(runSave)
  runSaveRef.current = runSave

  /**
   * Execute a save, single-flight.
   *
   * When a save is already in flight the caller does not start a second
   * request: it raises `saveAgain` and joins the running chain, which loops
   * once more after the response has refreshed the CAS token. The returned
   * promise therefore resolves on the save that actually carried the caller's
   * work.
   */
  const executeSave = useCallback((): Promise<boolean> => {
    if (isReadOnlyRef.current) return Promise.resolve(false)

    // A conflicted editor never retries — see conflictRef.
    if (conflictRef.current) return Promise.resolve(false)

    // Check for error state in workflow store
    const workflowError = useWorkflowStore.getState().error
    if (workflowError) {
      console.warn('Skipping save due to error state:', workflowError)
      return Promise.resolve(false)
    }

    if (inFlightRef.current) {
      saveAgainRef.current = true
      return inFlightRef.current
    }

    const chain = (async () => {
      try {
        let ok = await runSaveRef.current()
        while (saveAgainRef.current) {
          saveAgainRef.current = false
          if (conflictRef.current || isReadOnlyRef.current) break
          ok = await runSaveRef.current()
        }
        return ok
      } finally {
        saveAgainRef.current = false
        inFlightRef.current = null
      }
    })()

    inFlightRef.current = chain
    return chain
  }, [])

  const executeSaveRef = useRef(executeSave)
  executeSaveRef.current = executeSave

  /**
   * The one debounce timer for the whole editor — created once, calls the
   * latest `executeSave` through a ref.
   *
   * `maxWait` is what keeps a continuous typing session from never persisting:
   * without it every keystroke pushed the timer out again (plan 22 §5 D3).
   */
  const debouncedSaveRef = useRef(
    debounce(
      () => {
        void executeSaveRef.current()
      },
      DEBOUNCE_MS,
      { maxWait: MAX_WAIT_MS }
    )
  )

  // Cleanup debounced function on unmount
  useEffect(() => {
    const debounced = debouncedSaveRef.current
    return () => {
      debounced.cancel()
    }
  }, [])

  /**
   * Check if value changed from original, and clear pending if reverted to original
   */
  const hasChanged = useCallback((changes: Partial<PendingChanges>): boolean => {
    const workflow = useWorkflowStore.getState().workflow
    let hasActualChanges = false

    // For name: check if different from original
    if (changes.name !== undefined) {
      if (changes.name === workflow?.name) {
        // Reverted to original - remove from pending
        delete pendingRef.current.name
      } else {
        hasActualChanges = true
      }
    }

    // For description: check if different from original
    if (changes.description !== undefined) {
      if (changes.description === workflow?.description) {
        // Reverted to original - remove from pending
        delete pendingRef.current.description
      } else {
        hasActualChanges = true
      }
    }

    // For icon, graph, envVars, access settings - always consider as changed
    if (
      changes.icon ||
      changes.graph ||
      changes.envVars ||
      changes.webEnabled !== undefined ||
      changes.apiEnabled !== undefined ||
      changes.accessMode ||
      changes.config ||
      changes.rateLimit
    ) {
      hasActualChanges = true
    }

    return hasActualChanges
  }, [])

  /**
   * Queue changes and trigger the debounced save.
   *
   * This is the one entry point every consumer funnels through — the React
   * hook's convenience methods and the store-registered handle the non-React
   * stores use both land here, on one pending set and one timer.
   */
  const queueSave = useCallback(
    (changes: Partial<PendingChanges>) => {
      if (isReadOnlyRef.current) return

      // Skip if nothing actually changed
      if (!hasChanged(changes)) return

      // Merge into pending changes
      pendingRef.current = { ...pendingRef.current, ...changes }

      // Only mark dirty if not already dirty (avoid unnecessary re-renders)
      if (!useWorkflowStore.getState().isDirty) {
        markDirty()
      }

      debouncedSaveRef.current()
    },
    [markDirty, hasChanged]
  )

  /**
   * Publish `queueSave` into the workflow store so the non-React callers
   * (`store/edge-store.ts`, `store/use-var-store.ts`, `store/test-input-store.ts`)
   * can reach the one owner — the same way they already reach `markDirty()`.
   * Cleared on unmount: the stores are module-level singletons and must not
   * keep a handle into a torn-down editor.
   */
  useEffect(() => {
    useWorkflowStore.setState({ queueSave })
    return () => {
      // Only drop OUR handle — a remount may already have registered its own.
      if (useWorkflowStore.getState().queueSave === queueSave) {
        useWorkflowStore.setState({ queueSave: null })
      }
    }
  }, [queueSave])

  // Convenience methods for different save operations
  const saveGraph = useCallback(() => queueSave({ graph: true }), [queueSave])

  const saveMetadata = useCallback(
    (updates: { name?: string; description?: string }) => queueSave(updates),
    [queueSave]
  )

  const saveIcon = useCallback(
    (icon: { iconId: string; color: string }) => queueSave({ icon }),
    [queueSave]
  )

  const saveShareSettings = useCallback(
    (
      updates: Pick<
        PendingChanges,
        'webEnabled' | 'apiEnabled' | 'accessMode' | 'config' | 'rateLimit'
      >
    ) => queueSave(updates),
    [queueSave]
  )

  const saveEnvVars = useCallback(() => queueSave({ envVars: true }), [queueSave])

  /**
   * Immediate save - bypass debounce for when user explicitly saves
   */
  const saveNow = useCallback(async () => {
    debouncedSaveRef.current.cancel()
    return executeSave()
  }, [executeSave])

  /**
   * Cancel any pending save operations
   */
  const cancelPendingSave = useCallback(() => {
    debouncedSaveRef.current.cancel()
    pendingRef.current = {}
  }, [])

  /**
   * Every read-only clamp the unload paths have to respect, read fresh — these
   * fire from listeners, long after the memoized `isReadOnly` closed over its
   * value (plan 30 §4).
   */
  const isEditableNow = useCallback((): boolean => {
    if (conflictRef.current) return false
    if (isReadOnlyRef.current) return false
    if (useCanvasStore.getState().readOnly) return false

    const workflowState = useWorkflowStore.getState()
    if (workflowState.isViewerMode || workflowState.instanceReadOnly) return false

    const runState = useRunStore.getState()
    if (runState.runViewMode === 'previous') return false // viewing history
    if (runState.runViewMode === 'live' && runState.isRunning) return false // live execution

    return true
  }, [])

  /**
   * The request a terminal write would send, or `null` when the editor and the
   * server already agree. Also the `beforeunload` confirm dialog's test (plan
   * 22 §5 D4): it used to fire on a stale `isDirty`, i.e. after a pan.
   */
  const buildTerminalRequest = useCallback((): SaveRequest | null => {
    if (!isEditableNow()) return null

    // Anything queued but not yet flushed, plus the graph — the debounce may
    // have been armed for something else, and this is the last chance.
    const pending = { ...pendingRef.current, graph: true }
    const restore = pendingRef.current
    pendingRef.current = pending

    const request = buildRequest()
    pendingRef.current = restore

    if (!request || !applyContentGuard(request)) return null
    return request
  }, [isEditableNow, buildRequest, applyContentGuard])

  /**
   * The ONE terminal write (plan 22 §2 R5).
   *
   * This used to be `navigator.sendBeacon` — a real authenticated write whose
   * response was never read, followed by `markClean()` on the beacon merely
   * being *queued*. That advanced the row while the tab kept the pre-write CAS
   * token, so every later save 409'd until reload: the actual cause of the
   * conflicts this plan was written for. It was also wired to
   * `visibilitychange → hidden`, which is not a page close — it fires on every
   * tab switch and window occlusion, dozens of times an hour.
   *
   * Now: `pagehide` only, a `keepalive` fetch whose status is read, `markClean`
   * on 2xx alone, and gated on a real content diff. A 409 here is harmless —
   * the page is gone and there is no token left to poison.
   */
  const syncWorkflowWhenPageClose = useCallback(() => {
    const request = buildTerminalRequest()
    if (!request) return

    void fetch(`/api/workflows/${workflowAppId}`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.payload),
    })
      .then((response) => {
        // 2xx ONLY. A rejected CAS or a 500 means the work did not land, and
        // claiming otherwise is what made the UI say "saved" over dropped work.
        if (!response.ok) return
        pendingRef.current = {}
        markClean()
      })
      .catch(() => {
        // The page is unloading; a network error here has nowhere to be shown.
      })
  }, [buildTerminalRequest, workflowAppId, markClean])

  /**
   * The editor's ONE unload listener set — this used to be ~15 of them, each
   * firing its own beacon for the same graph.
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      // A hidden tab COMES BACK. Flush the debounce through the normal tRPC
      // path so the response refreshes the CAS token, instead of firing a
      // blind write the tab never learns the outcome of.
      if (document.visibilityState === 'hidden') {
        debouncedSaveRef.current.flush()
      }
    }

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Gated on a real content diff, not on `isDirty`.
      if (!buildTerminalRequest()) return
      e.preventDefault()
      return ''
    }

    const handlePageHide = () => {
      syncWorkflowWhenPageClose()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', handlePageHide)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [buildTerminalRequest, syncWorkflowWhenPageClose])

  const isSaving = updateMutation.isPending

  const value = useMemo<WorkflowSaveApi>(
    () => ({
      saveGraph,
      saveMetadata,
      saveIcon,
      saveShareSettings,
      saveEnvVars,
      saveNow,
      cancelPendingSave,

      // Backwards compatibility (for existing code that uses these)
      save: saveNow,
      debouncedSave: saveGraph,
      getWorkflowSavePayload: buildPayload,
      syncWorkflowWhenPageClose,

      // State
      isDirty,
      isSaving,
    }),
    [
      saveGraph,
      saveMetadata,
      saveIcon,
      saveShareSettings,
      saveEnvVars,
      saveNow,
      cancelPendingSave,
      buildPayload,
      syncWorkflowWhenPageClose,
      isDirty,
      isSaving,
    ]
  )

  return <WorkflowSaveContext.Provider value={value}>{children}</WorkflowSaveContext.Provider>
}

/**
 * The save owner's API, or a no-op surface outside the editor.
 *
 * Consumers should import `useWorkflowSave` from `../hooks` — this is the
 * context read it delegates to.
 */
export function useWorkflowSaveContext(): WorkflowSaveApi {
  return useContext(WorkflowSaveContext) ?? NOOP_SAVE_API
}
