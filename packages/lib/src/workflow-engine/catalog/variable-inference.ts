// packages/lib/src/workflow-engine/catalog/variable-inference.ts

import { isResourceFieldId, parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { RESOURCE_FIELD_REGISTRY, type TableId } from '../../resources/registry/field-registry'
import { BaseType } from '../core/types'
import type { UnifiedVariable } from '../types/unified-variable'

/**
 * Pure variable-id and variable-shape inference helpers, shared by the builder
 * (apps/web) and the server side of the node catalog.
 *
 * Split out of apps/web utils/variable-utils.ts (Phase 1 step 0 of the node
 * catalog migration): everything here is pure — no store, no React, no DOM.
 * The display-oriented helpers that read `useResourceStore` stayed behind in
 * apps/web. Keeping that boundary is what lets node definitions (and their
 * output resolvers) move into lib without dragging the browser in.
 */

/** Info about a single array segment within a variable ID */
export interface ArraySegmentInfo {
  /** The property name before the bracket (e.g., "to" from "to[*]") */
  path: string
  /** The current accessor value (e.g., "*", "0", "-1") */
  accessor: string
  /** The full segment string (e.g., "to[*]") */
  fullSegment: string
  /**
   * Human-readable label for the property.
   *
   * This module is pure — it has no access to the variable store — so this
   * falls back to the raw key. A raw key is frequently a CUID (a findMany
   * output is keyed on `resource.id`, see `generateFindNodeVariablesFromFields`),
   * so **UI must not render this directly**. Resolve `basePath` through the
   * store and use the resolved `variable.label`, exactly as
   * {@link buildVariableLabelPath} does.
   */
  label: string
  /**
   * The variable id up to and including this segment's key, bracket excluded
   * (e.g. `find_1.orders` for `find_1.orders[*].sku`). Unique within an id by
   * construction, which makes it the stable handle for
   * {@link setSegmentAccessor} — the bare key is not, because one path can
   * nest two arrays of the same name (`items[*].items[0]`).
   */
  basePath: string
  /** Zero-based position among the array segments of this id, in path order. */
  ordinal: number
}

/** Pattern matching array bracket notation in variable IDs */
const ARRAY_SEGMENT_PATTERN = /([^.[]+)\[(-?\d+|\*)\]/g

/**
 * One parsed segment of a variable path — the atom the segment-walk resolver
 * (`ExecutionContextManager.resolveVariablePath`) recurses over.
 */
export interface PathSegment {
  /** The segment's key, bracket stripped (e.g. "to" from "to[*]", "knowledge bases" as-is). */
  key: string
  /** The bracket's accessor, if this segment carried one. */
  index?: number | '*'
}

/** Matches ONE trailing `[<int>|*]` bracket on a single dot-segment — never more than one per segment. */
const SEGMENT_BRACKET_RE = /^(.*)\[(-?\d+|\*)\]$/

/**
 * Parse a full variable path into an ordered list of segments — the sole
 * parser for the segment-walk resolver. Grammar:
 *   path    := segment ("." segment)*
 *   segment := key bracket?
 *   bracket := "[" ("*" | "-"? digit+) "]"
 *
 * Structural characters are ONLY "." (segment separator) and one trailing
 * "[...]" per segment — everything else (spaces, "&", "/") is a legal key
 * character (multi-word findMany plural keys like "knowledge bases" are live
 * prod data; `find-output-keying.test.ts` pins them). `first`/`last`/a bare
 * digit are NOT part of this grammar — they're runtime-contextual array
 * accessors the resolver applies only when the value being navigated is
 * already an array; a plain object property literally named "first" parses
 * here as an ordinary `{ key: "first" }` segment.
 *
 * @example
 * parseVariablePath("find-1.vendors[*].region.name")
 * // → [{ key: "find-1" }, { key: "vendors", index: "*" },
 * //    { key: "region" }, { key: "name" }]
 */
export function parseVariablePath(path: string): PathSegment[] {
  if (!path) return []
  return path.split('.').map((raw) => {
    const match = raw.match(SEGMENT_BRACKET_RE)
    if (!match) return { key: raw }
    const [, key, accessor] = match
    return accessor === '*'
      ? { key: key!, index: '*' as const }
      : { key: key!, index: Number.parseInt(accessor!, 10) }
  })
}

/**
 * Parse all **bracketed** array segments from a variable ID.
 *
 * Only finds segments that already carry a `[…]`. A bare array — a terminal
 * segment whose variable is `ARRAY`-typed but has no bracket, e.g. `find_1.orders`
 * feeding a List node — is invisible here, because deciding that requires the
 * variable store. UI that needs both walks the path against the store instead
 * (see `useVariableArraySegments` in apps/web).
 *
 * @example
 * parseArraySegmentsFromId("nodeId.message.to[*].items[0].name")
 * // → [{ path: "to",    accessor: "*", fullSegment: "to[*]",
 * //      label: "to",    basePath: "nodeId.message.to",          ordinal: 0 },
 * //    { path: "items", accessor: "0", fullSegment: "items[0]",
 * //      label: "items", basePath: "nodeId.message.to[*].items", ordinal: 1 }]
 */
export function parseArraySegmentsFromId(variableId: string): ArraySegmentInfo[] {
  const segments: ArraySegmentInfo[] = []
  let match: RegExpExecArray | null

  // Reset lastIndex for global regex
  ARRAY_SEGMENT_PATTERN.lastIndex = 0
  while ((match = ARRAY_SEGMENT_PATTERN.exec(variableId)) !== null) {
    const key = match[1]!
    segments.push({
      path: key,
      accessor: match[2]!,
      fullSegment: match[0],
      label: key,
      basePath: variableId.slice(0, match.index + key.length),
      ordinal: segments.length,
    })
  }
  return segments
}

/**
 * Set, swap, or strip the array accessor on one segment of a variable ID.
 *
 * Addressed by `basePath` (the id up to and including the segment's key,
 * bracket excluded) rather than by the bare key, so a path that nests two
 * arrays of the same name edits the intended one:
 * `setSegmentAccessor("n.items[*].items[0]", "n.items[*].items", "*")` touches
 * the second `items`, not the first.
 *
 * Passing `null` removes the bracket entirely, yielding the array itself —
 * which is a different declared type from `[*]` (`ARRAY` vs the item's shape)
 * and what array-accepting inputs such as the List node's Input List want. Only
 * meaningful on a terminal segment: stripping a bracket mid-path leaves
 * `orders.sku`, i.e. dotting into an array.
 *
 * @example
 * setSegmentAccessor("nodeId.msg.to[*].name", "nodeId.msg.to", "0")  // → "nodeId.msg.to[0].name"
 * setSegmentAccessor("find_1.orders[*]",      "find_1.orders",      null) // → "find_1.orders"
 * setSegmentAccessor("find_1.orders",         "find_1.orders",      "-1") // → "find_1.orders[-1]"
 */
export function setSegmentAccessor(
  variableId: string,
  basePath: string,
  accessor: string | null
): string {
  if (!variableId.startsWith(basePath)) return variableId

  const rest = variableId.slice(basePath.length)
  const existing = rest.match(/^\[(-?\d+|\*)\]/)
  // A `basePath` must land on a segment boundary — anything else is a caller
  // bug (a truncated prefix), and rewriting there would corrupt the key.
  if (!existing && rest !== '' && !rest.startsWith('.')) return variableId

  const tail = existing ? rest.slice(existing[0].length) : rest
  return `${basePath}${accessor === null ? '' : `[${accessor}]`}${tail}`
}

/**
 * Get display label for an accessor — verbose format for context menu items
 */
export function getArrayAccessorMenuLabel(accessor: string): string {
  if (accessor === '*') return 'All items'
  const idx = Number.parseInt(accessor, 10)
  if (idx === 0) return 'First item'
  if (idx === -1) return 'Last item'
  if (idx < -1) return `${ordinal(Math.abs(idx))} to last`
  return `${ordinal(idx + 1)} item`
}

/**
 * Get compact label for an accessor — for inline display in variable tags
 */
export function getArrayAccessorCompactLabel(accessor: string): string {
  return `[${accessor}]`
}

/** Get ordinal suffix for a number (1st, 2nd, 3rd, etc.) */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

/**
 * Regular expression pattern for matching workflow variables in the format {{variable-name}}
 * Note: This has the 'g' flag for global matching (finding all occurrences)
 */
export const VARIABLE_PATTERN = /\{\{([^}]+)\}\}/g

/**
 * Regular expression pattern for testing if text contains a variable reference
 * Note: This does NOT have the 'g' flag, making it suitable for .test()
 */
const VARIABLE_TEST_PATTERN = /\{\{([^}]+)\}\}/

