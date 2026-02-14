// apps/web/src/components/workflow/hooks/use-node-title.ts

import { useReactFlow } from '@xyflow/react'
import { useMemo } from 'react'

/**
 * Hook to get the current title of a node by its ID
 * Returns the node's title or a fallback based on node type
 */
export function useNodeTitle(nodeId: string | undefined): string | undefined {
  const { getNode } = useReactFlow()

  return useMemo(() => {
    if (!nodeId) return undefined

    const node = getNode(nodeId)
    if (!node) return undefined

    // Get title from node data
    const title = node.data?.title || (node.data as any)?.label
    if (title) return title

    // Fallback to node type display name if no title
    const nodeType = node.data?.type
    if (!nodeType) return 'Unknown Node'

    // Convert node type to display name
    // const typeDisplayNames: Record<string, string> = {
    //   'message-received': 'Message Received',
    //   'if-else': 'IF/ELSE',
    //   answer: 'Send Answer',
    //   ai: 'AI',
    //   code: 'Code',
    //   'text-classifier': 'Text Classifier',
    //   'information-extractor': 'Information Extractor',
    //   note: 'Note',
    //   end: 'End',
    // }

    // return typeDisplayNames[nodeType] || nodeType
  }, [nodeId, getNode])
}

/**
 * @deprecated Use useNodeTitle instead - ReactFlow manages performance internally
 * Hook to get node title without subscription (for performance)
 */
export function useNodeTitleStatic(nodeId: string | undefined): string | undefined {
  // This function is deprecated as ReactFlow handles performance optimization internally
  // Use useNodeTitle instead
  console.warn('useNodeTitleStatic is deprecated. Use useNodeTitle instead.')
  return nodeId ? 'Node' : undefined
}
