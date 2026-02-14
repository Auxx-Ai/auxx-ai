// apps/web/src/components/workflow/hooks/use-node-connections.ts

import { isTerminalNodeType } from '@auxx/lib/workflow-engine/client'
import { useReactFlow } from '@xyflow/react'
import { useMemo } from 'react'

/**
 * Hook to check if a node has outgoing connections and whether it needs them
 */
export function useNodeConnections(nodeId: string, nodeType: string) {
  const { getEdges } = useReactFlow()

  return useMemo(() => {
    const edges = getEdges()
    const outgoingEdges = edges.filter((edge) => edge.source === nodeId)
    const hasOutgoingConnections = outgoingEdges.length > 0
    const isTerminal = isTerminalNodeType(nodeType)
    const needsOutgoingConnection = !isTerminal && !hasOutgoingConnections

    return {
      hasOutgoingConnections,
      isTerminal,
      needsOutgoingConnection,
      outgoingEdgeCount: outgoingEdges.length,
    }
  }, [nodeId, nodeType, getEdges])
}
