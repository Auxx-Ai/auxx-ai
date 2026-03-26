// packages/lib/src/workflows/template-graph-transformer.ts

import { generateId } from '@auxx/utils/generateId'
import type { ResolvedApp } from './template-resolution'

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

/** Escape special regex characters in a string */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Template graph transformer
 * Handles cloning and transforming template graphs for new workflows
 */
export class TemplateGraphTransformer {
  /**
   * Clone a template graph and generate new IDs for all nodes and edges.
   * Also rewrites variable references ({{oldNodeId.field}}) to use new IDs.
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

      // Deep clone and strip $comment (template authoring aid, not needed at runtime)
      const { $comment: _, ...clonedData } = JSON.parse(JSON.stringify(node.data))

      return {
        ...node,
        id: newId,
        data: {
          ...clonedData,
          id: newId, // node.data.id must match node.id
        },
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
        id: generateId(),
        source: newSourceId,
        target: newTargetId,
      }
    })

    // Third pass: Rewrite variable references in all node data
    // Two patterns need replacement:
    //   1. {{oldId.field}} — template variable syntax in text/prompts
    //   2. "oldId.field" — bare references like variableId in if-else conditions
    for (const node of clonedNodes) {
      const dataStr = JSON.stringify(node.data)
      let updated = dataStr
      for (const [oldId, newId] of idMapping) {
        const escaped = escapeRegExp(oldId)
        // Pattern 1: {{oldId. → {{newId.
        const templatePattern = new RegExp(`\\{\\{${escaped}\\.`, 'g')
        updated = updated.replace(templatePattern, `{{${newId}.`)
        // Pattern 2: "oldId. → "newId.  (bare node ID references in JSON values)
        const barePattern = new RegExp(`"${escaped}\\.`, 'g')
        updated = updated.replace(barePattern, `"${newId}.`)
      }
      if (updated !== dataStr) {
        const parsed = JSON.parse(updated)
        // Restore the new ID — the string replace above could have
        // clobbered node.data.id if the old ID appeared as a substring
        parsed.id = node.data.id
        node.data = parsed
      }
    }

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
      id: `env.${envVar.name}`,
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
   * Resolve app slugs to appIds for the target organization's environment.
   * Called during workflow creation, NOT during template storage.
   *
   * MUTATES the graph in place (caller must deep-clone beforehand —
   * cloneGraph already does this).
   *
   * Only modifies node.data fields (type, appId). Does NOT touch:
   * - node.id (stays stable — edges reference it)
   * - node.data.id (stays in sync with node.id)
   * - installationId (resolved at runtime by AppWorkflowNode, not persisted)
   */
  resolveAppNodes(
    graph: WorkflowGraph,
    resolvedApps: Map<string, ResolvedApp>
  ): { graph: WorkflowGraph; unresolved: string[] } {
    const unresolved: string[] = []

    for (const node of graph.nodes) {
      // Only process nodes that have appSlug set (template-specific marker)
      if (!node.data.appSlug || !node.data.blockId) continue

      const resolved = resolvedApps.get(node.data.appSlug)
      if (resolved) {
        // Rewrite data.type from "@slug:blockId" → "realAppId:blockId"
        node.data.type = `${resolved.appId}:${node.data.blockId}`
        node.data.appId = resolved.appId
        // installationId is NOT set here — AppWorkflowNode resolves it at runtime
        // iconUrl is NOT stored — resolved at render time from appSlugMap cache
      } else {
        // Leave @slug:blockId as-is — AppWorkflowNode will show
        // "not installed" placeholder since "@slug" won't match any appId
        unresolved.push(node.data.appSlug)
      }
    }

    // No edge updates needed — edges reference node.id which doesn't change

    return { graph, unresolved }
  }

  /**
   * Validate that text classifier edges reference valid category IDs.
   */
  validateClassifierEdges(graph: WorkflowGraph): string[] {
    const errors: string[] = []
    for (const node of graph.nodes) {
      if (node.data.type === 'text-classifier') {
        // Variable mode uses 'source' handle — no category ID validation needed
        if (node.data.outputMode === 'variable') continue

        const categoryIds = (node.data.categories ?? []).map((c: any) => c.id)
        const outEdges = graph.edges.filter((e) => e.source === node.id)
        for (const edge of outEdges) {
          if (
            edge.sourceHandle &&
            !categoryIds.includes(edge.sourceHandle) &&
            edge.sourceHandle !== 'source'
          ) {
            errors.push(
              `Edge ${edge.id}: sourceHandle "${edge.sourceHandle}" not in classifier categories`
            )
          }
        }
      }
    }
    return errors
  }

  /**
   * Populate default assignees for human-confirmation nodes.
   * If a node has no assignees configured (no userIds, groups, or variable),
   * set the given userId as the default approver.
   */
  populateDefaultAssignees(graph: WorkflowGraph, userId: string): void {
    for (const node of graph.nodes) {
      if (node.data.type !== 'human-confirmation') continue

      const assignees = node.data.assignees
      const hasAssignees =
        assignees?.userIds?.length > 0 || assignees?.groups?.length > 0 || assignees?.variable

      if (!hasAssignees) {
        if (!node.data.assignees) {
          node.data.assignees = { userIds: [], groups: [] }
        }
        node.data.assignees.userIds = [userId]
      }
    }
  }

  /**
   * Complete template transformation
   * Transforms all aspects of a template into a new workflow
   */
  transformTemplate(
    template: {
      graph: WorkflowGraph
      triggerType?: string
      triggerConfig?: Record<string, any>
      entityDefinitionId?: string
      envVars?: any[]
      variables?: any[]
    },
    options?: { userId?: string }
  ) {
    const { graph: clonedGraph, idMapping } = this.cloneGraph(template.graph)

    // Auto-assign workflow creator as default approver
    if (options?.userId) {
      this.populateDefaultAssignees(clonedGraph, options.userId)
    }

    return {
      graph: clonedGraph,
      triggerType: template.triggerType,
      triggerConfig: template.triggerConfig
        ? JSON.parse(JSON.stringify(template.triggerConfig))
        : undefined,
      entityDefinitionId: template.entityDefinitionId,
      envVars: this.cloneEnvVars(template.envVars),
      variables: this.cloneVariables(template.variables),
      idMapping, // Return mapping in case caller needs it
    }
  }
}
