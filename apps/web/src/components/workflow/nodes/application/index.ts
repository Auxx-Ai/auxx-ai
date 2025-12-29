// apps/web/src/components/workflow/nodes/application/index.ts

import type { NodeDefinition } from '~/components/workflow/types'
// import { professionalNetworkDefinition } from './professional-network'

/**
 * All app node definitions
 * These are integration nodes that connect to external services
 */
export const APP_NODE_DEFINITIONS: NodeDefinition[] = [
  // professionalNetworkDefinition,
  // Future app definitions will be added here
  // airtableDefinition,
  // slackDefinition,
  // etc.
]

// Re-export specific apps for direct access
// export { professionalNetworkDefinition } from './professional-network'

/**
 * Get app definitions by category or filter
 */
export function getAppsByCategory(category?: string): NodeDefinition[] {
  if (!category) return APP_NODE_DEFINITIONS

  // Future: filter by sub-categories if needed
  return APP_NODE_DEFINITIONS.filter((app) => {
    // For now, all apps are in INTEGRATION category
    // Could add sub-categories later like 'social-media', 'data-storage', etc.
    return true
  })
}

/**
 * Check if an app is available
 */
export function isAppAvailable(appId: string): boolean {
  return APP_NODE_DEFINITIONS.some((app) => app.id === appId)
}

/**
 * Get app definition by ID
 */
export function getAppById(appId: string): NodeDefinition | undefined {
  return APP_NODE_DEFINITIONS.find((app) => app.id === appId)
}
