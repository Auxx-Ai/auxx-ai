// apps/web/src/components/workflow/nodes/registry-setup.ts

import { NODE_DEFINITIONS } from './core'
import { unifiedNodeRegistry } from './unified-registry'

/**
 * Setup and register all node definitions
 */
export const setupNodeRegistry = () => {
  // Prevent duplicate initialization
  if (unifiedNodeRegistry.getIsInitialized()) {
    console.warn('Node registry already initialized, skipping setup')
    return
  }

  NODE_DEFINITIONS.forEach((definition) => {
    unifiedNodeRegistry.register(definition)
  })

  // Mark as initialized
  unifiedNodeRegistry.markInitialized()

  // Validate registry in development
  if (process.env.NODE_ENV === 'development') {
    const validation = unifiedNodeRegistry.validate()
    const stats = unifiedNodeRegistry.getStats()

    if (!validation.isValid) {
      console.error('Registry validation failed:', validation.errors)
    }

    if (stats.duplicatesFound > 0) {
      console.warn(`Found ${stats.duplicatesFound} duplicate entries in registry`)
    }
  }
}
