// apps/web/src/components/workflow/utils/form-input-utils.ts

import type { FormInputNodeData } from '../nodes/inputs/form-input/types'
import type { FlowEdge, FlowNode } from '../types'
import { BaseType } from '../types'
import type { FormInputConfig } from '../ui/form-input-field'

/**
 * Workflow graph structure for extraction
 */
export interface WorkflowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

/**
 * Extract form-input nodes connected to manual trigger from workflow graph
 * Finds nodes connected to the manual trigger's 'input' handle
 */
export function extractFormInputNodes(graph: WorkflowGraph): FormInputConfig[] {
  const nodes = graph.nodes || []
  const edges = graph.edges || []

  // Find the manual trigger node (type is 'manual', aligned with backend)
  const manualTrigger = nodes.find((node) => node.data?.type === 'manual')

  if (!manualTrigger) {
    return []
  }

  // Find edges connected to manual trigger's input handle
  const inputEdges = edges.filter(
    (edge) => edge.target === manualTrigger.id && edge.targetHandle === 'input'
  )

  // Get form-input nodes from source of those edges
  const formInputConfigs: FormInputConfig[] = []

  for (const edge of inputEdges) {
    const sourceNode = nodes.find((n) => n.id === edge.source)
    if (!sourceNode || sourceNode.data?.type !== 'form-input') {
      continue
    }

    const data = sourceNode.data as FormInputNodeData
    formInputConfigs.push({
      nodeId: sourceNode.id,
      label: data.label || data.title || 'Input',
      inputType: data.inputType || BaseType.STRING,
      description: data.hint?.trim() || undefined,
      required: data.required ?? false,
      placeholder: data.placeholder,
      typeOptions: data.typeOptions,
      defaultValue: data.defaultValue,
    })
  }

  return formInputConfigs
}

/**
 * Extract all form-input nodes from graph (for validation)
 * Returns a map of nodeId -> FormInputConfig
 */
export function getAllFormInputNodes(graph: WorkflowGraph): Map<string, FormInputConfig> {
  const nodes = graph.nodes || []
  const configMap = new Map<string, FormInputConfig>()

  for (const node of nodes) {
    if (node.data?.type !== 'form-input') continue

    const data = node.data as FormInputNodeData
    configMap.set(node.id, {
      nodeId: node.id,
      label: data.label || data.title || 'Input',
      inputType: data.inputType || BaseType.STRING,
      description: data.hint?.trim() || undefined,
      required: data.required ?? false,
      placeholder: data.placeholder,
      typeOptions: data.typeOptions,
      defaultValue: data.defaultValue,
    })
  }

  return configMap
}

/**
 * Convert FormInputNodeData to FormInputConfig
 * Utility for converting node data to config format
 */
export function nodeDataToConfig(nodeId: string, data: FormInputNodeData): FormInputConfig {
  return {
    nodeId,
    label: data.label || data.title || 'Input',
    inputType: data.inputType || BaseType.STRING,
    description: data.desc,
    required: data.required ?? false,
    placeholder: data.placeholder,
    typeOptions: data.typeOptions,
    defaultValue: data.defaultValue,
  }
}
