// apps/web/src/components/workflow/nodes/shared/resource-trigger-utils.ts

/**
 * Get the description for a resource trigger
 */
export function getResourceTriggerDescription(resourceType: string, operation: string): string {
  return `Triggered when a ${resourceType} is ${operation}`
}

/**
 * Get the trigger name for a resource and operation combination
 */
export function getResourceTriggerName(resourceType: string, operation: string): string {
  const operationMap: Record<string, (type: string) => string> = {
    created: (type: string) => `${type.toUpperCase()}_CREATED`,
    updated: (type: string) => `${type.toUpperCase()}_UPDATED`,
    deleted: (type: string) => `${type.toUpperCase()}_DELETED`,
    manual: (type: string) => `${type.toUpperCase()}_MANUAL`,
  }

  const triggerName = operationMap[operation]
  if (!triggerName) {
    throw new Error(`Unknown operation: ${operation}`)
  }
  return triggerName(resourceType)
}
