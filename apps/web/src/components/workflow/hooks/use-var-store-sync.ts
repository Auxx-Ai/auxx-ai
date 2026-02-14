// apps/web/src/components/workflow/hooks/use-var-store-sync.ts

import { useStore, useStoreApi } from '@xyflow/react'
import { useCallback, useEffect, useRef } from 'react'
import { shallow } from 'zustand/shallow'
import { useVarStore } from '../store/use-var-store'
import type { BaseType, UnifiedVariable } from '../types'

/**
 * Hook to sync ReactFlow state with the variable store
 * Optimized for performance with minimal re-renders
 */
export function useVarStoreSync() {
  const syncWithReactFlow = useVarStore((state) => state.actions.syncWithReactFlow)
  const store = useStoreApi()
  const hasInitializedRef = useRef(false)
  const lastNodesLengthRef = useRef(0)
  const lastEdgesLengthRef = useRef(0)

  // Manual sync trigger
  const triggerSync = useCallback(() => {
    const { nodes, edges } = store.getState()
    syncWithReactFlow(nodes, edges)
  }, [store, syncWithReactFlow])

  // Expose manual trigger globally for other components to use
  useEffect(() => {
    ;(window as any).triggerVarStoreSync = triggerSync
    return () => {
      delete (window as any).triggerVarStoreSync
    }
  }, [triggerSync])

  // Mark as initialized to prevent duplicate initial syncs
  useEffect(() => {
    hasInitializedRef.current = true
  }, [])

  // 2. Structure change sync - only when nodes/edges count changes
  const nodesLength = useStore((state) => state.nodes.length)
  const edgesLength = useStore((state) => state.edges.length)

  useEffect(() => {
    // Skip if this is the initial load
    if (!hasInitializedRef.current) return

    // Only sync if the count actually changed
    if (nodesLength !== lastNodesLengthRef.current || edgesLength !== lastEdgesLengthRef.current) {
      lastNodesLengthRef.current = nodesLength
      lastEdgesLengthRef.current = edgesLength

      const { nodes, edges } = store.getState()
      syncWithReactFlow(nodes, edges)
    }
  }, [nodesLength, edgesLength, store, syncWithReactFlow])

  // 3. Periodic sync - every 5 seconds to catch config changes
  useEffect(() => {
    const interval = setInterval(() => {
      if (hasInitializedRef.current) {
        triggerSync()
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [triggerSync])
}

/**
 * Hook to detect if a node is inside a loop
 * Provides efficient loop context detection
 */
export function useLoopDetection(nodeId: string) {
  // Subscribe only to relevant data for loop detection
  const loopData = useStore((state) => {
    const node = state.nodes.find((n) => n.id === nodeId)
    if (!node) return null

    // Find parent loop if exists
    const parentLoop = node.parentId ? state.nodes.find((n) => n.id === node.parentId) : null

    // Find edges that indicate loop membership
    const incomingEdges = state.edges.filter((e) => e.target === nodeId)

    // Build parent chain for nested loop detection
    const parentChain: Array<{ id: string; type?: string; data?: any }> = []
    let current = node
    while (current?.parentId) {
      const parent = state.nodes.find((n) => n.id === current!.parentId)
      if (parent) {
        parentChain.push({ id: parent.id, type: parent.type, data: parent.data })
        current = parent
      } else {
        break
      }
    }

    return {
      node: { id: node.id, type: node.type, parentId: node.parentId },
      parentLoop: parentLoop?.type === 'loop' ? parentLoop : null,
      hasLoopStartConnection: incomingEdges.some((e) => e.sourceHandle === 'loop-start'),
      parentChain,
    }
  }, shallow)

  // Calculate loop contexts
  const loopContexts = useStore((state) => {
    if (!loopData) return []

    const contexts = []

    // Walk up parent chain to find all loop contexts
    for (const parent of loopData.parentChain) {
      if (parent.type === 'loop') {
        contexts.push({
          loopNodeId: parent.id,
          iteratorName: parent.data?.iteratorName || 'item',
          iteratorType: parent.data?.iteratorType,
          depth: contexts.length,
        })
      }
    }

    return contexts.reverse() // Return outer to inner order
  }, shallow)

  return {
    isInLoop: loopContexts.length > 0,
    contexts: loopContexts,
    isDirectlyInLoop: loopData?.hasLoopStartConnection || false,
  }
}

/**
 * Hook to get available variables for a node with loop awareness
 */
export function useNodeAvailableVariables(nodeId: string) {
  const availableVars = useVarStore(
    (state) => state.availabilityCache.get(nodeId)?.availableVariables
  )

  // Don't trigger recalculation here - let the sync handle it
  // This prevents infinite loops when cache is empty

  return availableVars || []
}

/**
 * Hook to get a specific variable by ID with proper subscriptions
 * @param variableId - The ID of the variable to fetch
 * @param nodeId - Optional node ID to check if variable is available upstream
 * @returns Object with variable and isValid flag
 */
export function useVariable(
  variableIdIn: string | undefined | number,
  nodeId?: string
): {
  variable: UnifiedVariable | undefined
  isValid: boolean
  isEnvVar: boolean
  isSystemVar: boolean
  isNodeVar: boolean
} {
  // Ensure variableId is always a string for consistent lookups
  const variableId = variableIdIn !== undefined && variableIdIn !== null ? String(variableIdIn) : ''
  // Subscribe to the specific maps that might contain this variable
  const regularVar = useVarStore((state) => state.variables.get(variableId))
  const envVar = useVarStore((state) => {
    return variableId?.startsWith('env.') ? state.environmentVariables.get(variableId) : undefined
  })
  const sysVar = useVarStore((state) => state.systemVariables.get(variableId))

  // If nodeId is provided, check if the variable is available to this node
  const availableVars = useVarStore((state) =>
    nodeId ? state.availabilityCache.get(nodeId)?.availableVariables : undefined
  )

  // Helper to check if variable is available
  const isAvailable = (variable: UnifiedVariable | undefined, category: string) => {
    if (!variable || !nodeId || !availableVars) return true // If no nodeId, assume available
    // Environment and system variables are always valid
    if (category === 'environment' || category === 'system') return true
    // Node variables must be in the availability cache
    return availableVars.some((v) => v.id === variable.id)
  }

  // Check regular variables
  if (regularVar) {
    const isValid = isAvailable(regularVar, 'node')
    return { variable: regularVar, isValid, isEnvVar: false, isSystemVar: false, isNodeVar: true }
  }

  // Check environment variables
  if (envVar) {
    // Convert EnvVar to UnifiedVariable format
    const envVarId = envVar.id || `env.${envVar.name}`
    const unifiedEnvVar = {
      id: envVarId,
      // Deprecated fields for backward compatibility (will be removed in Phase 4)
      // path: getPathFromVariableId(envVarId),
      // fullPath: envVarId,
      // nodeId: 'env',
      // End deprecated fields
      label: envVar.name,
      type: (envVar.type || 'string') as BaseType,
      category: 'environment' as const,
      description: (envVar as any).description || '',
    } as UnifiedVariable

    return {
      variable: unifiedEnvVar,
      isValid: true,
      isEnvVar: true,
      isSystemVar: false,
      isNodeVar: false,
    }
  }

  // Check system variables
  if (sysVar) {
    return { variable: sysVar, isValid: true, isEnvVar: false, isSystemVar: true, isNodeVar: false }
  }

  return {
    variable: undefined,
    isValid: false,
    isEnvVar: false,
    isSystemVar: false,
    isNodeVar: false,
  }
}
