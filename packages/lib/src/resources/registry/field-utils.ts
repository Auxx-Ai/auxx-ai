// packages/lib/src/resources/registry/field-utils.ts

import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import { parseAppFieldRef, type ResourceFieldId, toResourceFieldId } from '@auxx/types/field'
import { OPERATOR_DEFINITIONS, type Operator } from '../../conditions/operator-definitions'
import {
  getIdentifierEligibility,
  sortByIdentifierPreference,
} from '../../import/fields/identifier-eligibility'
import type { ExecutionContextManager } from '../../workflow-engine/core/execution-context'
import { getOperatorsForType } from '../../workflow-engine/operators/type-operator-map'
import { createResourceReference } from '../../workflow-engine/types/resource-reference'
import { BaseType } from '../types'
import { RESOURCE_FIELD_REGISTRY, type TableId } from './field-registry'
import { getFieldOutputKey, type ResourceField } from './field-types'
import { isCustomResourceId } from './types'

/** The concrete `${defId}:${fieldId}` ref for a field, preferring its own `resourceFieldId`. */
function concreteRefOf(
  field: ResourceField,
  entityDefinitionId: string | null | undefined
): ResourceFieldId {
  return field.resourceFieldId ?? toResourceFieldId(entityDefinitionId ?? '', field.id)
}

/**
 * Does `field` satisfy a stored target ref? Matches a concrete `${defId}:${fieldId}`
 * ref directly, OR a late-bound `@app:` ref by the field's `appFieldKey` (the
 * connector/app-created column). Pass `slugByInstallationId` to additionally require the
 * field's installation to belong to the ref's app slug — disambiguates two apps sharing a
 * key (mirrors the runtime `resolveAppFieldId`). Display/selection only; never mutates.
 */
export function fieldMatchesRef(
  field: ResourceField,
  entityDefinitionId: string | null | undefined,
  ref: string,
  slugByInstallationId?: Map<string, string>
): boolean {
  if (concreteRefOf(field, entityDefinitionId) === ref) return true
  const parts = parseAppFieldRef(ref)
  if (!parts || field.appFieldKey !== parts.appFieldKey) return false
  if (!slugByInstallationId) return true
  return (
    field.appInstallationId != null &&
    slugByInstallationId.get(field.appInstallationId) === parts.appSlug
  )
}

/**
 * Resolve a stored ref (concrete OR late-bound `@app:`) to its `ResourceField` + concrete
 * `ResourceFieldId`, or null if nothing in `fields` matches. The pure twin of the resource
 * store's `getFieldByRef`, for callers that hold a field list but not the store.
 */
export function resolveFieldRef(
  fields: ResourceField[],
  entityDefinitionId: string | null | undefined,
  ref: string | null | undefined,
  slugByInstallationId?: Map<string, string>
): { field: ResourceField; concreteRef: ResourceFieldId } | null {
  if (!ref) return null
  const field = fields.find((f) =>
    fieldMatchesRef(f, entityDefinitionId, ref, slugByInstallationId)
  )
  return field ? { field, concreteRef: concreteRefOf(field, entityDefinitionId) } : null
}

/**
 * Get valid operators for a resource field.
 * Uses TYPE_OPERATOR_MAP by default, or field.operatorOverrides if specified.
 */
export function getFieldOperators(field: ResourceField): Operator[] {
  // `operatorOverrides` is plain `string[]`, so a registry entry naming an operator the condition
  // system no longer defines is dropped here rather than handed to the typed map. Every entry in
  // the result is a real `OPERATOR_DEFINITIONS` key, so callers need no further filtering.
  const overrides = field.operatorOverrides?.filter(
    (name): name is Operator => name in OPERATOR_DEFINITIONS
  )
  return getOperatorsForType(field.type, overrides)
}

/**
 * Check if an operator is valid for a field.
 */
export function isValidOperatorForField(field: ResourceField, operator: string): boolean {
  const validOperators: string[] = getFieldOperators(field)
  return validOperators.includes(operator)
}

/**
 * Set resource variables in execution context using field registry
 * Creates node-scoped variables: nodeId.resourceType.field
 *
 * This function uses lazy loading - stores a resource reference instead of the full object,
 * and only loads relationships when accessed.
 *
 * @param resourceType - The type of resource (e.g., 'ticket', 'contact')
 * @param resourceData - The actual resource data object
 * @param contextManager - The execution context manager to set variables in
 * @param nodeId - The node ID to scope variables to
 *
 * @example
 * ```typescript
 * setResourceVariables('ticket', ticketData, contextManager, 'trigger-1')
 * // Creates variables:
 * // - trigger-1.ticket (ResourceReference - lightweight)
 * // - trigger-1.id (scalar field - direct access)
 * // - trigger-1.title (scalar field - direct access)
 * // ... etc for scalar fields
 * // Relationships loaded on-demand via lazy loading
 * ```
 */
