// packages/sdk/src/runtime/workflow.ts

import { Host } from './host.js'
import { render } from './reconciler/reconciler.js'
import { SURFACES } from './surfaces.js'
import React, { useState, useEffect, useCallback } from 'react'
// import { WorkflowNodeContext } from '../client/workflow/hooks/use-workflow-node.js'
import { WorkflowContext } from '../client/workflow/hooks/use-workflow-context.js'

/**
 * Runtime representation of a workflow block (serialized format).
 *
 * NOTE: This intentionally uses loose types (`any`) because it operates on
 * serialized JSON data at runtime without TypeScript type information.
 *
 * For type-safe development, use `WorkflowBlock<TSchema>` from '@auxx/sdk'
 * which provides full generic type safety with schema inference.
 *
 * @see {@link WorkflowBlock} in packages/sdk/src/root/workflow/types.ts for the typed version
 */
interface WorkflowBlock {
  id: string
  label: string
  description?: string
  category: string
  icon?: string
  color?: string
  schema: {
    inputs: Record<string, any> // Object format: { fieldName: fieldDefinition }
    outputs: Record<string, any> // Object format: { fieldName: fieldDefinition }
    handles?: {
      sources?: Array<{ id: string; label?: string }>
      targets?: Array<{ id: string; label?: string }>
    }
    validation?: {
      custom?: (data: any) => {
        valid: boolean
        errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }>
      }
    }
  }
  config?: {
    canRunSingle?: boolean
  }
  node?: React.ComponentType<any>
  panel?: React.ComponentType<any>
  execute?: (input: any) => Promise<any>
}

/**
 * Track active panel and node renders (similar to dialogs).
 * Used to prevent memory leaks and manage render lifecycle.
 */
const activePanelRenders = new Map<string, { isInitialRenderComplete: boolean }>()
const activeNodeRenders = new Map<string, { isInitialRenderComplete: boolean }>()

/**
 * Stateful wrapper component for workflow panels.
 * Manages reactive data updates from platform via postMessage.
 *
 * This component stays mounted and re-renders when:
 * - Internal state changes (user interaction via updateData)
 * - External updates from platform (React Flow data changes)
 */
function WorkflowPanelContainer({
  blockId,
  nodeId,
  initialData,
  PanelComponent,
}: {
  blockId: string
  nodeId: string
  initialData: any
  PanelComponent: React.ComponentType<any>
}) {
  const [data, setData] = useState(initialData)

  // Listen for external data updates from platform
  useEffect(() => {
    const handler = (newData: any) => {
      setData((prev: any) => ({ ...prev, ...newData }))
    }

    const unsubscribe = Host.onRequest(`update-panel-data-${nodeId}`, handler)
    return unsubscribe
  }, [nodeId])

  const updateData = useCallback(
    (updates: Partial<any>) => {
      setData((prev: any) => ({ ...prev, ...updates }))
      Host.sendMessage('workflow-node-data-update', { nodeId, data: updates })
    },
    [nodeId]
  )

  const contextValue = {
    nodeId,
    data,
    updateData,
    isReadOnly: false,
  }

  return React.createElement(
    WorkflowContext.Provider,
    { value: contextValue },
    React.createElement(PanelComponent, { blockId, nodeId, data })
  )
}

/**
 * Stateful wrapper component for workflow node visualizations.
 * Same pattern as panel but for read-only display in graph.
 */
function WorkflowNodeContainer({
  blockId,
  nodeId,
  initialData,
  NodeComponent,
}: {
  blockId: string
  nodeId: string
  initialData: any
  NodeComponent: React.ComponentType<any>
}) {
  const [data, setData] = useState(initialData)

  // Listen for external data updates from platform
  useEffect(() => {
    const handler = (newData: any) => {
      setData((prev: any) => ({ ...prev, ...newData }))
    }

    const unsubscribe = Host.onRequest(`update-node-data-${nodeId}`, handler)
    return unsubscribe
  }, [nodeId])

  // Nodes typically don't update data, but provide context for consistency
  const updateData = useCallback((updates: Partial<any>) => {
    // Read-only: changes ignored or logged
    console.warn('[WorkflowNodeContainer] Nodes are read-only, update ignored:', updates)
  }, [])

  const contextValue = {
    nodeId,
    data,
    updateData,
    isReadOnly: true,
  }

  return React.createElement(
    WorkflowContext.Provider,
    { value: contextValue },
    React.createElement(NodeComponent, { blockId, nodeId, data })
  )
}

/**
 * Serialize field nodes to unified WorkflowBlockField format.
 *
 * This function:
 * 1. Calls toJSON() on each field node to get full metadata
 * 2. Maps SDK field types to platform field types
 * 3. Handles nested structures (objects, arrays) recursively
 * 4. Preserves all metadata for both inputs and outputs
 *
 * @param fields - Record of field nodes from schema
 * @param kind - Whether these are input or output fields (for debugging/validation)
 * @returns Record of serialized WorkflowBlockField objects
 */
