// apps/web/src/components/workflow/hooks/use-workflow-draft-realtime.ts

'use client'

import { useCallback, useRef } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { storeEventBus } from '../store/event-bus'
import { useWorkflowStore } from '../store/workflow-store'
import { useHistoryManager } from '../store/workflow-store-provider'
import type { FlowEdge, FlowNode } from '../types'
import { applyFetchedWorkflow, type FetchedWorkflow } from './use-workflow-init'

/** Payload of the org-channel `workflow:draft-updated` event (lib `realtime/events.ts`). */
interface WorkflowDraftUpdatedPayload {
  workflowAppId?: string
  nodeIds?: string[]
  reason?: 'kopilot' | 'system'
}

/**
 * Subscribe the open builder to `workflow:draft-updated` — fired on the org
 * channel after every server-side draft write outside the canvas's own save
 * path (Kopilot graph mutations, the failed-turn revert). This is the
 * realtime-refresh mechanism for builder UIs: signal only, the canvas
 * refetches the draft; nothing in the payload is applied directly.
 *
 * Clean canvas (`!isDirty`): refetch the draft, rehydrate through THE shared
 * graph→store mapping ({@link applyFetchedWorkflow} — the same path initial
 * load uses, which also refreshes the `graphHash` CAS token so later canvas
 * saves don't 409), replace the canvas via the `workflow:externalUpdate` bus
 * seam, then record ONE full-snapshot history entry so the Kopilot turn is a
 * normal Cmd+Z step. Recorded directly via the history manager — never through
 * `use-save-to-history`'s 2s-debounced recorder, so a quick follow-up user
 * edit can't merge into it. Undoing that entry marks the store dirty (the
 * history-restore wrapper in `workflow-history-provider.tsx` does that), so
 * the undone state is saveable.
 *
 * Dirty canvas: the event is ignored — the server-side dirty gate already
 * refuses Kopilot mutations while the chip reports dirty, and a `system`
 * event (e.g. a turn revert racing a fresh local edit) must not clobber
 * unsaved work. The next manual save wins via the graph-hash CAS.
 *
 * The publish carries no `excludeSocketId` (the write comes from the server,
 * not another tab), so the emitting user's own builder receives it too —
 * that is the point.
 *
 * Mount once inside the editor (needs `WorkflowStoreProvider` for the
 * history manager).
 */
export function useWorkflowDraftRealtime(): void {
  const historyManager = useHistoryManager()

  // Kopilot turns publish one event per graph mutation, so events arrive in
  // bursts. Coalesce: one fetch in flight, and a burst member that lands
  // mid-fetch queues exactly one trailing re-run so the canvas ends on the
  // final server state.
  const inflightRef = useRef(false)
  const pendingReasonRef = useRef<'kopilot' | 'system' | null>(null)

  const rehydrate = useCallback(
    async (reason: 'kopilot' | 'system') => {
      pendingReasonRef.current = reason
      if (inflightRef.current) return
      inflightRef.current = true
      try {
        while (pendingReasonRef.current) {
          const runReason = pendingReasonRef.current
          pendingReasonRef.current = null

          const { workflowAppId, isDirty } = useWorkflowStore.getState()
          if (!workflowAppId || isDirty) return

          const response = await fetch(`/api/workflows/${workflowAppId}`)
          if (!response.ok) return
          const workflow = (await response.json()) as FetchedWorkflow

          // Re-check after the await: local edits made while the fetch was in
          // flight win, and a workflow switch means this response is stale.
          const state = useWorkflowStore.getState()
          if (state.isDirty || state.workflowAppId !== workflowAppId) return

          const { nodes, edges } = applyFetchedWorkflow(workflow)

          // Replace the canvas through the external-update seam (the canvas
          // owns its React Flow state); viewport untouched on purpose.
          storeEventBus.emit({ type: 'workflow:externalUpdate', data: { nodes, edges } })

          // ONE undo step for the whole rehydrate — same full-snapshot
          // `workflow_event` shape `use-save-to-history` records, but written
          // immediately so no debounced user edit can merge into it.
          historyManager.record({
            action: 'workflow_event',
            store: 'workflow',
            data: {
              event: 'ExternalDraftUpdate',
              nodes: nodes.map(cloneNodeForHistory),
              edges: edges.map(cloneEdgeForHistory),
            },
            label: runReason === 'kopilot' ? 'Kopilot edit' : 'Workflow updated',
          })
        }
      } finally {
        inflightRef.current = false
      }
    },
    [historyManager]
  )

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'workflow:draft-updated') return
      const data = (payload ?? {}) as WorkflowDraftUpdatedPayload
      const { workflowAppId, isDirty } = useWorkflowStore.getState()
      if (!workflowAppId || data.workflowAppId !== workflowAppId) return
      if (isDirty) return
      void rehydrate(data.reason === 'kopilot' ? 'kopilot' : 'system')
    },
    [rehydrate]
  )

  useOrgChannel({ onEvent })
}

/** Shallow-clone a node for the history snapshot so later canvas mutations can't rewrite it. */
function cloneNodeForHistory(node: FlowNode): FlowNode {
  return {
    ...node,
    position: { ...node.position },
    data: node.data ? { ...node.data } : node.data,
  }
}

/** Shallow-clone an edge for the history snapshot. */
function cloneEdgeForHistory(edge: FlowEdge): FlowEdge {
  return { ...edge, data: edge.data ? { ...edge.data } : undefined }
}