export function setResourceVariables(
  resourceType: TableId,
  resourceData: any,
  contextManager: ExecutionContextManager,
  nodeId: string
): void {
  const fields = RESOURCE_FIELD_REGISTRY[resourceType]

  if (!fields) {
    throw new Error(`Unknown resource type: ${resourceType}`)
  }

  // Get organization ID from context for resource reference
  const organizationId = contextManager.getContext().organizationId

  if (!resourceData?.id) {
    throw new Error(`Resource data must have an 'id' field for lazy loading`)
  }

  // Create and store resource reference (lightweight)
  const resourceRef = createResourceReference(resourceType, resourceData.id, organizationId)
  contextManager.setVariable(`${nodeId}.${resourceType}`, resourceRef)

  // Store commonly accessed scalar fields directly to avoid lazy loading overhead
  // This includes all non-RELATION fields from the registry
  // Use getFieldOutputKey (systemAttribute ?? key) to match frontend variable paths
  Object.entries(fields).forEach(([fieldKey, fieldDef]) => {
    // Look up by registry key (camelCase, matches Drizzle query results)
    // Also try outputKey as fallback (for RecordMeta from test/debug path)
    const outputKey = getFieldOutputKey(fieldDef)
    const fieldValue = resourceData[fieldKey] ?? resourceData[outputKey]

    // Skip undefined values
    if (fieldValue === undefined) {
      return
    }

    // Only store scalar fields directly (not relationships)
    // Relationships will be lazy-loaded when accessed
    if (fieldDef.type !== BaseType.RELATION) {
      contextManager.setVariable(`${nodeId}.${resourceType}.${outputKey}`, fieldValue)
    }
  })
}

/**
 * Set resource variables for custom entity resources (entity_xxx)
 * Unlike setResourceVariables, this doesn't use static field registry.
 * Instead, it stores all fields from resourceData dynamically.
 *
 * @param resourceType - The custom entity type (e.g., 'entity_vendors')
 * @param resourceData - The actual resource data object (EntityInstance with fieldValues)
 * @param contextManager - The execution context manager to set variables in
 * @param nodeId - The node ID to scope variables to
 *
 * @example
 * ```typescript
 * setEntityVariables('entity_vendors', vendorData, contextManager, 'trigger-1')
 * // Creates variables:
 * // - trigger-1.entity_vendors (ResourceReference)
 * // - trigger-1.entity_vendors.id
 * // - trigger-1.entity_vendors.fieldName (for each field in fieldValues)
 * ```
 */
export function setEntityVariables(
  resourceType: string,
  resourceData: any,
  contextManager: ExecutionContextManager,
  nodeId: string
): void {
  if (!isCustomResourceId(resourceType)) {
    throw new Error(`setEntityVariables only handles custom entities. Got: ${resourceType}`)
  }

  const organizationId = contextManager.getContext().organizationId

  if (!resourceData?.id) {
    throw new Error(`Resource data must have an 'id' field`)
  }

  // Create and store resource reference (lightweight)
  // Note: createResourceReference accepts TableId but we're using a custom entity ID
  // The function handles string types at runtime
  const resourceRef = createResourceReference(resourceType as any, resourceData.id, organizationId)
  contextManager.setVariable(`${nodeId}.${resourceType}`, resourceRef)

  // Store standard EntityInstance fields under output keys matching systemAttribute values
  // (mirrors how setResourceVariables uses getFieldOutputKey for system resources)
  const ENTITY_STANDARD_FIELDS: Array<{ prop: string; outputKey: string }> = [
    { prop: 'id', outputKey: 'record_id' },
    { prop: 'createdAt', outputKey: 'created_at' },
    { prop: 'updatedAt', outputKey: 'updated_at' },
    { prop: 'entityDefinitionId', outputKey: 'entityDefinitionId' },
  ]

  for (const { prop, outputKey } of ENTITY_STANDARD_FIELDS) {
    if (resourceData[prop] !== undefined) {
      contextManager.setVariable(`${nodeId}.${resourceType}.${outputKey}`, resourceData[prop])
    }
  }

  // Also store `id` directly — extractIdFromValue, resolveNestedObject, and other paths expect it
  contextManager.setVariable(`${nodeId}.${resourceType}.id`, resourceData.id)

  // Store custom field values from fieldValues object
  // EntityInstance stores custom fields in a JSONB `fieldValues` column
  if (resourceData.fieldValues && typeof resourceData.fieldValues === 'object') {
    Object.entries(resourceData.fieldValues).forEach(([fieldKey, fieldValue]) => {
      if (fieldValue !== undefined) {
        // Skip complex objects (relationships) - store only scalar values
        if (typeof fieldValue !== 'object' || fieldValue === null) {
          contextManager.setVariable(`${nodeId}.${resourceType}.${fieldKey}`, fieldValue)
        }
      }
    })
  }
}