function serializeFields(
  fields: Record<string, any>,
  kind: 'input' | 'output'
): Record<string, any> {
  const result: Record<string, any> = {}

  for (const [key, fieldNode] of Object.entries(fields)) {
    // Validate field node
    if (!fieldNode || typeof fieldNode.toJSON !== 'function') {
      console.warn(`[Workflow] Invalid field node for ${key}, skipping serialization`)
      continue
    }

    // Call toJSON() to get full field metadata
    const json = fieldNode.toJSON()
    const metadata = json._metadata || {}

    // Build unified field definition
    const field: any = {
      // Core properties
      name: key,
      label: metadata.label || key,
      type: json.type,

      // Metadata
      description: metadata.description,
      required: metadata.required ?? !json.isOptional,
      default: metadata.defaultValue,

      // Input-specific (from workflow fields)
      placeholder: metadata.placeholder,
      acceptsVariables: json.acceptsVariables,
      variableTypes: json.variableTypes,

      // Validation constraints
      min: metadata.min,
      max: metadata.max,
      minLength: metadata.minLength,
      maxLength: metadata.maxLength,
      pattern: metadata.pattern,
      integer: metadata.integer,
      precision: metadata.precision,

      // Select options
      options: metadata.options,

      // Debug marker
      _fieldKind: kind,
    }

    // Runtime validation: ensure type is always set
    if (!field.type) {
      console.error(
        `[Workflow Serialization] Field "${key}" (${kind}) missing type!`,
        { fieldNode, json, metadata }
      )
      // Fallback to 'any' type to prevent crashes
      field.type = 'any'
    }

    // Runtime validation: warn if output fields have input-only properties
    if (kind === 'output') {
      if (field.placeholder) {
        console.warn(`[Workflow] Output field "${key}" has placeholder (will be ignored by platform)`)
      }
      if (field.acceptsVariables) {
        console.warn(
          `[Workflow] Output field "${key}" has acceptsVariables (will be ignored by platform)`
        )
      }
    }

    // Handle nested structures

    // Arrays: serialize item type
    if (json.type === 'array' && json.items) {
      const itemJson = json.items
      const itemMetadata = itemJson._metadata || {}

      field.items = {
        name: 'item',
        label: itemMetadata.label || 'Item',
        type: itemJson.type,
        description: itemMetadata.description,
        required: itemMetadata.required ?? !itemJson.isOptional,
        default: itemMetadata.defaultValue,
        min: itemMetadata.min,
        max: itemMetadata.max,
        minLength: itemMetadata.minLength,
        maxLength: itemMetadata.maxLength,
        pattern: itemMetadata.pattern,
        integer: itemMetadata.integer,
        precision: itemMetadata.precision,
        options: itemMetadata.options,
        _fieldKind: kind,
      }

      // Recursively handle nested arrays or objects
      if (itemJson.type === 'array' && itemJson.items) {
        // Nested array
        field.items.items = serializeNestedField(itemJson.items, kind)
      } else if ((itemJson.type === 'object' || itemJson.type === 'struct') && itemJson.fields) {
        // Array of objects
        field.items.properties = serializeFieldsFromJSON(itemJson.fields, kind)
      }
    }

    // Objects/Structs: serialize properties
    if ((json.type === 'object' || json.type === 'struct') && json.fields) {
      field.properties = serializeFieldsFromJSON(json.fields, kind)
    }

    result[key] = field
  }

  return result
}

/**
 * Helper to serialize fields that are already in JSON format (from nested toJSON() calls)
 */
function serializeFieldsFromJSON(
  fields: Record<string, any>,
  kind: 'input' | 'output'
): Record<string, any> {
  const result: Record<string, any> = {}

  for (const [key, fieldJson] of Object.entries(fields)) {
    const metadata = fieldJson._metadata || {}

    const field: any = {
      name: key,
      label: metadata.label || key,
      type: fieldJson.type,
      description: metadata.description,
      required: metadata.required ?? !fieldJson.isOptional,
      default: metadata.defaultValue,
      placeholder: metadata.placeholder,
      acceptsVariables: fieldJson.acceptsVariables,
      variableTypes: fieldJson.variableTypes,
      min: metadata.min,
      max: metadata.max,
      minLength: metadata.minLength,
      maxLength: metadata.maxLength,
      pattern: metadata.pattern,
      integer: metadata.integer,
      precision: metadata.precision,
      options: metadata.options,
      _fieldKind: kind,
    }

    // Runtime validation: ensure type is always set
    if (!field.type) {
      console.error(
        `[Workflow Serialization] Nested field "${key}" (${kind}) missing type!`,
        { fieldJson, metadata }
      )
      // Fallback to 'any' type to prevent crashes
      field.type = 'any'
    }

    // Handle nested structures recursively
    if (fieldJson.type === 'array' && fieldJson.items) {
      field.items = serializeNestedField(fieldJson.items, kind)
    }

    if ((fieldJson.type === 'object' || fieldJson.type === 'struct') && fieldJson.fields) {
      field.properties = serializeFieldsFromJSON(fieldJson.fields, kind)
    }

    result[key] = field
  }

  return result
}

