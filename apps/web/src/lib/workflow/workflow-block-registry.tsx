// apps/web/src/lib/workflow/workflow-block-registry.ts

import type { ComponentType } from 'react'
import type {
  NodeDefinition,
  NodePanelProps,
  ValidationResult,
} from '~/components/workflow/types/registry'
import { NodeCategory } from '~/components/workflow/types/registry'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import { convertOutputFieldsToVariables } from '~/lib/workflow/utils/type-mapping'
// import { AppWorkflowNode } from './components/app-workflow-node'
import { AppWorkflowPanel } from './components/app-workflow-panel'
import type { WorkflowBlock, WorkflowVariable } from './types'

// In-memory cache for loaded blocks
const schemaCache = new Map<string, WorkflowBlock[]>()

/**
 * Converts app workflow blocks to ReactFlow node definitions
 */
export class WorkflowBlockRegistry {
  private blocks = new Map<string, WorkflowBlock>()
  private nodeDefinitions = new Map<string, NodeDefinition>()

  /**
   * Get cached blocks for an app (if available)
   */
  getCachedBlocks(appId: string, installationId: string): WorkflowBlock[] | undefined {
    const cacheKey = `${appId}:${installationId}`
    return schemaCache.get(cacheKey)
  }

  /**
   * Register workflow blocks from an app and cache them
   */
  registerBlocks(appId: string, installationId: string, blocks: WorkflowBlock[]): NodeDefinition[] {
    // Cache the blocks
    const cacheKey = `${appId}:${installationId}`
    schemaCache.set(cacheKey, blocks)

    const nodeDefinitions: NodeDefinition[] = []

    for (const block of blocks) {
      const blockKey = `${appId}:${block.id}`

      // Store block
      this.blocks.set(blockKey, block)

      // Create NodeDefinition
      const nodeDefinition = this.createNodeDefinition(appId, installationId, block)
      this.nodeDefinitions.set(blockKey, nodeDefinition)
      nodeDefinitions.push(nodeDefinition)
    }

    return nodeDefinitions
  }

  /**
   * Unregister workflow blocks from an app
   */
  unregisterBlocks(appId: string): void {
    // Remove all blocks for this app
    for (const [key] of this.blocks) {
      if (key.startsWith(`${appId}:`)) {
        this.blocks.delete(key)
        this.nodeDefinitions.delete(key)
      }
    }
  }

  /**
   * Get all node definitions
   */
  getAllNodeDefinitions(): NodeDefinition[] {
    return Array.from(this.nodeDefinitions.values())
  }

  /**
   * Get node definition by key
   */
  getNodeDefinition(appId: string, blockId: string): NodeDefinition | undefined {
    return this.nodeDefinitions.get(`${appId}:${blockId}`)
  }

  /**
   * Get workflow block by key
   */
  getBlock(appId: string, blockId: string): WorkflowBlock | undefined {
    return this.blocks.get(`${appId}:${blockId}`)
  }

  /**
   * Create NodeDefinition from WorkflowBlock
   */
  private createNodeDefinition(
    appId: string,
    installationId: string,
    block: WorkflowBlock
  ): NodeDefinition {
    return {
      id: `${appId}:${block.id}`,
      category: NodeCategory.INTEGRATION, // Force all app blocks to INTEGRATION (Apps tab)
      subcategory: block.category, // Preserve original category for grouping
      displayName: block.label,
      description: block.description || '',
      icon: block.icon || '🔌',
      color: block.color,

      // Default data factory
      defaultData: {
        title: block.label,
        desc: block.description,
        appId: appId,
        installationId: installationId,
        blockId: block.id,
        ...this.getDefaultInputValues(block.schema.inputs),
      },

      // Schema (pass through)
      schema: block.schema,

      // Validation
      validator: (data: any) => this.validateBlockData(block, data),

      // Output variables
      outputVariables: (data: any, nodeId: string) => this.createOutputVariables(block, nodeId),

      // UI Components - wrapped to handle app communication
      panel: this.createPanelComponent(
        appId,
        installationId,
        block
      ) as ComponentType<NodePanelProps>,

      // Execution
      canRunSingle: block.config?.canRunSingle ?? false,

      // App metadata stored in defaultData
      // The actual node component (AppWorkflowNode) will be registered separately
    }
  }

  /**
   * Map block category to NodeCategory
   */
  private mapCategory(category: string): NodeCategory {
    const mapping: Record<string, NodeCategory> = {
      trigger: NodeCategory.TRIGGER,
      input: NodeCategory.INPUT,
      condition: NodeCategory.CONDITION,
      action: NodeCategory.ACTION,
      transform: NodeCategory.TRANSFORM,
      flow_control: NodeCategory.FLOW_CONTROL,
      data: NodeCategory.DATA,
      integration: NodeCategory.INTEGRATION,
      ai: NodeCategory.AI,
      debug: NodeCategory.DEBUG,
      utility: NodeCategory.UTILITY,
    }

    return mapping[category] || NodeCategory.INTEGRATION
  }

  /**
   * Get default values from inputs
   */
  private getDefaultInputValues(inputs: WorkflowBlock['schema']['inputs']): Record<string, any> {
    const defaults: Record<string, any> = {}

    for (const [name, input] of Object.entries(inputs || {})) {
      if (input.default !== undefined) {
        defaults[name] = input.default
      }
    }

    return defaults
  }

  /**
   * Validate block data
   */
  private validateBlockData(block: WorkflowBlock, data: any): ValidationResult {
    const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

    // Check required fields
    for (const [name, input] of Object.entries(block.schema.inputs || {})) {
      if (input.required && !data[name]) {
        errors.push({
          field: name,
          message: `${input.label} is required`,
          type: 'error',
        })
      }
    }

    // Custom validation if defined
    if (block.schema.validation?.custom) {
      const customResult = block.schema.validation.custom(data)
      if (!customResult.valid) {
        errors.push(...customResult.errors)
      }
    }

    return {
      isValid: errors.filter((e) => e.type !== 'warning').length === 0,
      errors,
    }
  }

  /**
   * Create output variables for a block
   */
  private createOutputVariables(block: WorkflowBlock, nodeId: string): UnifiedVariable[] {
    return convertOutputFieldsToVariables(block.schema.outputs || {}, nodeId)
  }

  /**
   * Create panel component wrapper
   */
  private createPanelComponent(
    appId: string,
    installationId: string,
    block: WorkflowBlock
  ): ComponentType<NodePanelProps> {
    // Return a component that wraps AppWorkflowPanel
    const PanelWrapper = ({ nodeId, data }: NodePanelProps) => {
      return (
        <AppWorkflowPanel
          nodeId={nodeId}
          data={data}
          appId={appId}
          installationId={installationId}
          block={block}
        />
      )
    }
    return PanelWrapper
  }
}
