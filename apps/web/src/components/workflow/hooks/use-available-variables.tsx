// apps/web/src/components/workflow/hooks/use-available-variables-v2.ts

import { useStore } from '@xyflow/react'
import { Globe, Repeat, Settings } from 'lucide-react'
import { useCallback, useMemo, useRef } from 'react'
import type { UnifiedVariable, VariableGroup } from '~/components/workflow/types/variable-types'
import {
  getNodeIdFromVariableId,
  getPathFromVariableId,
} from '~/components/workflow/utils/variable-utils'
import { unifiedNodeRegistry } from '../nodes/unified-registry'
import type { LoopContext } from '../store/use-var-store'
import { useVarStore } from '../store/use-var-store'
import type { BaseType } from '../types/unified-types'
import { getIcon } from '../utils/icon-helper'
import { useNodeAvailableVariables } from './use-var-store-sync'

/** Stable empty array to avoid creating new references */
const EMPTY_LOOP_CONTEXTS: LoopContext[] = []

interface UseAvailableVariablesOptions {
  nodeId: string
  expectedTypes?: string[] | BaseType[]
  includeEnvironment?: boolean
  includeSystem?: boolean
  includeLoops?: boolean
}

/**
 * Hook to get all available variables for a node using the new var store
 */
export function useAvailableVariables({
  nodeId,
  expectedTypes,
  includeEnvironment = true,
  includeSystem = true,
  includeLoops = true,
}: UseAvailableVariablesOptions) {
  const availableVariables = useNodeAvailableVariables(nodeId)

  // Get loop detection info from node data directly
  const isInLoop = useStore(
    useCallback(
      (state) => {
        const node = state.nodes.find((n) => n.id === nodeId)
        return node?.data?.isInLoop || false
      },
      [nodeId]
    )
  )
  // Get loop contexts from var store (previously hardcoded to empty array)
  // This enables loop variable visibility for nodes inside loops
  // Use stable empty array to prevent re-renders when Map returns undefined
  const contexts = useVarStore((state) => state.loopContexts.get(nodeId)) ?? EMPTY_LOOP_CONTEXTS

  // Get environment and system variables as arrays with memoization
  const envVariablesMap = useVarStore((state) => state.environmentVariables)
  const sysVariablesMap = useVarStore((state) => state.systemVariables)

  // Convert Maps to arrays only when they change
  const envVariables = useMemo(
    () => (includeEnvironment ? Array.from(envVariablesMap.values()) : []),
    [envVariablesMap, includeEnvironment]
  )

  const sysVariables = useMemo(
    () => (includeSystem ? Array.from(sysVariablesMap.values()) : []),
    [sysVariablesMap, includeSystem]
  )

  // Filter variables by type if specified
  const filteredVariables = useMemo(() => {
    if (!expectedTypes || expectedTypes.length === 0) {
      return availableVariables
    }

    return availableVariables.filter((variable) => {
      return expectedTypes.includes(variable.type)
    })
  }, [availableVariables, expectedTypes])

  // Cache for nodeTitlesMap to prevent re-renders during dragging
  // Only recalculate when titles or types actually change, not positions
  const nodeTitlesMapRef = useRef<Record<string, { title: string; type: string }>>({})
  const nodeTitlesMapHashRef = useRef<string>('')

  const nodeTitlesMap = useStore(
    useCallback((state) => {
      // Build new map
      const newMap = state.nodes.reduce(
        (acc, node) => {
          acc[node.id] = {
            title: (node.data?.title || node.data?.label || node.id) as string,
            type: (node.data?.type || 'unknown') as string,
          }
          return acc
        },
        {} as Record<string, { title: string; type: string }>
      )

      // Create hash of titles/types to detect actual changes
      const newHash = state.nodes
        .map(
          (n) => `${n.id}:${n.data?.title || n.data?.label || n.id}:${n.data?.type || 'unknown'}`
        )
        .sort()
        .join('|')

      // Only update if hash changed (titles/types actually changed)
      if (newHash !== nodeTitlesMapHashRef.current) {
        nodeTitlesMapHashRef.current = newHash
        nodeTitlesMapRef.current = newMap
      }

      return nodeTitlesMapRef.current
    }, [])
  )

  // Group variables by source
  const groupedVariables = useMemo(() => {
    const groups: VariableGroup[] = []
    const nodeGroups = new Map<string, UnifiedVariable[]>()

    // Group node variables by nodeId (derived from variable.id)
    // Only include top-level variables in groups (exclude nested children)
    filteredVariables.forEach((variable) => {
      if (variable.category === 'node') {
        const variableNodeId = getNodeIdFromVariableId(variable.id)
        const variablePath = getPathFromVariableId(variable.id)

        // Only include top-level variables in groups
        // Nested variables like "ticket.id" should be excluded (shown when navigating into parent)
        // Array item templates like "contact[*]" should also be excluded (only accessible via parent array)
        const pathWithoutArrays = variablePath.replace(/\[\*\]/g, '')
        const isTopLevel = !pathWithoutArrays.includes('.') && !variablePath.includes('[*]')

        if (isTopLevel) {
          const existing = nodeGroups.get(variableNodeId) || []
          existing.push(variable)
          nodeGroups.set(variableNodeId, existing)
        }
      }
    })

    // Create groups for node variables
    let order = 0
    nodeGroups.forEach((variables, sourceNodeId) => {
      // Get node info from memoized map
      const nodeInfo = nodeTitlesMap[sourceNodeId]
      const nodeTitle = nodeInfo?.title || sourceNodeId
      const nodeType = nodeInfo?.type || 'unknown'

      const nodeDef = unifiedNodeRegistry.getDefinition(nodeType)

      groups.push({
        id: `node-${sourceNodeId}`,
        // nodeId: sourceNodeId,
        name: String(nodeTitle),
        type: 'node',
        nodeType,
        icon: nodeDef?.icon ? getIcon(nodeDef.icon) : undefined,
        order: order++,
        variables,
        color: nodeDef?.color || '#6B7280',
      })
    })

    // Add loop variables group if in loop
    if (isInLoop && includeLoops && contexts.length > 0) {
      const loopVars = filteredVariables.filter((v) => {
        if (v.category !== 'node') return false
        const variableNodeId = getNodeIdFromVariableId(v.id)

        // Check if this variable belongs to any of our loop contexts
        return contexts.some((ctx) => {
          if (ctx.loopNodeId !== variableNodeId) return false

          const variablePath = getPathFromVariableId(v.id)

          // Loop variables use the same structure-based filtering as regular node variables.
          // Any top-level variable (no dots in path) from a loop node is included in the
          // "Loop Variables" group. This ensures:
          // - No name-based assumptions (works with any variable names, even if Contact has "index" field)
          // - Consistent with regular variable handling
          // - Automatically includes new loop variables without code changes
          const pathWithoutArrays = variablePath.replace(/\[\*\]/g, '')
          const isTopLevel = !pathWithoutArrays.includes('.') && !variablePath.includes('[*]')

          return isTopLevel
        })
      })

      if (loopVars.length > 0) {
        // For single loop, use simpler naming
        const contextName =
          contexts.length === 1 ? 'Loop Variables' : `Loop Variables (${contexts.length} levels)`

        groups.push({
          id: 'loop-context',
          // nodeId: contexts[0]?.loopNodeId || '',
          name: contextName,
          type: 'loop',
          icon: <Repeat className='size-4' />,
          order: -1, // Show at top
          variables: loopVars,
          color: '#8B5CF6',
        })
      }
    }

    // Add environment variables group
    if (includeEnvironment && envVariables.length > 0) {
      const envVars: UnifiedVariable[] = envVariables.map((env) => {
        const envId = env.id || `env.${env.name}` // Use dot notation, not underscore
        return {
          id: envId,
          // nodeId: 'env', // Derived from ID
          path: getPathFromVariableId(envId), // Derived from ID
          // fullPath: envId, // Same as ID
          label: env.name,
          type: (env.type || 'string') as BaseType,
          category: 'environment' as const,
          description: '', // EnvVar doesn't have description field
        }
      })

      groups.push({
        id: 'environment',
        // nodeId: '',
        name: 'Environment Variables',
        type: 'environment',
        icon: <Settings className='size-4' />,
        order: 1000,
        variables: envVars,
        color: '#10B981',
      })
    }

    // Add system variables group
    if (includeSystem && sysVariables.length > 0) {
      groups.push({
        id: 'system',
        // nodeId: '',
        name: 'System Variables',
        type: 'system',
        icon: <Globe className='size-4' />,
        order: 1001,
        variables: sysVariables,
        color: '#3B82F6',
      })
    }

    // Sort groups by order
    return groups.sort((a, b) => a.order - b.order)
  }, [
    filteredVariables,
    envVariables,
    sysVariables,
    isInLoop,
    contexts,
    includeEnvironment,
    nodeTitlesMap,
    includeSystem,
    includeLoops,
  ])

  // Flatten top-level variables for easy access
  const variables = useMemo(() => {
    return groupedVariables.flatMap((group) => group.variables)
  }, [groupedVariables])

  // Create flattened list including all nested variables for searching
  // filteredVariables is already flattened from store's availabilityCache
  // No need to re-flatten by walking children arrays
  const allVariables = useMemo(() => {
    return filteredVariables
  }, [filteredVariables])

  return {
    variables,
    allVariables,
    filteredVariables,
    groups: groupedVariables,
    isInLoop,
    loopContexts: contexts,
    totalCount: allVariables.length,
    isEmpty: allVariables.length === 0,
  }
}