/**
 * Check if a string contains variable references in the format {{variable-name}}
 * @param text - The text to check for variable references
 * @returns true if the text contains at least one variable reference, false otherwise
 */
export function containsVariableReference(text: string | null | undefined): boolean {
  if (!text) return false
  return VARIABLE_TEST_PATTERN.test(text)
}

/**
 * Extract all tag varIds from string content ({{varId}} format) — used by
 * the non-AI workflow nodes that persist prompt-ish fields as `text: string`.
 * (Relocated from apps/web ui/input-editor/tiptap-converters.ts, which
 * re-exports it.)
 */
export function extractVarIdsFromString(text: string): string[] {
  if (!text) return []

  const varIds: string[] = []
  const varPattern = /\{\{([^}]+)\}\}/g
  let match: RegExpExecArray | null

  while ((match = varPattern.exec(text)) !== null) {
    const varId = match[1]?.trim()
    if (varId) {
      varIds.push(varId)
    }
  }

  return [...new Set(varIds)] // Remove duplicates
}

/**
 * Get the nodeId from a variable ID
 * Examples:
 *   "webhook-123.body.email" → "webhook-123"
 *   "env.API_KEY" → "env"
 *   "sys.userId" → "sys"
 */
export function getNodeIdFromVariableId(variableId: string): string {
  const firstDot = variableId.indexOf('.')
  return firstDot > 0 ? variableId.substring(0, firstDot) : variableId
}

