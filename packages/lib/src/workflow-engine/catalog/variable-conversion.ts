// packages/lib/src/workflow-engine/catalog/variable-conversion.ts

import type { ResourceFieldId } from '@auxx/types/field'
import type { FieldOptions } from '../../custom-fields/field-options'
import type { BaseType } from '../core/types'
import type { UnifiedVariable } from '../types/unified-variable'
import { buildVariableId, getLabelFromVariableId } from './variable-inference'

/**
 * Output-variable constructors — relocated from apps/web
 * utils/variable-conversion.ts (which re-exports them) so manifests can
 * declare `resolveOutputs` server-side (Phase 2). Already pure: the file sat
 * on the import path of ~24 node schema files and was scrubbed of store/React
 * imports in Phase 1 step 0.
 */

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
  resourceId?: string
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
    ...(config.resourceId && { resourceId: config.resourceId }),
  }

  return variable
}

/**
 * Recursive shape accepted by `createNestedVariable`'s `properties` values and
 * `items` config — one level of a nested variable declaration, minus the
 * path-building fields (`nodeId`/`basePath`) the recursion derives.
 *
 * Union of what the two former implementations each supported: `enum` (this
 * file's original contribution) plus `fieldReference`/`resourceId`/`options`
 * (originally only in `packages/lib/src/resources/variable-generators.ts`'s
 * now-deleted private copy, needed there for ACTOR field references, select
 * options, and relation-expansion resource ids at every nesting level).
 */
export interface NestedVariableConfig {
  type: BaseType
  label?: string
  description?: string
  enum?: (string | number)[]
  /**
   * Typed field reference. Format: `${entityDefinitionId}:${fieldId}`.
   */
  fieldReference?: ResourceFieldId
  /**
   * Direct resource ID — for when the variable IS a resource, not a field ON
   * one. Accepts `null` in addition to `undefined` because the resources
   * module derives it via `getRelatedEntityDefinitionId`, which returns
   * `string | null`; either falsy value is dropped by the `&&` guard below,
   * so this is a type-only widening, not a behavior difference.
   */
  resourceId?: string | null
  /**
   * Field options — the select `{ options: [...] }` shape, the ACTOR
   * `{ actor: ... }` shape, or any other `FieldOptions` payload. Matches
   * `UnifiedVariable.options`'s declared type.
   */
  options?: FieldOptions
  properties?: Record<string, NestedVariableConfig>
  items?: NestedVariableConfig
}

/**
 * Intermediate builder shape used while constructing the `UnifiedVariable`
 * below. `UnifiedVariable.label` is declared as always-present (`string`),
 * but a caller with `deriveLabel: false` and no explicit `label` legitimately
 * produces `undefined` (e.g. resources' `createTriggerMetadata`'s `timestamp`
 * property) — existing, frozen behavior, not something to paper over by
 * inventing a value. This widens locally rather than loosening the shared
 * `UnifiedVariable` type for every consumer.
 */
type DraftVariable = Omit<UnifiedVariable, 'label' | 'properties' | 'items'> & {
  label?: string
  properties?: Record<string, DraftVariable>
  items?: DraftVariable
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
export function createNestedVariable(
  config: NestedVariableConfig & {
    nodeId: string
    basePath: string
    /**
     * Whether an absent `label` should be derived from the variable id via
     * `getLabelFromVariableId` — the historical behavior of this function,
     * relied on by catalog node callers (e.g. `message-received.ts`) that
     * omit `label` on nested properties and expect the picker to show a
     * derived one. `packages/lib/src/resources`'s generators pass `false`:
     * their fields already carry a `label` from the field registry, and the
     * few paths that omit one intentionally leave it `undefined` rather than
     * inventing one. Defaults to `true` (the original, unchanged behavior).
     */
    deriveLabel?: boolean
  }
): UnifiedVariable {
  const { nodeId, basePath, deriveLabel = true } = config
  const id = buildVariableId(nodeId, basePath)
  const label = config.label ?? (deriveLabel ? getLabelFromVariableId(id) : undefined)

  // Only include optional props when present — mirrors the resources
  // module's original construction so its golden-snapshot payloads (which
  // never carried explicitly-undefined keys) stay byte-identical.
  const variable: DraftVariable = {
    id,
    type: config.type,
    label,
    category: 'node',
    ...(config.description && { description: config.description }),
    ...(config.enum && { enum: config.enum }),
    ...(config.fieldReference && { fieldReference: config.fieldReference }),
    ...(config.resourceId && { resourceId: config.resourceId }),
    ...(config.options && { options: config.options }),
  }

  // Recursively create property variables
  if (config.properties) {
    variable.properties = {}
    Object.entries(config.properties).forEach(([key, propConfig]) => {
      const propPath = `${basePath}.${key}`
      variable.properties![key] = createNestedVariable({
        nodeId,
        basePath: propPath,
        deriveLabel,
        ...propConfig,
      })
    })
  }

  // Create array item variable
  if (config.items) {
    const itemPath = `${basePath}[*]`
    variable.items = createNestedVariable({
      nodeId,
      basePath: itemPath,
      deriveLabel,
      ...config.items,
    })
  }

  return variable as UnifiedVariable
}

/**
 * Check if a variable can be navigated into (has nested structure)
 * Used in UI components for determining if a variable shows expand/navigate UI
 */
export function isNavigableVariable(variable: UnifiedVariable): boolean {
  return !!(variable.properties && Object.keys(variable.properties).length > 0) || !!variable.items
}
