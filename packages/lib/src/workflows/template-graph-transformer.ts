// packages/lib/src/workflows/template-graph-transformer.ts

import { generateId } from '@auxx/lib/utils'

/**
 * Type definitions for workflow graph
 */
export interface WorkflowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, any>
  [key: string]: any
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  [key: string]: any
}

export interface WorkflowGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  viewport?: { x: number; y: number; zoom: number }
}

/**
 * Template graph transformer
 * Handles cloning and transforming template graphs for new workflows
 */
export class TemplateGraphTransformer {
  /**
   * Clone a template graph and generate new IDs for all nodes and edges
   * This prevents ID conflicts when creating workflows from templates
   */
  cloneGraph(templateGraph: WorkflowGraph): {
    graph: WorkflowGraph
    idMapping: Map<string, string>
  } {
    const idMapping = new Map<string, string>()

    // First pass: Generate new IDs for all nodes
    const clonedNodes = templateGraph.nodes.map((node) => {
      const newId = generateId()
      idMapping.set(node.id, newId)

      return {
        ...node,
        // id: newId,
        // Deep clone the data object to prevent reference issues
        data: JSON.parse(JSON.stringify(node.data)),
        // Deep clone position
        position: { ...node.position },
      }
    })

    // Second pass: Update edge references with new node IDs
    const clonedEdges = templateGraph.edges.map((edge) => {
      const newSourceId = idMapping.get(edge.source)
      const newTargetId = idMapping.get(edge.target)

      if (!newSourceId || !newTargetId) {
        throw new Error(
          `Invalid edge: source ${edge.source} or target ${edge.target} not found in nodes`
        )
      }

      return {
        ...edge,
        // id: generateId(),
        // source: newSourceId,
        // target: newTargetId,
      }
    })

    return {
      graph: {
        nodes: clonedNodes,
        edges: clonedEdges,
        viewport: templateGraph.viewport ? { ...templateGraph.viewport } : undefined,
      },
      idMapping,
    }
  }

  /**
   * Transform environment variables from template
   * Creates new IDs but preserves the structure
   */
  cloneEnvVars(
    templateEnvVars?: Array<{
      id: string
      name: string
      value: any
      type: 'string' | 'number' | 'boolean' | 'array' | 'secret'
    }>
  ) {
    if (!templateEnvVars) return undefined

    return templateEnvVars.map((envVar) => ({
      ...envVar,
      id: generateId(),
      // Clear secret values for security
      value: envVar.type === 'secret' ? '' : envVar.value,
    }))
  }

  /**
   * Transform variables from template
   * Creates new IDs but preserves the structure
   */
  cloneVariables(templateVariables?: any[]) {
    if (!templateVariables) return undefined

    return templateVariables.map((variable) => ({
      ...variable,
      id: generateId(),
    }))
  }

  /**
   * Complete template transformation
   * Transforms all aspects of a template into a new workflow
   */
  transformTemplate(template: {
    graph: WorkflowGraph
    triggerType?: string
    triggerConfig?: Record<string, any>
    envVars?: any[]
    variables?: any[]
  }) {
    const { graph: clonedGraph, idMapping } = this.cloneGraph(template.graph)

    return {
      graph: clonedGraph,
      triggerType: template.triggerType,
      triggerConfig: template.triggerConfig
        ? JSON.parse(JSON.stringify(template.triggerConfig))
        : undefined,
      envVars: this.cloneEnvVars(template.envVars),
      variables: this.cloneVariables(template.variables),
      idMapping, // Return mapping in case caller needs it
    }
  }
}