/**
 * Get the path (relative to node) from a variable ID
 * Examples:
 *   "webhook-123.body.email" → "body.email"
 *   "env.API_KEY" → "API_KEY"
 *   "sys.userId" → "userId"
 */
export function getPathFromVariableId(variableId: string): string {
  const firstDot = variableId.indexOf('.')
  return firstDot > 0 ? variableId.substring(firstDot + 1) : ''
}

/**
 * Get the label (last segment) from a variable ID
 * Examples:
 *   "webhook-123.body.contact.email" → "email"
 *   "env.API_KEY" → "API_KEY"
 */
export function getLabelFromVariableId(variableId: string): string {
  const segments = variableId.split('.')
  return segments[segments.length - 1] || variableId
}

/**
 * Build a human-readable label path for a variable ID.
 * Resolves each path segment to its variable label via the supplied resolver.
 *
 * Examples:
 *   "trigger-1.contact.first_name" → "Contact.first_name" (or "Contact.First Name" if labels resolve)
 *   "find-1.tickets" → "Tickets"
 *
 * @param variableId - Full variable ID (e.g., "trigger-1.contact.email")
 * @param resolveVariable - Function to look up a variable by ID
 * @returns Label path string with dot-separated labels
 */
export function buildVariableLabelPath(
  variableId: string,
  resolveVariable: (id: string) => UnifiedVariable | undefined
): string {
  const parts = variableId.split('.')
  if (parts.length <= 1) return ''

  const labels: string[] = []
  // Skip first segment (node ID), resolve labels for remaining segments
  for (let i = 1; i < parts.length; i++) {
    const segment = parts[i]
    if (segment === undefined) continue

    // Check for bracket notation: [*], [0], [-1], [n]
    const bracketMatch = segment.match(/^(.+?)\[(.+)\]$/)
    if (bracketMatch) {
      const baseSegment = bracketMatch[1]!
      const accessor = bracketMatch[2]!

      // Resolve the array parent (without bracket)
      const baseId = [...parts.slice(0, i), baseSegment].join('.')
      const baseVariable = resolveVariable(baseId)
      labels.push(baseVariable?.label || baseSegment)

      if (accessor === '*') {
        // For [*], also resolve the items variable label
        const currentId = parts.slice(0, i + 1).join('.')
        const itemsVariable = resolveVariable(currentId)
        if (itemsVariable?.label) {
          labels.push(itemsVariable.label)
        }
      } else {
        // For [0], [-1], [n], show compact accessor in the label
        labels.push(`[${accessor}]`)
      }
    } else {
      const currentId = parts.slice(0, i + 1).join('.')
      const variable = resolveVariable(currentId)
      labels.push(variable?.label || segment)
    }
  }

  return labels.join('.')
}

