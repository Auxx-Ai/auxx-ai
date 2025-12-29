// apps/web/src/components/workflow/providers/var-store-sync-provider.tsx

import React, { useEffect, useRef } from 'react'
import { useVarStoreSync } from '../hooks/use-var-store-sync'
import { useVarStore } from '../store/use-var-store'
import { useStoreApi, useNodesInitialized } from '@xyflow/react'

interface VarStoreSyncProviderProps {
  children: React.ReactNode
}

/**
 * Provider component that sets up variable store synchronization with ReactFlow
 * This should be placed inside ReactFlowProvider but outside the main workflow components
 */
export function VarStoreSyncProvider({ children }: VarStoreSyncProviderProps) {
  const initializeStore = useVarStore((state) => state.actions.initializeStore)
  const syncWithReactFlow = useVarStore((state) => state.actions.syncWithReactFlow)
  const store = useStoreApi()
  const nodesInitialized = useNodesInitialized()
  const hasTriggeredInitialSync = useRef(false)

  // Initialize the store on mount
  useEffect(() => {
    initializeStore()
  }, [initializeStore])

  // Trigger initial sync when nodes are initialized in React Flow
  useEffect(() => {
    if (nodesInitialized && !hasTriggeredInitialSync.current) {
      const { nodes, edges } = store.getState()
      if (nodes.length > 0) {
        console.log('Initial sync triggered - nodes initialized in ReactFlow', {
          nodesCount: nodes.length,
          edgesCount: edges.length,
        })
        syncWithReactFlow(nodes, edges)
        hasTriggeredInitialSync.current = true
      }
    }
  }, [nodesInitialized, store, syncWithReactFlow])

  // Set up the sync between ReactFlow and var store
  useVarStoreSync()

  return <>{children}</>
}