// ─────────────────────────────────────────────────────────────
// IDENTIFIER FIELD HELPERS (pure functions on Resource)
// ─────────────────────────────────────────────────────────────

/**
 * Every field that may identify/match an existing record, in picker order
 * (tier 1 first, Record ID last within tier 1).
 *
 * Delegates to `getIdentifierEligibility`, the ONE authority. This used to
 * be `resource.fields.filter(f => f.isIdentifier)`, a parallel implementation of
 * the same rule that the import picker also implemented separately. Retiering
 * one without the other made the picker offer a field the planner's auto-select
 * would never choose, and vice versa, with no error anywhere.
 *
 * The result now includes tier-2 (eligible but not enforced-unique) fields.
 * Use {@link getDefaultIdentifierField} when you need something safe to pick
 * WITHOUT a user saying so, it is tier-1 only.
 */
export function getIdentifierFields(resource: { fields: ResourceField[] }): ResourceField[] {
  const eligible = resource.fields.flatMap((field) => {
    const eligibility = getIdentifierEligibility(field)
    return eligibility ? [{ field, eligibility }] : []
  })

  return sortByIdentifierPreference(eligible, ({ field, eligibility }) => ({
    key: getFieldOutputKey(field),
    tier: eligibility.tier,
  })).map(({ field }) => field)
}

/**
 * The identifier field to use when the user has not chosen one.
 *
 * **Tier 1 only, and never a composite-only RELATION.** Tier 2 exists so a
 * human can knowingly key an import on a non-unique column; auto-selecting one
 * would silently make an arbitrary free-text field the match key for every
 * import that never touched the identity toggle, which is worse than not matching.
 * Returns `undefined` when the resource has no tier-1 identifier.
 *
 * Record ID sorts last inside tier 1 on purpose: the seeder excludes `id`, so
 * it lands in `unmatchedStaticFields` and used to sort FIRST, which is why the
 * auto-pick was always `id` and no row had ever classified as `update`. A real
 * identifier (`sku`, `email`) must beat it.
 */
export function getDefaultIdentifierField(resource: {
  fields: ResourceField[]
}): ResourceField | undefined {
  return getIdentifierFields(resource).find((field) => {
    const eligibility = getIdentifierEligibility(field)
    return eligibility?.tier === 1 && !eligibility.compositeOnly
  })
}

/**
 * The resource's declared NATURAL KEY, in declaration order — the tuple of
 * fields that together identify a record when no single field can.
 *
 * Empty for every resource that does not declare one, which is most of them: a
 * natural key is for join-shaped entities whose identity is the pair they link.
 * `vendor_part` is `(part, supplier)` and `subpart` is `(parentPart, childPart)`.
 *
 * Ordering is the declared `naturalKeyPosition`, never field order, so the key
 * is stable against someone reordering the registry file. A resource whose
 * positions are not contiguous from 1 has a broken declaration — the importer
 * would AND a partial tuple and silently match too much — so this returns
 * EMPTY rather than a partial key, and a registry test pins the invariant so it
 * is caught at build time rather than as a mis-import.
 *
 * @param resource - Any resource carrying merged registry fields
 * @returns The ordered key legs, or `[]` when none is declared or the
 *   declaration is incomplete
 */
export function getNaturalKeyFields(resource: { fields: ResourceField[] }): ResourceField[] {
  const legs = resource.fields
    .filter((field) => typeof field.naturalKeyPosition === 'number')
    .sort((a, b) => a.naturalKeyPosition! - b.naturalKeyPosition!)

  if (legs.length === 0) return []

  const contiguous = legs.every((field, index) => field.naturalKeyPosition === index + 1)
  return contiguous ? legs : []
}

/**
 * One extra entry in a resource's Import menu, resolved from a relation field's
 * {@link ResourceField.namedImporter} declaration.
 */