/**
 * Build a variable ID from nodeId and path
 * Examples:
 *   ("webhook-123", "body.email") → "webhook-123.body.email"
 *   ("env", "API_KEY") → "env.API_KEY"
 */
export function buildVariableId(nodeId: string, path: string): string {
  return `${nodeId}.${path}`
}

/**
 * Check if a variable ID is a system variable
 */
export function isSystemVariable(variableId: string | undefined): boolean {
  return typeof variableId === 'string' && variableId.startsWith('sys.')
}

/**
 * Check if a variable ID is an environment variable
 */
export function isEnvironmentVariable(variableId: string | undefined): boolean {
  return typeof variableId === 'string' && variableId.startsWith('env.')
}

/**
 * Check if a variable ID is a node variable
 * Node variables must have format "nodeId.path" (contain at least one dot)
 * and not be system or environment variables
 */
export function isNodeVariable(variableId: string | undefined): boolean {
  return (
    typeof variableId === 'string' &&
    !isSystemVariable(variableId) &&
    !isEnvironmentVariable(variableId) &&
    variableId.includes('.')
  )
}

/**
 * Every ref one picker-bound field contributes, whichever shape it holds.
 *
 * A canvas-bound field stores a BARE `nodeId.path`; anything written as text —
 * which is what the agent's `update_node` patches produce — stores the braced
 * `{{nodeId.path}}` form, possibly several inside one string.
 * {@link isNodeVariable} only tests for a dot, so a braced value passes it too
 * and every caller that trusted it recorded the ref verbatim, braces and all.
 * `ref-check` then reads `{{nodeId` as the node name and reports a perfectly
 * valid reference as "points at unknown node", with a did-you-mean that is the
 * same id un-braced — an error the agent cannot act on. Route braced values
 * through {@link extractVarIdsFromString} first, and the bare form still wins
 * the fast path.
 */
export function extractFieldVariableIds(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return []
  if (containsVariableReference(value)) return extractVarIdsFromString(value)
  return isNodeVariable(value) ? [value] : []
}

/**
 * Check if a field is in variable mode (not constant mode)
 * fieldModes[field] === true means constant mode
 * fieldModes[field] === false or undefined means variable mode
 */
export function isVariableMode(
  fieldModes: Record<string, boolean> | undefined,
  field: string
): boolean {
  return fieldModes?.[field] !== true
}

/**
 * Parse variable ID to extract resource type and field key
 * Used to look up metadata from RESOURCE_FIELD_REGISTRY
 *
 * @param variableId - Variable ID in format "nodeId.resourceType.fieldKey"
 * @returns Parsed resource type and field key, or null if not a registry-based variable
 *
 * @example
 * ```typescript
 * parseResourceFieldFromVariableId('find-123.ticket.status')
 * // Returns: { resourceType: 'ticket', fieldKey: 'status' }
 *
 * parseResourceFieldFromVariableId('find-123.ticket.contact.name')
 * // Returns: { resourceType: 'ticket', fieldKey: 'contact.name' }
 * ```
 */
export function parseResourceFieldFromVariableId(
  variableId: string
): { resourceType: TableId; fieldKey: string } | null {
  // Pattern: nodeId.resourceType.fieldKey (e.g., "find-123.ticket.status")
  const parts = variableId.split('.')
  if (parts.length < 3) return null

  const resourceType = parts[1] as TableId
  const fieldKey = parts.slice(2).join('.') // Handle nested paths like "contact.name"

  // Validate that this is a known resource type
  if (!RESOURCE_FIELD_REGISTRY[resourceType]) return null

  return { resourceType, fieldKey }
}

/**
 * Get the item variable from an array variable
 *
 * @param arrayVar - Array variable to extract items from
 * @returns The items variable, or null if not an array
 */
export function getArrayItemVariable(arrayVar: UnifiedVariable): UnifiedVariable | null {
  if (arrayVar.type !== BaseType.ARRAY) return null
  return arrayVar.items || null
}

/**
 * Resolve a field path in a variable structure (supports nested paths like "contact.firstName")
 *
 * @param itemVar - The item variable to traverse
 * @param fieldPath - The field path (e.g., "contact.firstName", "tags")
 * @returns The resolved field variable, or null if not found
 */
