// apps/web/src/components/workflow/hooks/use-available-blocks.ts

import { useMemo } from 'react'
import { unifiedNodeRegistry } from '~/components/workflow/nodes/unified-registry'
import { NodeType } from '~/components/workflow/types/node-types'
import { NodeCategory } from '~/components/workflow/types/registry'
import { useRegistryVersion } from './use-registry'

/**
 * Handle type for filtering available blocks
 * - 'source': Regular workflow source connections (excludes TRIGGER and INPUT)
 * - 'target': Regular workflow target connections (excludes TRIGGER)
 * - 'input': Input data connections (shows only INPUT category)
 */
export type HandleType = 'source' | 'target' | 'input'

export const useAvailableBlocks = (
  nodeType?: string,
  isInLoop?: boolean,
  handleType?: HandleType
) => {
  // Subscribe to registry changes so app blocks are included
  const registryVersion = useRegistryVersion()

  const availablePrevBlocks = useMemo(() => {
    // Get only connectable node definitions
    const connectableNodes = unifiedNodeRegistry.getConnectableDefinitions()

    // Filter nodes that can connect before this node
    let prevBlocks: string[] = []

    // Rules for what can connect TO this node
    switch (nodeType) {
      // case 'start':
      //   // Start nodes don't have inputs
      //   break
      // case 'if-else':
      //   // Can connect to any output except end nodes
      //   connectableNodes.forEach((node) => {
      //     if (node.id !== 'custom-answer' && node.id !== 'answer') {
      //       prevBlocks.push(node.id)
      //     }
      //   })
      //   break
      default:
        // Most nodes can connect to any output
        connectableNodes.forEach((node) => {
          prevBlocks.push(node.id)
        })
    }

    // Filter out loop-restricted nodes when inside a loop
    if (isInLoop) {
      const loopRestrictedNodes = [
        NodeType.MESSAGE_RECEIVED,
        NodeType.WEBHOOK,
        NodeType.LOOP, // No nested loops for now
      ]
      prevBlocks = prevBlocks.filter((nodeId) => !loopRestrictedNodes.includes(nodeId as NodeType))
    }

    return prevBlocks
  }, [nodeType, isInLoop])

  const availableNextBlocks = useMemo(() => {
    // If this is an input handle type, return input blocks instead
    if (handleType === 'input') {
      if (!nodeType) return []

      const nodeDefinition = unifiedNodeRegistry.getDefinition(nodeType)
      if (!nodeDefinition?.acceptsInputNodes) return []

      // Return only INPUT category nodes
      return unifiedNodeRegistry.getByCategory(NodeCategory.INPUT).map((def) => def.id)
    }

    // Get flow definitions (excludes TRIGGER and INPUT categories)
    // Also filter out non-connectable nodes (like Note) that shouldn't appear in connection selectors
    const flowNodes = unifiedNodeRegistry
      .getFlowDefinitions()
      .filter((def) => def.canConnect !== false)

    // Filter nodes that can connect after this node
    let nextBlocks: string[] = []

    // Rules for what can connect FROM this node
    switch (nodeType) {
      case 'answer':
        // Answer nodes are terminal, no outputs
        break
      case NodeType.LOOP:
        // Loop nodes can connect to any flow node inside the loop
        nextBlocks = flowNodes.map((node) => node.id)
        break
      default:
        // Most nodes can connect to any flow node
        nextBlocks = flowNodes.map((node) => node.id)
    }

    // Filter out loop-restricted nodes when inside a loop
    if (isInLoop) {
      const loopRestrictedNodes = [
        NodeType.MESSAGE_RECEIVED,
        NodeType.WEBHOOK,
        NodeType.LOOP, // No nested loops for now
      ]
      nextBlocks = nextBlocks.filter((nodeId) => !loopRestrictedNodes.includes(nodeId as NodeType))
    }

    return nextBlocks
  }, [nodeType, isInLoop, handleType])

  return {
    availablePrevBlocks,
    availableNextBlocks,
  }
}
