// apps/web/src/components/workflow/hooks/use-variable.ts

import { useStore } from '@xyflow/react'
import { useCallback, useMemo } from 'react'
import { shallow } from 'zustand/shallow'
import { useVarStore } from '../store/use-var-store'
import type { UnifiedVariable } from '../types'

/** Stable empty array to avoid new references (Zustand v5 safety) */
const EMPTY_LOOP_CONTEXTS: Array<{
  loopNodeId: string
  iteratorName: string
  iteratorType?: string
  depth: number
}> = []

/**
 * Hook to get a specific variable by ID with O(1) lookup.
 * Uses variableIndex for stable references.
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
  const variableId = variableIdIn !== undefined && variableIdIn !== null ? String(variableIdIn) : ''

  // Normalize numeric array accessors [0], [-1], [n] → [*] for store lookup
  const normalizedId = useMemo(() => variableId.replace(/\[-?\d+\]/g, '[*]'), [variableId])
  const needsNormalization = normalizedId !== variableId

  // O(1) lookup from variableIndex — always returns a stable Map reference (no new objects)
  const storeVariable = useVarStore((state) => {
    if (!variableId) return undefined
    return (
      state.variableIndex.get(variableId) ??
      (needsNormalization ? state.variableIndex.get(normalizedId) : undefined)
    )
  })

  // If we resolved via normalization, patch the ID outside the selector to avoid infinite loop
  const variable = useMemo(() => {
    if (!storeVariable) return undefined
    if (needsNormalization && storeVariable.id !== variableId) {
      return { ...storeVariable, id: variableId }
    }
    return storeVariable
  }, [storeVariable, variableId, needsNormalization])

  // Check availability if nodeId provided
  const isAvailable = useVarStore((state) => {
    if (!variable || !nodeId) return true
    if (variableId.startsWith('env.') || variableId.startsWith('sys.')) return true
    const availability = state.availability.get(nodeId)
    if (!availability) return true
    // Check both the exact ID and the [*] normalized form
    const normalized = variableId.replace(/\[-?\d+\]/g, '[*]')
    return availability.variables.some((v) => v.id === variableId || v.id === normalized)
  })

  if (!variable) {
    return {
      variable: undefined,
      isValid: false,
      isEnvVar: false,
      isSystemVar: false,
      isNodeVar: false,
    }
  }

  const isEnvVar = variableId.startsWith('env.')
  const isSystemVar = variableId.startsWith('sys.')
  const isNodeVar = !isEnvVar && !isSystemVar

  return {
    variable,
    isValid: isAvailable,
    isEnvVar,
    isSystemVar,
    isNodeVar,
  }
}

/**
 * Hook to detect if a node is inside a loop.
 * Reads from loopAncestry map (O(1) lookup).
 */
export function useLoopDetection(nodeId: string) {
  const loopData = useStore(
    useCallback(
      (state) => {
        const node = state.nodes.find((n) => n.id === nodeId)
        if (!node) return null

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
          hasLoopStartConnection: incomingEdges.some((e) => e.sourceHandle === 'loop-start'),
          parentChain,
        }
      },
      [nodeId]
    ),
    shallow
  )

  const loopContexts = useStore(
    useCallback(
      (state) => {
        if (!loopData) return EMPTY_LOOP_CONTEXTS

        const contexts: typeof EMPTY_LOOP_CONTEXTS = []

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

        return contexts.length > 0 ? contexts.reverse() : EMPTY_LOOP_CONTEXTS
      },
      [loopData]
    ),
    shallow
  )

  return {
    isInLoop: loopContexts.length > 0,
    contexts: loopContexts,
    isDirectlyInLoop: loopData?.hasLoopStartConnection || false,
  }
}

/**
 * Hook to get available variables for a node.
 * Returns from availability map (O(1) lookup).
 */
/** Stable empty array for available variables fallback */
const EMPTY_AVAILABLE_VARS: UnifiedVariable[] = []

export function useNodeAvailableVariables(nodeId: string) {
  const availableVars = useVarStore((state) => state.availability.get(nodeId)?.variables)
  return availableVars || EMPTY_AVAILABLE_VARS
}