export interface NamedImporter {
  /** Menu label, e.g. `'Import supplier prices'`. */
  label: string
  /** The def a job started from this entry targets, e.g. `'vendor_part'`. */
  entityDefinitionId: string
  /**
   * The declaring relation field's output key (`part_vendor_parts`).
   *
   * This is the WIRE IDENTIFIER for the importer — what `?target=` carries and what
   * {@link findNamedImporter} matches on. Unlike a def id it means the same thing in
   * the static registry and in an org-merged resource; see that function.
   */
  fieldKey: string
}

/**
 * The NAMED IMPORTERS a resource offers for its hidden satellites.
 *
 * A hidden def has no records page, so it has nowhere to put the usual Import
 * button. `part` hosts them instead: `part.vendorParts` declares *"Import supplier
 * prices"* and `part.subparts` declares *"Import BOM"*, both targeting defs that
 * stay invisible.
 *
 * The target is READ from the declaring field's relationship rather than restated
 * in the declaration, so it cannot drift from the relation it belongs to. A field
 * whose relationship does not resolve to a def is **dropped** rather than offered:
 * a menu entry that starts a job against `null` is worse than a missing one.
 *
 * @param resource - Any resource carrying merged registry fields
 * @returns The declared importers in field order, or `[]` for the vast majority
 *   of resources, which declare none
 */
export function getNamedImporters(resource: { fields: ResourceField[] }): NamedImporter[] {
  const importers: NamedImporter[] = []

  for (const field of resource.fields) {
    if (!field.namedImporter || !field.relationship) continue
    const entityDefinitionId = getRelatedEntityDefinitionId(
      field.relationship as RelationshipConfig
    )
    if (!entityDefinitionId) continue
    importers.push({
      label: field.namedImporter.label,
      entityDefinitionId,
      fieldKey: getFieldOutputKey(field),
    })
  }

  return importers
}

/**
 * The def whose import authority governs `entityDefinitionId`.
 *
 * Normally itself. But a **hidden satellite reached through a named importer**
 * inherits its host's: `vendor_part` has no records page, no sidebar entry, and
 * therefore no grant of its own that anyone would think to give — so gating its
 * import on a `vendor_part` grant would refuse every member who can plainly import
 * parts, and gating it on nothing would be a side door into a def a member may
 * have been restricted out of.
 *
 * DERIVED, never declared twice. Declaring `namedImporter` on `part.vendorParts`
 * already says "parts hosts the supplier-price importer"; that IS the statement
 * that its authority follows `part`, so a second `importAuthority` declaration
 * could only ever drift from it. The lookup is over the static registry, so it is
 * the same answer in every org.
 *
 * ⚠️ This governs the DEF, not the door. Every one of the ~22 import procedures
 * re-asserts on the job's own `entityDefinitionId`, long after the menu item that
 * started it is out of scope — so the inheritance has to live here, at the assert,
 * not at the entry point.
 *
 * @param entityDefinitionId - The def a job targets
 * @returns The def to assert import permission against
 */
export function getImportAuthorityDefId(entityDefinitionId: string): string {
  for (const declaration of declaredNamedImporters()) {
    if (declaration.entityDefinitionId === entityDefinitionId) return declaration.hostDefId
  }
  return entityDefinitionId
}

/**
 * The named importer `hostDefId` declares under `fieldKey`, or null.
 *
 * This is the VALIDATOR behind `?target=` on an import route. A key that no host
 * declares is not merely unlabelled, it is refused — otherwise the query param is
 * a way to start a job against any def at all, and a hidden def is not an
 * access-controlled one.
 *
 * 🛑 Keyed by the DECLARING FIELD, never by the target def id, because a def id is
 * two different strings depending on who is holding it. In the static registry a
 * relation's `inverseResourceFieldId` reads `vendor_part:part`; in the org-merged
 * resource the client renders from, the DB row's copy of that ref carries the org's
 * EntityDefinition **CUID** instead. So a menu built client-side emitted
 * `?target=lmzi8ndslfl31zn13qs61igk`, this function compared it against
 * `'vendor_part'`, found nothing, and every named importer silently fell back to
 * the host's own importer — the menu item worked, it just opened the wrong wizard.
 * A field key (`part_vendor_parts`) is the same string in both keyspaces.
 *
 * @param hostDefId - The resource whose page the importer was opened from
 * @param fieldKey - The declaring relation field's output key, from the link
 * @returns The declaration, or null when the host declares no such importer
 */
