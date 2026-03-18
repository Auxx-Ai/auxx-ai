// apps/web/src/components/workflow/hooks/use-var-store-sync.ts

import { useStoreApi } from '@xyflow/react'
import { useEffect } from 'react'
import { unifiedNodeRegistry } from '../nodes/unified-registry'
import { useVarStore } from '../store/use-var-store'
import type { EdgeMeta, NodeMeta } from '../store/var-graph'

/**
 * Event-driven sync bridge between ReactFlow and the variable store.
 * Replaces the old 5s polling with RAF-debounced subscription.
 */
export function useVarStoreSync() {
  const store = useStoreApi()
  const updateGraph = useVarStore((s) => s.actions.updateGraph)

  // ReactFlow subscription — fires on any store change
  useEffect(() => {
    let rafId: number | null = null

    const unsub = store.subscribe((state, prevState) => {
      // Early bail-out: skip pan/zoom/selection (reference equality check)
      if (state.nodes === prevState.nodes && state.edges === prevState.edges) return

      // Debounce with RAF to batch rapid changes (e.g., drag operations)
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        rafId = null
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