/**
 * Helper to serialize a single nested field (for recursive cases)
 */
function serializeNestedField(fieldJson: any, kind: 'input' | 'output'): any {
  const metadata = fieldJson._metadata || {}

  const field: any = {
    name: '',
    label: metadata.label || '',
    type: fieldJson.type,
    description: metadata.description,
    required: metadata.required ?? !fieldJson.isOptional,
    default: metadata.defaultValue,
    min: metadata.min,
    max: metadata.max,
    minLength: metadata.minLength,
    maxLength: metadata.maxLength,
    pattern: metadata.pattern,
    integer: metadata.integer,
    precision: metadata.precision,
    options: metadata.options,
    _fieldKind: kind,
  }

  // Runtime validation: ensure type is always set
  if (!field.type) {
    console.error(
      `[Workflow Serialization] Nested field (${kind}) missing type!`,
      { fieldJson, metadata }
    )
    // Fallback to 'any' type to prevent crashes
    field.type = 'any'
  }

  // Recursively handle nested structures
  if (fieldJson.type === 'array' && fieldJson.items) {
    field.items = serializeNestedField(fieldJson.items, kind)
  }

  if ((fieldJson.type === 'object' || fieldJson.type === 'struct') && fieldJson.fields) {
    field.properties = serializeFieldsFromJSON(fieldJson.fields, kind)
  }

  return field
}

/**
 * Get all registered workflow blocks from SURFACES registry.
 * Returns only serializable metadata (no React components or functions).
 * Full blocks remain in SURFACES and are accessed via getWorkflowBlock().
 */
export function getWorkflowBlocks(): WorkflowBlock[] {
  const surfaces = SURFACES.getAll()
  const workflowBlockSurfaces = surfaces.filter((s) => s.type === 'workflow-block')

  // Extract only serializable metadata from each block
  const blocks = workflowBlockSurfaces
    .map((surface) => {
      const fullBlock = (surface as any).block as WorkflowBlock
      if (!fullBlock) return null

      // Extract only serializable properties
      const metadata: any = {
        id: fullBlock.id,
        label: fullBlock.label,
        description: fullBlock.description,
        category: fullBlock.category,
        icon: fullBlock.icon,
        color: fullBlock.color,
        config: fullBlock.config,
      }

      // Serialize schema with unified field definitions
      if (fullBlock.schema) {
        metadata.schema = {
          inputs: serializeFields(fullBlock.schema.inputs || {}, 'input'),
          outputs: serializeFields(fullBlock.schema.outputs || {}, 'output'),
          handles: fullBlock.schema.handles || { sources: [], targets: [] },
          // Exclude validation.custom function (if present)
        }
      }

      // DO NOT include: components.node, components.panel, execute function
      // These remain in SURFACES and are accessed via getWorkflowBlock() for rendering

      return metadata
    })
    .filter(Boolean)

  return blocks
}

/**
 * Get a single workflow block by ID from SURFACES registry
 */
function getWorkflowBlock(blockId: string): WorkflowBlock | undefined {
  const surfaces = SURFACES.getAll()
  const surface = surfaces.find((s) => s.type === 'workflow-block' && s.id === blockId)

  if (!surface) {
    return undefined
  }

  return (surface as any).block as WorkflowBlock
}

/**
 * Render workflow node component with reactive wrapper.
 * Component stays mounted and receives data updates via postMessage.
 */
async function renderWorkflowNode(
  blockId: string,
  nodeId: string,
  data: any
): Promise<{ component: any }> {
  const block = getWorkflowBlock(blockId)

  if (!block) {
    console.error('[Workflow] Block not found:', blockId)
    throw new Error(`Workflow block not found: ${blockId}`)
  }

  const NodeComponent = block.node

  if (!NodeComponent) {
    // Use default visualization based on schema
    return {
      component: createDefaultNodeComponent(block, data),
    }
  }

  // Track this render
  const renderState = { isInitialRenderComplete: false }
  activeNodeRenders.set(nodeId, renderState)

  let component: any = null

  try {
    // Create persistent render with wrapper component
    const renderPromise = render({
      element: React.createElement(WorkflowNodeContainer, {
        blockId,
        nodeId,
        initialData: data,
        NodeComponent,
      }),
      onCommit: (children) => {
        // Check if still active (not cleaned up)
        if (!activeNodeRenders.has(nodeId)) return

        component = { children }

        // After initial render, send updates to platform
        if (renderState.isInitialRenderComplete) {
          Host.sendMessage('workflow-node-updated', {
            nodeId,
            component,
          })
        }
      },
    })

    await renderPromise
    renderState.isInitialRenderComplete = true

    return { component }
  } catch (error) {
    console.error('[Workflow] Node render failed:', error)
    throw error
  }
}

