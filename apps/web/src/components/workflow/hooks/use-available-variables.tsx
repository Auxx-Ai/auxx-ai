// apps/web/src/components/workflow/hooks/use-available-variables.tsx

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
import { useNodeAvailableVariables } from './use-variable'

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
 * Hook to get all available variables for a node using the var store
 */
export function useAvailableVariables({
  nodeId,
  expectedTypes,
  includeEnvironment = true,
  includeSystem = true,
  includeLoops = true,
}: UseAvailableVariablesOptions) {
  const availableVariables = useNodeAvailableVariables(nodeId)
  const upstreamMap = useVarStore((state) => state.upstreamMap)

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

  // Get loop contexts from loopAncestry map
  const contexts = useVarStore((state) => state.loopAncestry.get(nodeId)) ?? EMPTY_LOOP_CONTEXTS

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
  const nodeTitlesMapRef = useRef<Record<string, { title: string; type: string }>>({})
  const nodeTitlesMapHashRef = useRef<string>('')

  const nodeTitlesMap = useStore(
    useCallback((state) => {
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

      const newHash = state.nodes
        .map(
          (n) => `${n.id}:${n.data?.title || n.data?.label || n.id}:${n.data?.type || 'unknown'}`
        )
        .sort()
        .join('|')

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
    filteredVariables.forEach((variable) => {
      if (variable.category === 'node') {
        const variableNodeId = getNodeIdFromVariableId(variable.id)
        const variablePath = getPathFromVariableId(variable.id)

        // Only include top-level variables in groups
        const pathWithoutArrays = variablePath.replace(/\[\*\]/g, '')
        const isTopLevel = !pathWithoutArrays.includes('.') && !variablePath.includes('[*]')

        if (isTopLevel) {
          const existing = nodeGroups.get(variableNodeId) || []
          existing.push(variable)
          nodeGroups.set(variableNodeId, existing)
        }
      }
    })

    // Create groups for node variables, ordered by upstream depth (fewer ancestors = earlier)
    nodeGroups.forEach((variables, sourceNodeId) => {
      const nodeInfo = nodeTitlesMap[sourceNodeId]
      const nodeTitle = nodeInfo?.title || sourceNodeId
      const nodeType = nodeInfo?.type || 'unknown'

      const nodeDef = unifiedNodeRegistry.getDefinition(nodeType)

      groups.push({
        id: `node-${sourceNodeId}`,
        name: String(nodeTitle),
        type: 'node',
        nodeType,
        icon: nodeDef?.icon ? getIcon(nodeDef.icon) : undefined,
        order: upstreamMap.get(sourceNodeId)?.size ?? 0,
        variables,
        color: nodeDef?.color || '#6B7280',
      })
    })

    // Add loop variables group if in loop
    if (isInLoop && includeLoops && contexts.length > 0) {
      const loopVars = filteredVariables.filter((v) => {
        if (v.category !== 'node') return false
        const variableNodeId = getNodeIdFromVariableId(v.id)

        return contexts.some((ctx) => {
          if (ctx.loopNodeId !== variableNodeId) return false

          const variablePath = getPathFromVariableId(v.id)
          const pathWithoutArrays = variablePath.replace(/\[\*\]/g, '')
          const isTopLevel = !pathWithoutArrays.includes('.') && !variablePath.includes('[*]')

          return isTopLevel
        })
      })

      if (loopVars.length > 0) {
        const contextName =
          contexts.length === 1 ? 'Loop Variables' : `Loop Variables (${contexts.length} levels)`

        groups.push({
          id: 'loop-context',
          name: contextName,
          type: 'loop',
          icon: <Repeat className='size-4' />,
          order: -1,
          variables: loopVars,
          color: '#8B5CF6',
        })
      }
    }

    // Add environment variables group
    if (includeEnvironment && envVariables.length > 0) {
      const envVars: UnifiedVariable[] = envVariables.map((env) => {
        const envId = env.id || `env.${env.name}`
        return {
          id: envId,
          path: getPathFromVariableId(envId),
          label: env.name,
          type: (env.type || 'string') as BaseType,
          category: 'environment' as const,
          description: '',
        }
      })

      groups.push({
        id: 'environment',
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
        name: 'System Variables',
        type: 'system',
        icon: <Globe className='size-4' />,
        order: 1001,
        variables: sysVariables,
        color: '#3B82F6',
      })
    }

    // Sort: node groups descending by upstream depth (closest upstream first),
    // loop variables at top, system/environment at bottom
    return groups.sort((a, b) => {
      // Loop variables always first
      if (a.type === 'loop') return -1
      if (b.type === 'loop') return 1
      // System/environment always last
      if (a.type === 'system' || a.type === 'environment') return 1
      if (b.type === 'system' || b.type === 'environment') return -1
      // Node groups: descending by upstream depth (most ancestors = closest to current node)
      return b.order - a.order
    })
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
    upstreamMap,
  ])

  // Flatten top-level variables for easy access
  const variables = useMemo(() => {
    return groupedVariables.flatMap((group) => group.variables)
  }, [groupedVariables])

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
