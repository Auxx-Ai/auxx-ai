// apps/web/src/components/workflow/providers/var-store-sync-provider.tsx

import { useNodesInitialized, useStoreApi } from '@xyflow/react'
import type React from 'react'
import { useEffect, useRef } from 'react'
import { useVarStoreSync } from '../hooks/use-var-store-sync'
import { useVarStore } from '../store/use-var-store'
import type { EdgeMeta, NodeMeta } from '../store/var-graph'

interface VarStoreSyncProviderProps {
  children: React.ReactNode
}

/**
 * Provider component that sets up variable store synchronization with ReactFlow.
 * Mounts the event-driven sync hook and performs initial graph sync.
 */
export function VarStoreSyncProvider({ children }: VarStoreSyncProviderProps) {
  const initializeStore = useVarStore((state) => state.actions.initializeStore)
  const updateGraph = useVarStore((state) => state.actions.updateGraph)
  const store = useStoreApi()
  const nodesInitialized = useNodesInitialized()
  const hasTriggeredInitialSync = useRef(false)

  // Initialize the store on mount
  useEffect(() => {
    initializeStore()
  }, [initializeStore])

  // Initial sync when nodes are initialized (review finding #3: explicit initial call)
  useEffect(() => {
    if (nodesInitialized && !hasTriggeredInitialSync.current) {
      const { nodes, edges } = store.getState()
      if (nodes.length > 0) {
        const nodeMetas: NodeMeta[] = nodes.map((n) => ({
          id: n.id,
          type: n.data?.type || n.type || '',
          data: n.data,
          parentId: n.parentId,
        }))
        const edgeMetas: EdgeMeta[] = edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          data: e.data,
        }))
        updateGraph(nodeMetas, edgeMetas)
        hasTriggeredInitialSync.current = true
      }
    }
  }, [nodesInitialized, store, updateGraph])

  // Set up event-driven sync
  useVarStoreSync()

  return <>{children}</>
}