export function resolveFieldPath(
  itemVar: UnifiedVariable | null,
  fieldPath: string
): UnifiedVariable | null {
  if (!itemVar || !fieldPath) return null

  const parts = fieldPath.split('.')
  let current = itemVar

  for (const part of parts) {
    // Navigate through properties
    if (current.properties?.[part]) {
      current = current.properties[part]
    } else {
      // Field not found in path
      return null
    }
  }

  return current
}

/**
 * Infer output type for pluck operation
 *
 * @param inputArrayVar - The input array variable
 * @param pluckField - The field path to pluck (e.g., "contact.firstName")
 * @param flatten - Whether to flatten array results
 * @returns The inferred output type metadata
 *
 * @example
 * ```typescript
 * // Pluck simple field: Contact[].email -> string[]
 * inferPluckOutputType(contactsArray, 'email', false)
 * // Returns: { type: BaseType.EMAIL, items: undefined, ... }
 *
 * // Pluck array field with flatten: Contact[].tags (flatten) -> string[]
 * inferPluckOutputType(contactsArray, 'tags', true)
 * // Returns: { type: BaseType.STRING, items: undefined, ... }
 * ```
 */
export function inferPluckOutputType(
  inputArrayVar: UnifiedVariable | null,
  pluckField: string,
  flatten: boolean = false
): {
  type: BaseType
  items?: UnifiedVariable
  resourceId?: string
  properties?: Record<string, UnifiedVariable>
} | null {
  if (!inputArrayVar) return null

  // Get the item structure from the input array
  const itemVar = getArrayItemVariable(inputArrayVar)
  if (!itemVar) return null

  // Resolve the field being plucked
  const fieldVar = resolveFieldPath(itemVar, pluckField)
  if (!fieldVar) return null

  // Detect and unwrap collection wrappers (one-to-many, many-to-many relations)
  // Collection wrappers are objects with:
  // - type: 'object'
  // - fieldReference: 'resourceType:fieldKey' (e.g., 'contact:ticket')
  // - properties.values: array of actual items
  const isCollectionWrapper =
    fieldVar.type === BaseType.OBJECT &&
    fieldVar.fieldReference &&
    isResourceFieldId(fieldVar.fieldReference) &&
    fieldVar.properties?.values?.type === BaseType.ARRAY

  if (isCollectionWrapper && fieldVar.properties?.values?.items) {
    // Extract items from collection.values
    // Note: collection.values.items IS the properties object directly, not a wrapped structure
    const valuesArray = fieldVar.properties.values
    const itemProperties = valuesArray.items! // This is the properties object itself

    // Parse reference to get target resource type using typed parsing
    // "contact:ticket" → { entityDefinitionId: 'contact', fieldId: 'ticket' }
    const { fieldId: targetTable } = parseResourceFieldId(
      fieldVar.fieldReference as ResourceFieldId
    )

    return {
      type: BaseType.OBJECT, // Collection items are always objects (resource types)
      items: undefined, // Objects don't have items (only arrays do)
      resourceId: targetTable,
      properties: itemProperties as any, // Properties will get IDs assigned by calling code
    }
  }

  // If the field itself is an array and flatten is true, unwrap one level
  if (fieldVar.type === BaseType.ARRAY && flatten && fieldVar.items) {
    return {
      type: fieldVar.items.type,
      items: fieldVar.items.items, // Nested items (if any)
      resourceId: fieldVar.items.resourceId,
      properties: fieldVar.items.properties,
    }
  }

  // Return the field's type as-is
  return {
    type: fieldVar.type,
    items: fieldVar.items,
    resourceId: fieldVar.resourceId,
    properties: fieldVar.properties,
  }
}

/**
 * Preserve array structure for operations that don't transform item types
 * (filter, sort, unique, reverse, slice)
 *
 * @param inputArrayVar - The input array variable
 * @returns The same structure (shallow clone)
 */
export function preserveArrayStructure(
  inputArrayVar: UnifiedVariable | null
): UnifiedVariable | null {
  if (!inputArrayVar || inputArrayVar.type !== BaseType.ARRAY) return null

  // Return a shallow copy of the array structure
  return {
    ...inputArrayVar,
    items: inputArrayVar.items ? { ...inputArrayVar.items } : undefined,
  }
}
