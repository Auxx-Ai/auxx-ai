// apps/web/src/components/workflow/hooks/use-checklist.ts

import { isTerminalNodeType } from '@auxx/lib/workflow-engine/client'
import { useStoreApi } from '@xyflow/react'
import { useMemo } from 'react'
import { unifiedNodeRegistry } from '../nodes/unified-registry'
import { NodeType } from '../types/node-types'

export interface NodeIssue {
  severity: 'error' | 'warning'
  message: string
  unConnected: boolean
}

export interface NodeWithIssues {
  id: string
  type: string
  title: string
  icon?: string
  color?: string
  issues: NodeIssue[]
}

interface UseChecklistReturn {
  nodesWithIssues: NodeWithIssues[]
  warningCount: number
  errorCount: number
  totalIssues: number
}

/**
 * Hook to check workflow for validation issues and warnings
 */
export const useChecklist = (): UseChecklistReturn => {
  // Get nodes and edges from stores
  const state = useStoreApi()
  const { nodes, edges } = state.getState()

  const { nodesWithIssues, warningCount, errorCount } = useMemo(() => {
    const nodeIssuesMap = new Map<string, NodeWithIssues>()
    let warnings = 0
    let errors = 0

    // Create sets for efficient lookup
    const connectedNodeIds = new Set<string>()
    const nodesWithIncomingEdges = new Set<string>()
    const nodesWithOutgoingEdges = new Set<string>()

    edges.forEach((edge) => {
      connectedNodeIds.add(edge.source)
      connectedNodeIds.add(edge.target)
      nodesWithOutgoingEdges.add(edge.source)
      nodesWithIncomingEdges.add(edge.target)
    })

    // Check if we have any trigger nodes
    const hasTriggerNode = nodes.some((node) =>
      unifiedNodeRegistry.isTrigger(node.data?.type as string)
    )

    const addIssueToNode = (nodeId: string, nodeType: string, nodeData: any, issue: NodeIssue) => {
      const definition = unifiedNodeRegistry.getDefinition(nodeType)

      if (!nodeIssuesMap.has(nodeId)) {
        nodeIssuesMap.set(nodeId, {
          id: nodeId,
          type: nodeType,
          title: nodeData?.title || definition?.displayName || nodeType,
          icon: definition?.icon,
          color: definition?.color || '#6b7280',
          issues: [],
        })
      }

      nodeIssuesMap.get(nodeId)!.issues.push(issue)

      if (issue.severity === 'error') {
        errors++
      } else {
        warnings++
      }
    }

    // Validate each node
    nodes.forEach((node) => {
      const nodeType = node.data?.type as string
      const hasIncomingEdges = nodesWithIncomingEdges.has(node.id)
      const hasOutgoingEdges = nodesWithOutgoingEdges.has(node.id)
      const isDisabled = node.data?.disabled || false

      // Get node definition to access icon and check if it can connect
      const definition = unifiedNodeRegistry.getDefinition(nodeType as string)

      // Skip validation for nodes that cannot connect (like Note nodes)
      if (definition?.canConnect === false || nodeType === 'note') {
        return
      }

      // Check if disabled node has multiple incoming connections
      if (isDisabled) {
        const incomingEdges = edges.filter((edge) => edge.target === node.id)
        const outgoingEdges = edges.filter((edge) => edge.source === node.id)

        // Check if node has multiple source handles or is a branching node
        const hasMultipleSources = incomingEdges.length > 1
        const isBranchingNode =
          nodeType === NodeType.IF_ELSE ||
          (nodeType === NodeType.TEXT_CLASSIFIER && node.data?.outputMode !== 'variable') ||
          outgoingEdges.length > 1

        if (hasMultipleSources || isBranchingNode) {
          addIssueToNode(node.id, nodeType, node.data, {
            severity: 'error',
            message: 'Disabled nodes with multiple connections cannot be bypassed in execution',
            unConnected: false,
          })
          return // Skip other validations for disabled nodes
        }
      }

      // Skip other validations for disabled nodes (they won't execute anyway)
      if (isDisabled) {
        return
      }

      // Validate node data
      const validationResult = unifiedNodeRegistry.validateNode(nodeType, node.data)

      // Check if node has validation errors
      if (!validationResult.isValid) {
        addIssueToNode(node.id, nodeType, node.data, {
          severity: 'error',
          message: validationResult.errors[0]?.message || 'Validation failed',
          unConnected: false,
        })
      }

      // Check connectivity for non-single-node workflows
      if (nodes.length > 1) {
        // Orphaned nodes (no incoming connections) are now warnings
        // Exclude trigger nodes and input nodes as they are designed to be entry points
        if (
          !hasIncomingEdges &&
          !unifiedNodeRegistry.isTrigger(nodeType as string) &&
          !unifiedNodeRegistry.isInputNode(nodeType as string)
        ) {
          addIssueToNode(node.id, nodeType, node.data, {
            severity: 'warning',
            message: 'Node has no incoming connections',
            unConnected: true,
          })
        }
        // Nodes without outgoing connections are warnings if they can be terminal
        if (!hasOutgoingEdges && !isTerminalNodeType(nodeType as string)) {
          addIssueToNode(node.id, nodeType, node.data, {
            severity: 'warning',
            message: 'Non-terminal node has no outgoing connections',
            unConnected: true,
          })
        }
      }
    })

    // Add error if no trigger node exists
    if (!hasTriggerNode && nodes.length > 0) {
      addIssueToNode(
        'trigger-missing',
        'system',
        { title: 'Missing Trigger Node' },
        {
          severity: 'error',
          message: 'Workflow must have at least one trigger node to start execution',
          unConnected: false,
        }
      )
    }

    return {
      nodesWithIssues: Array.from(nodeIssuesMap.values()),
      warningCount: warnings,
      errorCount: errors,
    }
  }, [nodes, edges])

  return {
    nodesWithIssues,
    warningCount,
    errorCount,
    totalIssues: warningCount + errorCount,
  }
}
