// apps/web/src/components/workflow/utils/variable-conversion.ts

import type { BaseType } from '~/components/workflow/types/unified-types'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import { buildVariableId, getLabelFromVariableId } from './variable-utils'

/**
 * Deduplicate variables by their fullPath (id in new system)
 */
export function deduplicateVariables(variables: UnifiedVariable[]): UnifiedVariable[] {
  const seen = new Map<string, UnifiedVariable>()

  for (const variable of variables) {
    const key = variable.id // Use id as the key (was fullPath)
    if (!seen.has(key) || variable.nodeId) {
      // Prefer variables with nodeId
      seen.set(key, variable)
    }
  }

  return Array.from(seen.values())
}

/**
 * Create a unified output variable
 * NEW SIGNATURE: Uses 'path' instead of 'name'
 */
export function createUnifiedOutputVariable(config: {
  nodeId: string
  path: string // Full path relative to node (e.g., "body.contact.email")
  type: BaseType
  label?: string // Optional - will derive from path if not provided
  description?: string
  enum?: (string | number)[]
  properties?: Record<string, UnifiedVariable>
  items?: UnifiedVariable
  category?: 'node' | 'environment' | 'system' // Default: 'node'
  required?: boolean
  default?: any
  example?: any
  // Support old 'name' parameter for backward compatibility during transition
  name?: string
}): UnifiedVariable {
  // Support both 'path' and legacy 'name' parameter during transition
  const variablePath = config.path || config.name || 'unknown'

  // Build full ID using helper
  const id = buildVariableId(config.nodeId, variablePath)

  // Derive label from path if not provided
  const label = config.label || getLabelFromVariableId(id)

  const variable: UnifiedVariable = {
    id,
    // nodeId: config.nodeId, // Keep for backward compatibility (will be removed in Phase 4)
    // path: variablePath, // Keep for backward compatibility (will be removed in Phase 4)
    // fullPath: id, // Keep for backward compatibility - same as id (will be removed in Phase 4)
    label,
    description: config.description,
    type: config.type,
    category: config.category || 'node',
    enum: config.enum,
    properties: config.properties,
    items: config.items,
    required: config.required,
    default: config.default,
    example: config.example,
  }

  return variable
}

/**
 * Create a nested variable structure from a configuration
 * Automatically generates all intermediate variables
 *
 * Example:
 *   createNestedVariable({
 *     nodeId: 'webhook-123',
 *     basePath: 'body',
 *     type: BaseType.OBJECT,
 *     properties: {
 *       contact: {
 *         type: BaseType.OBJECT,
 *         properties: {
 *           email: { type: BaseType.STRING },
 *           name: { type: BaseType.STRING }
 *         }
 *       }
 *     }
 *   })
 *
 *   Generates:
 *     webhook-123.body (OBJECT)
 *     webhook-123.body.contact (OBJECT)
 *     webhook-123.body.contact.email (STRING)
 *     webhook-123.body.contact.name (STRING)
 */
export function createNestedVariable(config: {
  nodeId: string
  basePath: string
  type: BaseType
  label?: string
  description?: string
  properties?: Record<
    string,
    {
      type: BaseType
      description?: string
      label?: string
      properties?: any
      items?: any
      enum?: (string | number)[]
    }
  >
  items?: {
    type: BaseType
    description?: string
    label?: string
    properties?: any
    enum?: (string | number)[]
  }
  enum?: (string | number)[]
}): UnifiedVariable {
  const variable = createUnifiedOutputVariable({
    nodeId: config.nodeId,
    path: config.basePath,
    type: config.type,
    label: config.label,
    description: config.description,
    enum: config.enum,
  })

  // Recursively create property variables
  if (config.properties) {
    variable.properties = {}
    Object.entries(config.properties).forEach(([key, propConfig]) => {
      const propPath = `${config.basePath}.${key}`
      variable.properties![key] = createNestedVariable({
        nodeId: config.nodeId,
        basePath: propPath,
        ...propConfig,
      })
    })
  }

  // Create array item variable
  if (config.items) {
    const itemPath = `${config.basePath}[*]`
    variable.items = createNestedVariable({
      nodeId: config.nodeId,
      basePath: itemPath,
      ...config.items,
    })
  }

  return variable
}

/**
 * Check if a variable can be navigated into (has nested structure)
 * Used in UI components for determining if a variable shows expand/navigate UI
 */
export function isNavigableVariable(variable: UnifiedVariable): boolean {
  return !!(variable.properties && Object.keys(variable.properties).length > 0) || !!variable.items
}
