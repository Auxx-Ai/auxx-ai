// apps/web/src/components/workflow/viewer/providers/viewer-var-store-sync-provider.tsx

'use client'

import { useNodesInitialized, useStoreApi } from '@xyflow/react'
import type React from 'react'
import { useEffect, useRef } from 'react'
import { useVarStore } from '../../store/use-var-store'
import type { EdgeMeta, NodeMeta } from '../../store/var-graph'

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
 * Read-only var store sync provider for the workflow viewer.
 * Performs one-time initialization and sync, no ongoing subscriptions.
 */
export function ViewerVarStoreSyncProvider({
  children,
  environmentVariables,
}: ViewerVarStoreSyncProviderProps) {
  const initializeStore = useVarStore((state) => state.actions.initializeStore)
  const updateGraph = useVarStore((state) => state.actions.updateGraph)
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
        hasInitialized.current = true
      }
    }
  }, [nodesInitialized, store, updateGraph])

  return <>{children}</>
}
