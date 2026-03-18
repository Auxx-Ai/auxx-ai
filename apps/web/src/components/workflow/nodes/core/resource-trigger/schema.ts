// apps/web/src/components/workflow/nodes/core/resource-trigger/schema.ts

import { WorkflowTriggerType } from '@auxx/lib/workflow-engine/client'
import { NodeCategory, type NodeDefinition } from '~/components/workflow/types'
import { getResourceTriggerOutputVariables } from './output-variables'
import {
  type ResourceTriggerData,
  resourceTriggerNodeDataSchema,
  type ValidationResult,
} from './types'

/** Operations configuration */
const RESOURCE_OPERATIONS: Record<string, { operation: string; label: string }> = {
  created: { operation: 'created', label: 'Created' },
  updated: { operation: 'updated', label: 'Updated' },
  deleted: { operation: 'deleted', label: 'Deleted' },
  manual: { operation: 'manual', label: 'Manual' },
}

/**
 * Get the appropriate icon for a resource/operation combination
 */
function getResourceTriggerIcon(resourceType: string, operation: string): string {
  const operationSuffixes: Record<string, string> = {
    created: 'Plus',
    updated: '',
    deleted: 'Minus',
    manual: 'Play',
  }

  if (operation === 'manual') return 'Play'
  if (operation === 'updated') return 'Zap'

  const suffix = operationSuffixes[operation] || ''
  return suffix ? `Zap${suffix}` : 'Zap'
}

/**
 * Create default data for resource trigger
 */
export function createResourceTriggerDefaultData(
  resourceType: string = 'contact',
  operation: string = 'created'
): Partial<ResourceTriggerData> {
  const operationConfig = RESOURCE_OPERATIONS[operation]

  return {
    title: `Record ${operationConfig?.label || operation}`,
    desc: `Triggered when a record is ${operation}`,
    description: `Triggered when a record is ${operation}`,
    icon: getResourceTriggerIcon(resourceType, operation),
    variables: [],
    isValid: true,
    errors: [],
    disabled: false,
    outputVariables: [],
    resourceType,
    operation: operation as 'created' | 'updated' | 'deleted' | 'manual',
  }
}

/**
 * Validation function
 */
export const validateResourceTriggerConfig = (data: ResourceTriggerData): ValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  if (!data.resourceType?.trim()) {
    errors.push({ field: 'resourceType', message: 'Resource type is required', type: 'error' })
  }

  if (!data.operation) {
    errors.push({ field: 'operation', message: 'Operation is required', type: 'error' })
  }

  if (!data.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  if (data.title && data.title.length > 100) {
    errors.push({
      field: 'title',
      message: 'Title is too long (max 100 characters)',
      type: 'warning',
    })
  }

  if (data.description && data.description.length > 500) {
    errors.push({
      field: 'description',
      message: 'Description is too long (max 500 characters)',
      type: 'warning',
    })
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/**
 * Unified resource trigger definition
 * Now supports both system resources and custom entities
 */
export const resourceTriggerDefinition: NodeDefinition<ResourceTriggerData> = {
  id: 'resource-trigger',
  category: NodeCategory.TRIGGER,
  displayName: 'Record',
  description: 'Triggers when a record event occurs (create, update, delete, or manual)',
  icon: 'zap',
  color: '#10b981',
  defaultData: createResourceTriggerDefaultData('contact', 'created'),
  schema: resourceTriggerNodeDataSchema,
  validator: validateResourceTriggerConfig,
  triggerType: WorkflowTriggerType.RESOURCE_TRIGGER,
  // Pattern: Accepts resource context from var store for dynamic variable generation
  outputVariables: getResourceTriggerOutputVariables,
}
