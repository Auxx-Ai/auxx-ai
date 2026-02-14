// apps/web/src/components/workflow/utils/workflow-trigger-utils.ts

/**
 * Create a trigger node for a workflow based on its trigger type
 * @param triggerType The workflow trigger type
 * @param position Optional position for the node
 * @returns A new trigger node or undefined if trigger type is not supported
 */
// export function createTriggerNode(
//   triggerType: WorkflowTriggerType,
//   position: { x: number; y: number } = { x: 250, y: 50 }
// ): Node<BaseNodeData> | undefined {
//   const nodeId = triggerTypeToNodeIdMapper(triggerType)
//   const nodeDefinition = NODE_DEFINITIONS.find((def) => def.id === nodeId)

//   if (!nodeDefinition) {
//     console.warn(`No node definition found for trigger type: ${triggerType}`)
//     return undefined
//   }

//   return {
//     id: generateNodeId(),
//     type: nodeId,
//     position,
//     data: {
//       type: nodeId,
//       title: nodeDefinition.defaultConfig.title || nodeDefinition.displayName,
//       description: nodeDefinition.defaultConfig.description || nodeDefinition.description,
//       config: nodeDefinition.defaultConfig,
//       icon: nodeDefinition.icon,
//       color: nodeDefinition.color,
//     },
//   }
// }

/**
 * Ensure a workflow has the correct trigger node for its trigger type
 * @param nodes Current nodes in the workflow
 * @param workflowTriggerType The workflow's trigger type
 * @returns Updated nodes array with trigger node added/corrected if needed
 */
// export function ensureTriggerNode(
//   nodes: Node<BaseNodeData>[],
//   workflowTriggerType: WorkflowTriggerType
// ): { nodes: Node<BaseNodeData>[]; warnings: string[] } {
//   const validation = validateTriggerTypeConsistency(
//     workflowTriggerType,
//     nodes.map((n) => n.type || n.data.type)
//   )

//   if (validation.isValid) {
//     return { nodes, warnings: [] }
//   }

//   // Remove any existing trigger nodes if they don't match
//   const filteredNodes = nodes.filter((node) => {
//     const nodeType = node.type || node.data.type
//     const nodeDef = NODE_DEFINITIONS.find((def) => def.id === nodeType)
//     return !nodeDef || nodeDef.category !== 'trigger'
//   })

//   // Add the correct trigger node
//   const triggerNode = createTriggerNode(workflowTriggerType)
//   if (triggerNode) {
//     filteredNodes.unshift(triggerNode)
//   }

//   return {
//     nodes: filteredNodes,
//     warnings: [
//       ...validation.warnings,
//       'Trigger node was automatically corrected to match workflow trigger type',
//     ],
//   }
// }

/**
 * Get the workflow trigger type from a set of nodes
 * @param nodes Nodes in the workflow
 * @returns The detected trigger type or undefined if no trigger node found
 */
// export function detectWorkflowTriggerType(
//   nodes: Node<BaseNodeData>[]
// ): WorkflowTriggerType | undefined {
//   for (const node of nodes) {
//     const nodeType = node.type || node.data.type
//     const nodeDefinition = NODE_DEFINITIONS.find((def) => def.id === nodeType)

//     if (nodeDefinition?.triggerType) {
//       return nodeDefinition.triggerType
//     }
//   }

//   return undefined
// }

/**
 * Check if a workflow needs a trigger node based on its configuration
 * @param workflowTriggerType The workflow's trigger type
 * @param nodes Current nodes in the workflow
 * @returns True if a trigger node should be added
 */
// export function needsTriggerNode(
//   workflowTriggerType: WorkflowTriggerType | undefined,
//   nodes: Node<BaseNodeData>[]
// ): boolean {
//   if (!workflowTriggerType) {
//     return false
//   }

//   const hasTriggerNode = nodes.some((node) => {
//     const nodeType = node.type || node.data.type
//     const nodeDef = NODE_DEFINITIONS.find((def) => def.id === nodeType)
//     return nodeDef?.category === 'trigger'
//   })

//   return !hasTriggerNode
// }
