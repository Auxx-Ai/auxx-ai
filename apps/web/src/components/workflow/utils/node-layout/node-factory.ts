// apps/web/src/components/workflow/utils/node-layout/node-factory.ts

import { cloneDeep } from '@auxx/utils'
import { generateId } from '@auxx/utils/generateId'
import type { FlowNode } from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types'
import { unifiedNodeRegistry } from '../../nodes/unified-registry'
import { LAYOUT_SPACING } from '../layout-constants'
import { generateUniqueTitle } from '../unique-title-generator'
import type { Point } from './collision-detector'

export interface CreateNodeParams {
  nodeType: string
  position: Point
  data?: Record<string, any> // Initial data values for the node
  existingNodes: FlowNode[]
  parentId?: string
  parentNode?: FlowNode // New parameter to help with zIndex calculation
}

/**
 * Factory for creating workflow nodes with proper defaults and metadata
 */
export class NodeFactory {
  /**
   * Create a new workflow node
   */
  static createNode(params: CreateNodeParams): FlowNode {
    const { nodeType, position, data = {}, existingNodes, parentId, parentNode } = params

    const definition = unifiedNodeRegistry.getDefinition(nodeType)
    if (!definition) {
      throw new Error(`Invalid node type: ${nodeType}`)
    }

    const nodeId = generateId(nodeType)
    const defaultData = definition.defaultData || {}
    const mergedData = NodeFactory.applyNodeDefaults(nodeType, defaultData, data)
    const baseTitle = data?.title || mergedData.title || definition.displayName
    const uniqueTitle = generateUniqueTitle(baseTitle, existingNodes)

    // Determine loopId based on parent context
    let loopId: string | undefined
    let isInLoop = false

    if (parentId && parentNode) {
      // If parent is a loop, use its ID as loopId
      if (parentNode.data.type === NodeType.LOOP) {
        loopId = parentId
        isInLoop = true
      }
      // If parent is not a loop but has a loopId, propagate it
      else if (parentNode.data.loopId) {
        loopId = parentNode.data.loopId
        isInLoop = true
      }
    }

    if (isInLoop) {
      console.log('Creating node inside loop:', {
        nodeType,
        parentId,
        parentNodeType: parentNode?.data?.type,
        loopId,
        isInLoop,
      })
    }

    // Create flattened node data structure
    const nodeData = {
      // Core properties
      id: nodeId,
      desc: definition.description,
      isValid: true,
      errors: [],
      disabled: false,
      isInLoop,
      loopId,
      _connectedSourceHandleIds: [],
      _connectedTargetHandleIds: [],
      // Spread all merged data
      ...mergedData,
      // type must come after spread so defaultData.type can't overwrite the definition ID
      type: nodeType as NodeType,
      title: uniqueTitle,

      // Ensure title is set correctly
    }

    // Calculate zIndex based on loop depth
    let zIndex = 0
    if (parentId && parentNode) {
      // Base zIndex for nodes in loops
      zIndex = 1000

      // Add depth calculation
      let depth = 1
      let currentParent: FlowNode | undefined = parentNode
      while (currentParent?.parentId) {
        depth++
        currentParent = existingNodes.find((n) => n.id === currentParent?.parentId)
        if (!currentParent) break
      }

      // Higher depth = higher zIndex
      zIndex += depth * 10
    }

    const obj: FlowNode = {
      id: nodeId,
      type: nodeType === NodeType.NOTE ? 'note' : 'standard',
      position,
      parentId,
      data: nodeData,
      selected: false,
      selectable: true,
      dragging: false,
      width: NodeFactory.getNodeWidth(nodeType),
      height: NodeFactory.getNodeHeight(nodeType),
      // zIndex,
    }
    if (parentId) {
      obj.extent = 'parent' // Ensure child nodes are sized to parent
      // obj.draggable = false // Disable dragging for child nodes
    }

    return obj
  }

  /**
   * Apply node-specific defaults.
   * Model defaults are handled at the selector level (ModelParameterModal).
   */
  private static applyNodeDefaults(
    _nodeType: string,
    defaultData: Record<string, any>,
    userData: Record<string, any>
  ): Record<string, any> {
    const data = cloneDeep(defaultData)
    return { ...data, ...userData }
  }

  /**
   * Get the default width for a node type
   */
  private static getNodeWidth(nodeType: string): number {
    // Start nodes have special width
    if (nodeType === 'start' || nodeType === 'trigger') {
      return LAYOUT_SPACING.START_NODE_WIDTH
    }
    return LAYOUT_SPACING.DEFAULT_NODE_WIDTH
  }

  /**
   * Get the default height for a node type
   */
  private static getNodeHeight(nodeType: string): number {
    // Start nodes have special height
    if (nodeType === 'start' || nodeType === 'trigger') {
      return LAYOUT_SPACING.START_NODE_HEIGHT
    }
    return LAYOUT_SPACING.DEFAULT_NODE_HEIGHT
  }

  /**
   * Clone an existing node with a new position
   */
  static cloneNode(node: FlowNode, newPosition: Point, existingNodes: FlowNode[]): FlowNode {
    const clonedNode = cloneDeep(node)
    const newId = generateId(node.type)
    const baseTitle = node.data.title || 'Copy'
    const uniqueTitle = generateUniqueTitle(`${baseTitle} Copy`, existingNodes)
    const nodeType = clonedNode.data.type

    return {
      ...clonedNode,
      id: newId,
      type: nodeType === NodeType.NOTE ? 'note' : 'standard',
      position: newPosition,
      selected: false,
      dragging: false,
      data: {
        ...clonedNode.data,
        id: newId,
        title: uniqueTitle,
        // Preserve loop context when cloning
        loopId: clonedNode.data.loopId,
        isInLoop: clonedNode.data.isInLoop,
        // No need to update config separately - title is already at the top level
      },
    }
  }
}
