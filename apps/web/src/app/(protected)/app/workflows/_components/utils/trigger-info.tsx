// apps/web/src/app/(protected)/app/workflows/_components/utils/trigger-info.tsx

import { unifiedNodeRegistry } from '~/components/workflow/nodes/unified-registry'

/**
 * Interface for trigger information
 */
export interface TriggerInfo {
  id: string
  icon: string
  title: string
  description: string
  color?: string
}

/**
 * Get all available triggers from the unified registry
 */
export function getAllTriggers(): TriggerInfo[] {
  const triggerDefinitions = unifiedNodeRegistry.getTriggerDefinitions()

  return triggerDefinitions.map((definition) => ({
    id: definition.id,
    icon: definition.icon,
    title: definition.displayName,
    description: definition.description,
    color: definition.color,
  }))
}

/**
 * Get trigger information for a specific trigger ID
 */
export function getTriggerInfo(triggerId: string): TriggerInfo {
  const definition = unifiedNodeRegistry.getDefinition(triggerId)

  if (!definition || !unifiedNodeRegistry.isTrigger(triggerId)) {
    // Fallback for unknown trigger types
    return {
      id: triggerId,
      icon: 'Box',
      title: triggerId || 'Unknown',
      description: 'Unknown trigger type',
      color: '#8B5CF6',
    }
  }

  return {
    id: definition.id,
    icon: definition.icon,
    title: definition.displayName,
    description: definition.description,
    color: definition.color,
  }
}
