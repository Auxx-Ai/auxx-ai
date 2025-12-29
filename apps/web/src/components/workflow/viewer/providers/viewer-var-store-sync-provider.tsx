// apps/web/src/components/workflow/viewer/providers/viewer-var-store-sync-provider.tsx

'use client'

import React, { useEffect, useRef } from 'react'
import { useVarStore } from '../../store/use-var-store'
import { useStoreApi, useNodesInitialized } from '@xyflow/react'

/** Sanitized environment variable from public API */
interface SanitizedEnvVar {
  id: string
  name: string
  type: string
}

interface ViewerVarStoreSyncProviderProps {
  children: React.ReactNode
  /** Environment variables from the public API (values already sanitized) */
  environmentVariables?: SanitizedEnvVar[]
}

/**
 * Read-only var store sync provider for the workflow viewer
 * Performs one-time initialization and sync, no ongoing subscriptions
 */
export function ViewerVarStoreSyncProvider({
  children,
  environmentVariables,
}: ViewerVarStoreSyncProviderProps) {
  const initializeStore = useVarStore((state) => state.actions.initializeStore)
  const syncWithReactFlow = useVarStore((state) => state.actions.syncWithReactFlow)
  const store = useStoreApi()
  const nodesInitialized = useNodesInitialized()
  const hasInitialized = useRef(false)

  // Initialize the store on mount with sanitized environment variables
  useEffect(() => {
    if (hasInitialized.current) return

    initializeStore({
      environmentVariables: environmentVariables?.map((envVar) => ({
        id: envVar.id || `env.${envVar.name}`,
        name: envVar.name,
        value: '***', // Masked for security in viewer
        type: envVar.type || 'string',
      })),
    })
  }, [initializeStore, environmentVariables])

  // Perform one-time sync when nodes are initialized
  useEffect(() => {
    if (nodesInitialized && !hasInitialized.current) {
      const { nodes, edges } = store.getState()
      if (nodes.length > 0) {
        syncWithReactFlow(nodes, edges)
        hasInitialized.current = true
      }
    }
  }, [nodesInitialized, store, syncWithReactFlow])

  return <>{children}</>
}