export function findNamedImporter(hostDefId: string, fieldKey: string): NamedImporter | null {
  for (const declaration of declaredNamedImporters()) {
    if (declaration.hostDefId === hostDefId && declaration.fieldKey === fieldKey) {
      const { hostDefId: _host, ...importer } = declaration
      return importer
    }
  }
  return null
}

/**
 * The named importer `hostDefId` declares FOR a target def, or null.
 *
 * The tolerant twin of {@link findNamedImporter}, for normalizing a `?target=`
 * that arrived as a def id instead of the canonical field key — a hand-edited
 * URL, an old bookmark, or a caller that had the org's EntityDefinition CUID in
 * hand and reached for it. Resolve the CUID to an `entityType` first (the org
 * cache does that), then ask this.
 *
 * ⚠️ Returns `'ambiguous'` when the host declares MORE THAN ONE importer onto the
 * same target def, because then a def id genuinely cannot say which door was
 * meant. That is not hypothetical: `part.subparts` and `part.usedInAssemblies`
 * both target `subpart` — today only the first declares an importer, and this
 * guard is what keeps the second from silently resolving to the first if that
 * ever changes. A def id names the DESTINATION; the field key names the DOOR.
 *
 * @param hostDefId - The resource whose page the importer was opened from
 * @param entityDefinitionId - The target def, already normalized to `entityType`
 * @returns The single declaration, `'ambiguous'`, or null when none matches
 */
export function findNamedImporterByTarget(
  hostDefId: string,
  entityDefinitionId: string
): NamedImporter | 'ambiguous' | null {
  const matches = [...declaredNamedImporters()].filter(
    (d) => d.hostDefId === hostDefId && d.entityDefinitionId === entityDefinitionId
  )
  if (matches.length === 0) return null
  if (matches.length > 1) return 'ambiguous'
  const { hostDefId: _host, ...importer } = matches[0]!
  return importer
}

/**
 * Every `namedImporter` declared anywhere in the static registry, with the
 * resource that declares it. One scan, so {@link getImportAuthorityDefId} and
 * {@link findNamedImporter} can never disagree about what is declared.
 */
function* declaredNamedImporters(): Generator<NamedImporter & { hostDefId: string }> {
  for (const [hostDefId, fields] of Object.entries(RESOURCE_FIELD_REGISTRY)) {
    for (const field of Object.values(fields ?? {}) as ResourceField[]) {
      if (!field.namedImporter || !field.relationship) continue
      const entityDefinitionId = getRelatedEntityDefinitionId(
        field.relationship as RelationshipConfig
      )
      if (!entityDefinitionId) continue
      yield {
        hostDefId,
        entityDefinitionId,
        label: field.namedImporter.label,
        fieldKey: getFieldOutputKey(field),
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// SYSTEM FIELD HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Determines if a field is a system field (built-in to the table)
 */
export function isSystemField(field: ResourceField): boolean {
  return field.isSystem === true
}

/**
 * Determines if a field is computed from other fields
 */
export function isComputedField(field: ResourceField): boolean {
  return Array.isArray(field.sourceFields) && field.sourceFields.length > 0
}

/**
 * Sort fields: system fields first (by systemSortOrder), then custom fields by sortOrder.
 * Excludes 'id' field, inactive custom fields, and fields with `capabilities.hidden`.
 * Deduplicates by key to prevent React key conflicts.
 */
export function sortFieldsForDisplay(fields: ResourceField[]): ResourceField[] {
  // Deduplicate by key - prefer system fields over custom fields with same key
  const seenKeys = new Set<string>()
  const deduped = fields.filter((f) => {
    if (seenKeys.has(f.key)) return false
    seenKeys.add(f.key)
    return true
  })

  const systemFields = deduped
    .filter(
      (f) => f.isSystem && f.key !== 'id' && f.showInPanel !== false && !f.capabilities.hidden
    )
    .sort((a, b) => (a.systemSortOrder ?? '').localeCompare(b.systemSortOrder ?? ''))

  const customFields = deduped
    .filter(
      (f) => !f.isSystem && f.active !== false && f.showInPanel !== false && !f.capabilities.hidden
    )
    .sort((a, b) => (a.sortOrder ?? '').localeCompare(b.sortOrder ?? ''))

  return [...systemFields, ...customFields]
}

/**
 * Get fields that should be displayed in the property panel.
 * Filters out hidden fields and sorts appropriately.
 */
export function getDisplayFields(fields: ResourceField[]): ResourceField[] {
  return sortFieldsForDisplay(
    fields.filter((f) => f.showInPanel !== false && !f.capabilities.hidden)
  )
}
