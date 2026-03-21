// packages/sdk/src/runtime/workflow.ts

import React, { useCallback, useEffect, useState } from 'react'
// import { WorkflowNodeContext } from '../client/workflow/hooks/use-workflow-node.js'
import { WorkflowContext } from '../client/workflow/hooks/use-workflow-context.js'
import { Host } from './host.js'
import { render } from './reconciler/reconciler.js'
import { SURFACES } from './surfaces.js'

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
    layout?: Array<{
      type: 'section'
      title: string
      description?: string
      fields: string[]
      collapsible?: boolean
      initialOpen?: boolean
    }>
    computeOutputs?: (inputs: Record<string, any>) => Record<string, any>
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

  // Evaluate computeOutputs whenever data changes
  useEffect(() => {
    const block = getWorkflowBlock(blockId)
    if (block) {
      evaluateComputeOutputs(block, nodeId, data)
    }
  }, [blockId, nodeId, data])

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
      required: metadata.required ?? false,
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

      // Multi-select
      multi: metadata.multi,
      canAdd: metadata.canAdd,
      canManage: metadata.canManage,

      // Debug marker
      _fieldKind: kind,
    }

    // Runtime validation: ensure type is always set
    if (!field.type) {
      console.error(`[Workflow Serialization] Field "${key}" (${kind}) missing type!`, {
        fieldNode,
        json,
        metadata,
      })
      // Fallback to 'any' type to prevent crashes
      field.type = 'any'
    }

    // Runtime validation: warn if output fields have input-only properties
    if (kind === 'output') {
      if (field.placeholder) {
        console.warn(
          `[Workflow] Output field "${key}" has placeholder (will be ignored by platform)`
        )
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
        required: itemMetadata.required ?? false,
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
      required: metadata.required ?? false,
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
      multi: metadata.multi,
      canAdd: metadata.canAdd,
      canManage: metadata.canManage,
      _fieldKind: kind,
    }

    // Runtime validation: ensure type is always set
    if (!field.type) {
      console.error(`[Workflow Serialization] Nested field "${key}" (${kind}) missing type!`, {
        fieldJson,
        metadata,
      })
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
    name: metadata.label || 'item',
    label: metadata.label || '',
    type: fieldJson.type,
    description: metadata.description,
    required: metadata.required ?? false,
    default: metadata.defaultValue,
    min: metadata.min,
    max: metadata.max,
    minLength: metadata.minLength,
    maxLength: metadata.maxLength,
    pattern: metadata.pattern,
    integer: metadata.integer,
    precision: metadata.precision,
    options: metadata.options,
    multi: metadata.multi,
    canAdd: metadata.canAdd,
    canManage: metadata.canManage,
    _fieldKind: kind,
  }

  // Runtime validation: ensure type is always set
  if (!field.type) {
    console.error(`[Workflow Serialization] Nested field (${kind}) missing type!`, {
      fieldJson,
      metadata,
    })
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
 * Resolve a block icon string, auto-prefixing bare data URLs and http(s) URLs.
 * App developers can set `icon: slackIcon` (imported PNG → data URL) or
 * `icon: 'https://...'` and the SDK normalizes them to `base64:` / `url:` prefixes.
 */
function resolveBlockIcon(icon: unknown): string | undefined {
  if (typeof icon !== 'string' || !icon) return undefined
  // Already prefixed — pass through
  if (icon.startsWith('url:') || icon.startsWith('base64:')) return icon
  // Bare data URL from PNG import → prefix with base64:
  if (icon.startsWith('data:')) return `base64:${icon}`
  // Bare HTTP(S) URL → prefix with url:
  if (icon.startsWith('http://') || icon.startsWith('https://')) return `url:${icon}`
  // Lucide name or emoji — pass through
  return icon
}

/**
 * Get all registered workflow blocks from SURFACES registry.
 * Returns only serializable metadata (no React components or functions).
 * Full blocks remain in SURFACES and are accessed via getWorkflowBlock().
 */
export function getWorkflowBlocks(): WorkflowBlock[] {
  const surfaces = SURFACES.getAll()
  const workflowBlockSurfaces = surfaces.filter(
    (s) => s.type === 'workflow-block' && (s as any).blockType !== 'trigger'
  )

  return workflowBlockSurfaces
    .map(serializeBlockSurface)
    .filter((b): b is WorkflowBlock => b !== null)
}

/**
 * Get all registered workflow triggers from SURFACES registry.
 * Returns only serializable metadata (no React components or functions).
 */
export function getWorkflowTriggers(): WorkflowBlock[] {
  const surfaces = SURFACES.getAll()
  const triggerSurfaces = surfaces.filter(
    (s) => s.type === 'workflow-block' && (s as any).blockType === 'trigger'
  )

  return triggerSurfaces.map(serializeBlockSurface).filter((b): b is WorkflowBlock => b !== null)
}

/**
 * Serialize a workflow block/trigger surface into JSON-safe metadata.
 */
function serializeBlockSurface(surface: any): WorkflowBlock | null {
  const fullBlock = surface.block as WorkflowBlock
  if (!fullBlock) return null

  // Extract only serializable properties
  const metadata: any = {
    id: fullBlock.id,
    label: fullBlock.label,
    description: fullBlock.description,
    category: fullBlock.category,
    icon: resolveBlockIcon(fullBlock.icon),
    color: fullBlock.color,
    config: fullBlock.config,
  }

  // Serialize schema with unified field definitions
  if (fullBlock.schema) {
    metadata.schema = {
      inputs: serializeFields(fullBlock.schema.inputs || {}, 'input'),
      outputs: serializeFields(fullBlock.schema.outputs || {}, 'output'),
      handles: fullBlock.schema.handles || { sources: [], targets: [] },
      layout: fullBlock.schema.layout,
      // Exclude validation.custom function (if present)
    }
  }

  // Flag whether this block has a custom panel
  metadata.hasPanel = !!fullBlock.panel

  // DO NOT include: components.node, components.panel, execute function
  // These remain in SURFACES and are accessed via getWorkflowBlock() for rendering

  return metadata
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
    const defaultPanel = generateDefaultPanel(block, data)

    // Evaluate computeOutputs for default panels too
    evaluateComputeOutputs(block, nodeId, data)

    return {
      component: defaultPanel,
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
 * Generate default panel from schema using VarFieldGroup > VarField > VarInput components.
 *
 * When a block has no custom panel component, this creates a configuration panel
 * automatically from the schema's input field definitions and optional layout.
 */
function generateDefaultPanel(block: WorkflowBlock, _data: any): any {
  const serializedInputs = serializeFields(block.schema.inputs || {}, 'input')
  const inputFields = Object.entries(serializedInputs)

  if (inputFields.length === 0) {
    return {
      children: [{ instance_type: 'text', text: `Configure ${block.label}` }],
    }
  }

  // Use layout if defined, otherwise create a single default section
  const layout = block.schema.layout || [
    {
      type: 'section' as const,
      title: 'Configuration',
      fields: inputFields.map(([name]) => name),
    },
  ]

  return {
    children: layout.map((section: any) => ({
      instance_type: 'instance',
      component: 'WorkflowSection',
      attributes: {
        title: section.title,
        description: section.description,
        collapsible: section.collapsible,
        defaultOpen: section.initialOpen ?? true,
      },
      children: [
        {
          instance_type: 'instance',
          component: 'WorkflowVarFieldGroup',
          attributes: {},
          children: section.fields
            .map((fieldName: string) => {
              const field = serializedInputs[fieldName]
              if (!field) return null

              return {
                instance_type: 'instance',
                component: 'WorkflowVarField',
                attributes: {},
                children: [
                  {
                    instance_type: 'instance',
                    component: 'VarInputInternal',
                    attributes: {
                      name: fieldName,
                      type: field.type,
                      placeholder: field.placeholder,
                      acceptsVariables: field.acceptsVariables,
                      variableTypes: field.variableTypes,
                      format: field.format,
                      options: field.options,
                    },
                  },
                ],
              }
            })
            .filter(Boolean),
        },
      ],
    })),
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

// ===== computeOutputs =====

/** Debounce timers per node for computeOutputs evaluation */
const computeOutputsTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Evaluate a block's computeOutputs function and send the result to the host.
 * Debounced to avoid excessive messages during rapid editing.
 */
function evaluateComputeOutputs(block: WorkflowBlock, nodeId: string, data: any): void {
  if (!block.schema?.computeOutputs) return

  // Clear existing timer
  const existing = computeOutputsTimers.get(nodeId)
  if (existing) clearTimeout(existing)

  computeOutputsTimers.set(
    nodeId,
    setTimeout(() => {
      computeOutputsTimers.delete(nodeId)
      try {
        const computed = block.schema.computeOutputs!(data)
        if (computed && typeof computed === 'object') {
          // Serialize the computed output fields
          const serialized = serializeComputedOutputs(computed)
          Host.sendMessage('workflow-block-outputs-updated', {
            nodeId,
            blockId: block.id,
            outputs: serialized,
          })
        }
      } catch (err) {
        console.error('[Workflow] computeOutputs error:', err)
        // Static outputs remain as fallback — no action needed
      }
    }, 300)
  )
}

/**
 * Serialize computed output fields to WorkflowBlockField format.
 * computeOutputs returns field nodes (same shape as schema.outputs).
 */
function serializeComputedOutputs(outputs: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}

  for (const [key, fieldNode] of Object.entries(outputs)) {
    // If it has toJSON, it's a field node — serialize it
    if (fieldNode && typeof fieldNode.toJSON === 'function') {
      const json = fieldNode.toJSON()
      const metadata = json._metadata || {}
      const field: any = {
        name: key,
        label: metadata.label || key,
        type: json.type || 'any',
        description: metadata.description,
        required: metadata.required,
        _fieldKind: 'output' as const,
      }

      // Handle struct/object: recursively serialize nested fields
      if ((json.type === 'object' || json.type === 'struct') && json.fields) {
        field.properties = serializeFieldsFromJSON(json.fields, 'output')
      }

      // Handle array: serialize item schema
      if (json.type === 'array' && json.items) {
        field.items = serializeNestedField(json.items, 'output')
      }

      result[key] = field
    } else if (fieldNode && typeof fieldNode === 'object' && fieldNode.type) {
      // Already serialized — pass through
      result[key] = { name: key, ...fieldNode }
    }
  }

  return result
}

// ===== Request Handlers =====

// Handler for getting workflow blocks and triggers
Host.onRequest('get-workflow-blocks', async () => {
  const blocks = getWorkflowBlocks()
  const triggers = getWorkflowTriggers()
  return { blocks, triggers }
})

// Handler for rendering workflow node
Host.onRequest('render-workflow-node', async (data) => {
  return await renderWorkflowNode(data.blockId, data.nodeId, data.data)
})

// Handler for rendering workflow panel
Host.onRequest('render-workflow-panel', async (data) => {
  return await renderWorkflowPanel(data.blockId, data.nodeId, data.data)
})

// Handler for computing workflow node outputs without rendering a panel.
// Used by the platform to eagerly fetch output schemas for app nodes
// (e.g., after template installation, before the user opens the panel).
Host.onRequest('compute-workflow-node-outputs', async (data) => {
  const block = getWorkflowBlock(data.blockId)
  if (!block?.schema?.computeOutputs) {
    return { outputs: null }
  }
  try {
    const computed = block.schema.computeOutputs(data.data || {})
    if (computed && typeof computed === 'object') {
      return { outputs: serializeComputedOutputs(computed) }
    }
    return { outputs: null }
  } catch (err) {
    console.error('[Workflow] compute-workflow-node-outputs error:', err)
    return { outputs: null }
  }
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
