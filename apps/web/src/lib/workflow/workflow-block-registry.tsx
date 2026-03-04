// apps/web/src/lib/workflow/workflow-block-registry.ts

import { WorkflowTriggerType } from '@auxx/lib/workflow-engine/client'
import type { ComponentType } from 'react'
import type {
  NodeDefinition,
  NodePanelProps,
  ValidationResult,
} from '~/components/workflow/types/registry'
import { NodeCategory } from '~/components/workflow/types/registry'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import { resolveAppBlockOutputFields } from '~/lib/workflow/utils/resolve-app-outputs'
import { convertOutputFieldsToVariables } from '~/lib/workflow/utils/type-mapping'
// import { AppWorkflowNode } from './components/app-workflow-node'
import { AppWorkflowPanel } from './components/app-workflow-panel'
import type { WorkflowBlock } from './types'

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
  registerBlocks(
    appId: string,
    installationId: string,
    blocks: WorkflowBlock[],
    appMeta?: { appSlug: string; installationType: 'development' | 'production' }
  ): NodeDefinition[] {
    // Cache the blocks
    const cacheKey = `${appId}:${installationId}`
    schemaCache.set(cacheKey, blocks)

    const nodeDefinitions: NodeDefinition[] = []

    for (const block of blocks) {
      const blockKey = `${appId}:${block.id}`

      // Store block
      this.blocks.set(blockKey, block)

      // Create NodeDefinition
      const nodeDefinition = this.createNodeDefinition(appId, installationId, block, appMeta)
      this.nodeDefinitions.set(blockKey, nodeDefinition)
      nodeDefinitions.push(nodeDefinition)
    }

    return nodeDefinitions
  }

  /**
   * Register workflow triggers from an app.
   * Triggers use NodeCategory.TRIGGER + triggerType: APP_TRIGGER so they
   * appear in the trigger selector UI (not the action block selector).
   */
  registerTriggers(
    appId: string,
    installationId: string,
    triggers: WorkflowBlock[],
    appMeta?: { appSlug: string; installationType: 'development' | 'production' }
  ): NodeDefinition[] {
    const nodeDefinitions: NodeDefinition[] = []

    for (const trigger of triggers) {
      const triggerKey = `${appId}:${trigger.id}`
      this.blocks.set(triggerKey, trigger)

      const definition: NodeDefinition = {
        id: triggerKey,
        category: NodeCategory.TRIGGER,
        triggerType: WorkflowTriggerType.APP_TRIGGER,
        displayName: trigger.label,
        description: trigger.description || '',
        icon: trigger.icon || '⚡',
        color: trigger.color,

        defaultData: {
          title: trigger.label,
          desc: trigger.description,
          type: 'app-trigger',
          appId,
          appSlug: appMeta?.appSlug,
          installationId,
          installationType: appMeta?.installationType,
          triggerId: trigger.id,
          ...this.getDefaultInputValues(trigger.schema.inputs),
        },

        schema: trigger.schema,
        validator: (data: any) => this.validateBlockData(trigger, data),
        outputVariables: (data: any, nodeId: string) =>
          this.createOutputVariables(trigger, nodeId, data),
        panel: this.createPanelComponent(
          appId,
          installationId,
          trigger
        ) as ComponentType<NodePanelProps>,
        canRunSingle: false,
      }

      this.nodeDefinitions.set(triggerKey, definition)
      nodeDefinitions.push(definition)
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
    block: WorkflowBlock,
    appMeta?: { appSlug: string; installationType: 'development' | 'production' }
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
        appSlug: appMeta?.appSlug,
        installationId: installationId,
        installationType: appMeta?.installationType,
        blockId: block.id,
        ...this.getDefaultInputValues(block.schema.inputs),
      },

      // Schema (pass through)
      schema: block.schema,

      // Validation
      validator: (data: any) => this.validateBlockData(block, data),

      // Output variables — merges static schema.outputs + computed outputs from data._computedOutputs
      outputVariables: (data: any, nodeId: string) =>
        this.createOutputVariables(block, nodeId, data),

      // UI Components - wrapped to handle app communication
      panel: this.createPanelComponent(
        appId,
        installationId,
        block
      ) as ComponentType<NodePanelProps>,

      // Execution
      canRunSingle: block.config?.canRunSingle ?? true,
      extractVariables: (data: any) => this.extractAppBlockVariables(block, data),

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

    // Only run custom validation if the block defines it.
    // Required-field checks are intentionally omitted here: the serialized schema
    // cannot know which fields are currently visible (conditional on mode selectors),
    // and the Lambda execute function validates required fields with full context.
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
   * Create output variables for a block.
   * Merges static schema.outputs + computed outputs + inferred schema.
   */
  private createOutputVariables(
    block: WorkflowBlock,
    nodeId: string,
    data?: any
  ): UnifiedVariable[] {
    const merged = resolveAppBlockOutputFields(block, data)
    return convertOutputFieldsToVariables(merged, nodeId)
  }

  /**
   * Extract variable IDs referenced by an app block's input fields.
   * Mirrors the backend's AppWorkflowBlockProcessor.extractRequiredVariables() logic:
   * only fields in variable mode (fieldModes[field] === false) are scanned.
   */
  private extractAppBlockVariables(block: WorkflowBlock, data: any): string[] {
    const fieldModes: Record<string, boolean> = data?.fieldModes || {}
    const variables = new Set<string>()
    const varPattern = /\{\{([^}]+)\}\}/g

    for (const fieldName of Object.keys(block.schema.inputs || {})) {
      // Only extract from fields in variable mode (constant mode = true/undefined)
      if (fieldModes[fieldName] !== false) continue

      const value = data?.[fieldName]
      if (typeof value !== 'string' || !value) continue

      // Extract {{variable}} template references
      let match: RegExpExecArray | null
      while ((match = varPattern.exec(value)) !== null) {
        const varId = match[1].trim()
        if (varId) variables.add(varId)
      }

      // Plain variable path (PICKER mode — no {{ }} wrapper)
      if (!value.includes('{{') && value.length > 0) {
        variables.add(value)
      }
    }

    return Array.from(variables)
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