/**
 * Render workflow panel component with reactive wrapper.
 * Component stays mounted and receives data updates via postMessage.
 */
async function renderWorkflowPanel(
  blockId: string,
  nodeId: string,
  data: any
): Promise<{ component: any }> {
  const block = getWorkflowBlock(blockId)

  if (!block) {
    console.error('[Workflow] Block not found for panel:', blockId)
    throw new Error(`Workflow block not found: ${blockId}`)
  }

  const PanelComponent = block.panel

  if (!PanelComponent) {
    // Generate default panel from schema
    return {
      component: generateDefaultPanel(block, data),
    }
  }

  // Track this render
  const renderState = { isInitialRenderComplete: false }
  activePanelRenders.set(nodeId, renderState)

  let component: any = null

  try {
    // Create persistent render with wrapper component
    const renderPromise = render({
      element: React.createElement(WorkflowPanelContainer, {
        blockId,
        nodeId,
        initialData: data,
        PanelComponent,
      }),
      onCommit: (children) => {
        // Check if still active (not cleaned up)
        if (!activePanelRenders.has(nodeId)) return

        component = { children }

        // After initial render, send updates to platform
        if (renderState.isInitialRenderComplete) {
          Host.sendMessage('workflow-panel-updated', {
            nodeId,
            component,
          })
        }
      },
    })

    await renderPromise
    renderState.isInitialRenderComplete = true

    return { component }
  } catch (error) {
    console.error('[Workflow] Panel render failed:', error)
    throw error
  }
}

/**
 * Create default node component when no custom component is provided
 */
function createDefaultNodeComponent(block: WorkflowBlock, _data: any): any {
  // TODO: Implement default node visualization
  // For now, return a simple serialized structure
  return {
    children: [
      {
        instance_type: 'text',
        text: block.label,
      },
    ],
  }
}

/**
 * Generate default panel from schema
 */
function generateDefaultPanel(block: WorkflowBlock, _data: any): any {
  // TODO: Implement automatic panel generation from schema
  // This would create form fields based on block.schema.inputs
  // For now, return a simple serialized structure
  return {
    children: [
      {
        instance_type: 'text',
        text: `Configure ${block.label}`,
      },
    ],
  }
}

/**
 * Cleanup workflow panel render when panel is closed.
 * Prevents memory leaks by removing from active renders map.
 */
function cleanupWorkflowPanelRender(nodeId: string): void {
  activePanelRenders.delete(nodeId)
}

/**
 * Cleanup workflow node render when node is deleted.
 * Prevents memory leaks by removing from active renders map.
 */
function cleanupWorkflowNodeRender(nodeId: string): void {
  activeNodeRenders.delete(nodeId)
}

// ===== Request Handlers =====

// Handler for getting workflow blocks
Host.onRequest('get-workflow-blocks', async () => {
  const blocks = getWorkflowBlocks()
  return { blocks }
})

// Handler for rendering workflow node
Host.onRequest('render-workflow-node', async (data) => {
  return await renderWorkflowNode(data.blockId, data.nodeId, data.data)
})

// Handler for rendering workflow panel
Host.onRequest('render-workflow-panel', async (data) => {
  return await renderWorkflowPanel(data.blockId, data.nodeId, data.data)
})

// Handler for executing workflow block (for single node testing)
Host.onRequest('execute-workflow-block', async (data) => {
  const { blockId, input } = data

  const block = getWorkflowBlock(blockId)

  if (!block) {
    throw new Error(`Workflow block not found: ${blockId}`)
  }

  if (!block.execute) {
    throw new Error(`Workflow block ${blockId} has no execute function`)
  }

  // Execute the block
  // Note: Context is no longer passed - SDK functions read from global.AUXX_SERVER_SDK
  const result = await block.execute(input)

  return { result }
})

// Handler for cleaning up panel renders
Host.onRequest('cleanup-panel-render', async (data: { nodeId: string }) => {
  const { nodeId } = data
  cleanupWorkflowPanelRender(nodeId)
  return { success: true }
})

// Handler for cleaning up node renders
Host.onRequest('cleanup-node-render', async (data: { nodeId: string }) => {
  const { nodeId } = data
  cleanupWorkflowNodeRender(nodeId)
  return { success: true }
})
