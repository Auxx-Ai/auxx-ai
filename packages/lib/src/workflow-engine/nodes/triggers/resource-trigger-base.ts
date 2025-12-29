// packages/lib/src/workflow-engine/nodes/triggers/resource-trigger-base.ts

import { BaseNodeProcessor } from '../base-node'
import type { WorkflowNode, NodeExecutionResult, ValidationResult } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import type { ExecutionContextManager } from '../../core/execution-context'
import { RESOURCE_CONFIGS, RESOURCE_OPERATIONS } from '../../../resources/definitions'
import {
  setResourceVariables,
  setEntityVariables,
  isCustomResourceId,
} from '../../../resources/registry'
import type { TableId } from '../../../resources/registry/field-registry'

/**
 * Unified trigger node processor for all resource-based triggers
 * Handles resource triggers by extracting resourceType and operation from node.data
 */
export class ResourceTriggerBase extends BaseNodeProcessor {
  readonly type = 'resource-trigger' as WorkflowNodeType

  protected extractRequiredVariables(node: WorkflowNode): string[] {
    // Trigger nodes don't depend on upstream variables
    return []
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    // Extract resourceType and operation from node.data
    const resourceType = node.data.resourceType as string
    const operation = node.data.operation as string

    if (!resourceType || !operation) {
      throw new Error(
        `Resource trigger missing resourceType or operation in node.data. ` +
          `Got: resourceType="${resourceType}", operation="${operation}"`
      )
    }

    // Validate operation is valid (same for both system and custom resources)
    if (!RESOURCE_OPERATIONS[operation]) {
      throw new Error(`Invalid operation: "${operation}"`)
    }

    // Validate resource type - custom entities skip static config validation
    const isCustomEntity = isCustomResourceId(resourceType)
    if (!isCustomEntity && !RESOURCE_CONFIGS[resourceType as TableId]) {
      throw new Error(`Invalid resource type: "${resourceType}"`)
    }

    const context = contextManager.getContext()

    // Get trigger data from context
    const triggerData = context.triggerData?.[resourceType]
    if (!triggerData) {
      throw new Error(
        `No trigger data for resource type: "${resourceType}". ` +
          `Expected context.triggerData to have key "${resourceType}"`
      )
    }

    // Set workflow variables from the resource data
    // Use appropriate function based on resource type
    if (isCustomEntity) {
      setEntityVariables(resourceType, triggerData, contextManager, node.nodeId)
    } else {
      setResourceVariables(resourceType as TableId, triggerData, contextManager, node.nodeId)
    }

    // Set trigger metadata
    this.setTriggerMetadata(context, contextManager, node.nodeId, resourceType, operation)

    // Set organization context if available
    if (context.organizationId) {
      contextManager.setVariable('organizationId', context.organizationId)
    }

    // Apply any filters from node data
    if (node.data.filters) {
      const passesFilters = await this.applyFilters(node.data.filters, triggerData, contextManager)
      if (!passesFilters) {
        contextManager.log('INFO', node.name, `${resourceType} filtered out by trigger conditions`)
        return {
          status: NodeRunningStatus.Skipped,
          output: { filtered: true, reason: 'Did not pass trigger filters' },
        }
      }
    }

    return {
      output: {
        resourceType,
        operation,
        data: triggerData,
      },
    }
  }

  /**
   * Set trigger-specific metadata variables
   */
  private setTriggerMetadata(
    context: any,
    contextManager: ExecutionContextManager,
    nodeId: string,
    resourceType: string,
    operation: string
  ): void {
    // Always set timestamp
    contextManager.setNodeVariable(nodeId, 'trigger.timestamp', new Date().toISOString())
    contextManager.setNodeVariable(nodeId, 'trigger.operation', operation)

    // Set operation-specific metadata
    switch (operation) {
      case 'manual':
        // Manual trigger metadata - who triggered and what resource
        contextManager.setNodeVariable(nodeId, 'trigger.source', 'manual')
        contextManager.setNodeVariable(nodeId, 'trigger.resourceType', resourceType)
        if (context.triggerData?.createdBy) {
          contextManager.setNodeVariable(nodeId, 'trigger.createdBy', context.triggerData.createdBy)
        }
        if (context.triggerData?.[resourceType]?.id) {
          contextManager.setNodeVariable(
            nodeId,
            'trigger.resourceId',
            context.triggerData[resourceType].id
          )
        }
        break

      case 'updated':
        if (context.changedFields) {
          contextManager.setNodeVariable(nodeId, 'trigger.changedFields', context.changedFields)
        }
        if (context.previousValues) {
          contextManager.setNodeVariable(nodeId, 'trigger.previousValues', context.previousValues)
        }
        break

      case 'deleted':
        if (context.deletedBy) {
          contextManager.setNodeVariable(nodeId, 'trigger.deletedBy', context.deletedBy)
          if (context.deletedBy.id) {
            contextManager.setNodeVariable(nodeId, 'trigger.deletedBy.id', context.deletedBy.id)
          }
          if (context.deletedBy.name) {
            contextManager.setNodeVariable(nodeId, 'trigger.deletedBy.name', context.deletedBy.name)
          }
          if (context.deletedBy.email) {
            contextManager.setNodeVariable(
              nodeId,
              'trigger.deletedBy.email',
              context.deletedBy.email
            )
          }
        }
        break
    }
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    // Validate resource type is provided
    if (!node.data.resourceType) {
      errors.push('Resource type is required in node data')
    } else {
      const resourceType = node.data.resourceType as string
      // Custom entities (entity_xxx) skip static config validation
      // They will be validated at runtime when we have database access
      if (!isCustomResourceId(resourceType) && !RESOURCE_CONFIGS[resourceType as TableId]) {
        errors.push(`Invalid resource type: "${resourceType}"`)
      }
    }

    // Validate operation is provided
    if (!node.data.operation) {
      errors.push('Operation is required in node data')
    } else if (!RESOURCE_OPERATIONS[node.data.operation]) {
      errors.push(`Invalid operation: "${node.data.operation}"`)
    }

    // Validate filters if present
    if (node.data.filters) {
      if (typeof node.data.filters !== 'object') {
        errors.push('Filters must be an object')
      }
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Apply filters to determine if the resource should trigger the workflow
   * Future implementation for resource filtering
   */
  private async applyFilters(
    filters: Record<string, any>,
    resourceData: any,
    contextManager: ExecutionContextManager
  ): Promise<boolean> {
    // Future implementation - for now, all resources pass
    contextManager.log('DEBUG', undefined, 'Resource filter evaluation (not yet implemented)', {
      filters,
    })
    return true
  }
}
