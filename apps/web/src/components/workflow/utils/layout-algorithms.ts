// apps/web/src/components/workflow/hooks/layout-algorithms.ts

import dagre from 'dagre'
import type { FlowNode, FlowEdge } from '../store/types'
import {
  LAYOUT_CONFIG,
  CONTAINER_LAYOUT_CONFIG,
  LAYOUT_SPACING,
  NODE_CLASSIFICATIONS,
} from './layout-constants'

/**
 * Create dagre graph for layout calculation
 */
function createDagreGraph(): dagre.graphlib.Graph {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  return dagreGraph
}

/**
 * Apply dagre layout to graph
 */
function layoutGraph(graph: dagre.graphlib.Graph): void {
  dagre.layout(graph)
}

/**
 * Main layout function for workflow nodes using Dagre
 */
export function getLayoutByDagre(
  originNodes: FlowNode[],
  originEdges: FlowEdge[]
): dagre.graphlib.Graph {
  const dagreGraph = createDagreGraph()

  // Filter nodes for main layout (exclude child nodes)
  const nodes = originNodes.filter(
    (node) => !node.parentId && node.type !== 'group' // Exclude grouped nodes from main layout
  )

  // Filter edges for main layout
  const edges = originEdges.filter((edge) => {
    // Include only main-level edges, exclude container-internal edges
    const sourceNode = originNodes.find((n) => n.id === edge.source)
    const targetNode = originNodes.find((n) => n.id === edge.target)
    return sourceNode && targetNode && !sourceNode.parentId && !targetNode.parentId
  })

  // Configure dagre graph
  dagreGraph.setGraph(LAYOUT_CONFIG)

  // Add nodes to graph
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: node.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH,
      height: node.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT,
    })
  })

  // Add edges to graph
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  // Calculate layout
  layoutGraph(dagreGraph)

  return dagreGraph
}

/**
 * Layout function for child nodes within containers
 */
export function getLayoutForChildNodes(
  parentNodeId: string,
  originNodes: FlowNode[],
  originEdges: FlowEdge[]
): dagre.graphlib.Graph {
  const dagreGraph = createDagreGraph()

  // Get child nodes
  const nodes = originNodes.filter((node) => node.parentId === parentNodeId)

  // Get edges connecting child nodes
  const edges = originEdges.filter((edge) => {
    const sourceNode = originNodes.find((n) => n.id === edge.source)
    const targetNode = originNodes.find((n) => n.id === edge.target)
    return sourceNode?.parentId === parentNodeId && targetNode?.parentId === parentNodeId
  })

  // Find start node if any
  const startNode = nodes.find((node) =>
    NODE_CLASSIFICATIONS.START_TYPES.some(
      (type) => node.data?.type?.includes(type) || node.type?.includes(type)
    )
  )

  if (!startNode) {
    // Simple layout without start node
    dagreGraph.setGraph(CONTAINER_LAYOUT_CONFIG)

    nodes.forEach((node) => {
      dagreGraph.setNode(node.id, {
        width: node.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH,
        height: node.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT,
      })
    })

    edges.forEach((edge) => {
      dagreGraph.setEdge(edge.source, edge.target)
    })

    layoutGraph(dagreGraph)
    return dagreGraph
  }

  // Complex layout with start node positioning
  const startNodeOutEdges = edges.filter((edge) => edge.source === startNode.id)
  const firstConnectedNodes = startNodeOutEdges
    .map((edge) => nodes.find((node) => node.id === edge.target))
    .filter(Boolean) as FlowNode[]

  const nonStartNodes = nodes.filter((node) => node.id !== startNode.id)
  const nonStartEdges = edges.filter(
    (edge) => edge.source !== startNode.id && edge.target !== startNode.id
  )

  // Layout non-start nodes first
  dagreGraph.setGraph({
    ...CONTAINER_LAYOUT_CONFIG,
    marginx: LAYOUT_SPACING.NODE_HORIZONTAL_PADDING / 2,
    marginy: LAYOUT_SPACING.NODE_VERTICAL_PADDING / 2,
  })

  nonStartNodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: node.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH,
      height: node.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT,
    })
  })

  nonStartEdges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  layoutGraph(dagreGraph)

  // Position start node
  const startNodeSize = {
    width: startNode.width || LAYOUT_SPACING.START_NODE_WIDTH,
    height: startNode.height || LAYOUT_SPACING.START_NODE_HEIGHT,
  }

  const startNodeX = LAYOUT_SPACING.NODE_HORIZONTAL_PADDING / 1.5
  let startNodeY = 100

  // Calculate optimal start node position based on connected nodes
  if (firstConnectedNodes.length > 0) {
    let avgFirstLayerY = 0
    let firstLayerCount = 0

    firstConnectedNodes.forEach((node) => {
      const nodePos = dagreGraph.node(node.id)
      if (nodePos) {
        avgFirstLayerY += nodePos.y
        firstLayerCount++
      }
    })

    if (firstLayerCount > 0) {
      avgFirstLayerY /= firstLayerCount
      startNodeY = avgFirstLayerY
    }
  }

  // Add start node to graph
  dagreGraph.setNode(startNode.id, {
    x: startNodeX + startNodeSize.width / 2,
    y: startNodeY,
    width: startNodeSize.width,
    height: startNodeSize.height,
  })

  return dagreGraph
}

/**
 * Calculate required container size based on child nodes
 */
export function calculateContainerSize(
  parentNodeId: string,
  nodes: FlowNode[],
  layout: dagre.graphlib.Graph
): { width: number; height: number } {
  const childNodes = nodes.filter((node) => node.parentId === parentNodeId)

  if (childNodes.length === 0) {
    return { width: LAYOUT_SPACING.DEFAULT_NODE_WIDTH, height: LAYOUT_SPACING.DEFAULT_NODE_HEIGHT }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  childNodes.forEach((node) => {
    const nodePos = layout.node(node.id)
    if (nodePos) {
      const nodeX = nodePos.x - (node.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH) / 2
      const nodeY = nodePos.y - (node.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT) / 2

      minX = Math.min(minX, nodeX)
      minY = Math.min(minY, nodeY)
      maxX = Math.max(maxX, nodeX + (node.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH))
      maxY = Math.max(maxY, nodeY + (node.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT))
    }
  })

  const requiredWidth = maxX - minX + LAYOUT_SPACING.NODE_HORIZONTAL_PADDING * 2
  const requiredHeight = maxY - minY + LAYOUT_SPACING.NODE_VERTICAL_PADDING * 2

  return {
    width: Math.max(LAYOUT_SPACING.DEFAULT_NODE_WIDTH, requiredWidth),
    height: Math.max(LAYOUT_SPACING.DEFAULT_NODE_HEIGHT, requiredHeight),
  }
}
