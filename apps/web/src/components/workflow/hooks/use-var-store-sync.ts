// apps/web/src/components/workflow/hooks/use-var-store-sync.ts

import type { EdgeMeta, NodeMeta } from '@auxx/lib/workflow-engine/client'
import { useStoreApi } from '@xyflow/react'
import { useEffect } from 'react'
import { unifiedNodeRegistry } from '../nodes/unified-registry'
import { useVarStore } from '../store/use-var-store'
import type { FlowEdge, FlowNode } from '../types'

/**
 * Whether two node arrays are equivalent *for variable purposes*.
 *
 * A node's coordinates cannot affect any variable, but `handleNodeDrag` replaces
 * the whole node array on every pointer frame, so whole-array reference equality
 * never holds during a drag. Comparing each node's `data` reference and
 * `parentId` (in order, so an id change or a reorder counts as changed) is a
 * reference scan rather than a deep compare: immer structural sharing in
 * `use-node-data-update` keeps an untouched node's `data` reference intact.
 */
function nodesEqualForVariables(next: FlowNode[], prev: FlowNode[]): boolean {
  if (next === prev) return true
  if (next.length !== prev.length) return false

  for (let i = 0; i < next.length; i++) {
    const a = next[i]
    const b = prev[i]
    if (!a || !b) return false
    if (a.id !== b.id || a.data !== b.data || a.parentId !== b.parentId) return false
  }

  return true
}

/**
 * Event-driven sync bridge between ReactFlow and the variable store.
 * Replaces the old 5s polling with RAF-debounced subscription.
 */
export function useVarStoreSync() {
  const store = useStoreApi<FlowNode, FlowEdge>()
  const updateGraph = useVarStore((s) => s.actions.updateGraph)

  // ReactFlow subscription — fires on any store change
  useEffect(() => {
    let rafId: number | null = null

    const syncFromState = (state: ReturnType<typeof store.getState>) => {
      const nodes: NodeMeta[] = state.nodes.map((n) => ({
        id: n.id,
        type: n.data?.type || n.type || '',
        data: n.data,
        parentId: n.parentId,
      }))
      const edges: EdgeMeta[] = state.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        data: e.data,
      }))
      updateGraph(nodes, edges)
    }

    // Initial sync — the subscription below only fires on *changes*, and the
    // graph is already in the ReactFlow store by the time this mounts. Without
    // this the variable store stays empty on a fresh load and every variable
    // tag renders "Unknown Var" until something happens to mutate nodes/edges.
    syncFromState(store.getState())

    const unsub = store.subscribe((state, prevState) => {
      // Early bail-out: skip pan/zoom/selection, and skip position-only changes
      // (a drag frame) — neither can affect a variable.
      if (state.edges === prevState.edges && nodesEqualForVariables(state.nodes, prevState.nodes)) {
        return
      }

      // Debounce with RAF to batch rapid changes (e.g., drag operations)
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        rafId = null
        syncFromState(state)
      })
    })

    return () => {
      unsub()
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [store, updateGraph])

  // Registry subscription — handles extension node async registration
  useEffect(() => {
    return unifiedNodeRegistry.subscribe((changedIds: string[]) => {
      useVarStore.getState().actions.handleRegistryUpdate(changedIds)
    })
  }, [])
}

// Re-export hooks from use-variable.ts for backward compatibility
export { useLoopDetection, useNodeAvailableVariables, useVariable } from './use-variable'
