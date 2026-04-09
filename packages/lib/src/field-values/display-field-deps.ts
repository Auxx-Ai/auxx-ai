// packages/lib/src/field-values/display-field-deps.ts

import { schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedResources } from '../cache'
import type { Resource } from '../resources/registry/types'
import type { FieldValueContext } from './field-value-helpers'
import { updateSearchText } from './field-value-helpers'

/**
 * Describes a dependency: when entity X's displayName changes,
 * entity Y (the dependent) needs its display column recalculated.
 */
export interface DisplayFieldDep {
  /** Entity type that depends on the changed entity (e.g., 'subpart') */
  dependentEntityType: string
  /** The RELATIONSHIP field's systemAttribute on the dependent entity */
  relationshipSystemAttribute: string
  /** Which column on the dependent entity to update */
  column: 'displayName' | 'secondaryDisplayValue'
}

/** Map: sourceEntityType → deps[] */
type DisplayFieldDepsMap = Map<string, DisplayFieldDep[]>

/** Lazy-built cache per organizationId */
const depsCache = new Map<string, DisplayFieldDepsMap>()

/**
 * Build or retrieve the reverse dependency map for an organization.
 *
 * Answers: "When entity X's displayName changes, which other entities
 * need their displayName/secondaryDisplayValue recalculated?"
 *
 * For entities with no dependents (most types), returns empty array — zero overhead.
 */
export async function getDisplayFieldDeps(
  organizationId: string,
  sourceEntityType: string
): Promise<DisplayFieldDep[]> {
  let map = depsCache.get(organizationId)
  if (!map) {
    map = await buildDepsMap(organizationId)
    depsCache.set(organizationId, map)
  }
  return map.get(sourceEntityType) ?? []
}

/** Invalidate the cached deps map for an organization (call when entity definitions change). */
export function invalidateDisplayFieldDeps(organizationId: string): void {
  depsCache.delete(organizationId)
}

/**
 * Build the reverse dependency map from all resources in the org cache.
 *
 * Iterates all resources, checks if primaryDisplayField or secondaryDisplayField
 * is a RELATIONSHIP type, and if so resolves the target entity type.
 */
async function buildDepsMap(organizationId: string): Promise<DisplayFieldDepsMap> {
  const resources = await getCachedResources(organizationId)
  const map: DisplayFieldDepsMap = new Map()

  for (const resource of resources) {
    checkDisplayField(resource, 'primaryDisplayField', 'displayName', map)
    checkDisplayField(resource, 'secondaryDisplayField', 'secondaryDisplayValue', map)
  }

  return map
}

/**
 * Check if a display field is a RELATIONSHIP type and add a dependency entry.
 */
function checkDisplayField(
  resource: Resource,
  displayFieldKey: 'primaryDisplayField' | 'secondaryDisplayField',
  column: 'displayName' | 'secondaryDisplayValue',
  map: DisplayFieldDepsMap
): void {
  const displayFieldConfig = resource.display[displayFieldKey]
  if (!displayFieldConfig) return

  // Check if the display field type is RELATIONSHIP
  if (displayFieldConfig.type !== 'RELATIONSHIP') return

  // Find the full field definition to get the relationship target
  const field = resource.fields.find((f) => f.id === displayFieldConfig.id)
  if (!field) return

  // Get the target entity type from the relationship config
  const relatedEntityType =
    field.relationshipConfig?.relatedEntityType ||
    (field.relationship as any)?.inverseResourceFieldId?.split(':')[0]
  if (!relatedEntityType) return

  // Get the systemAttribute for the relationship field
  const systemAttribute = field.systemAttribute
  if (!systemAttribute) return

  // Add to map: when relatedEntityType's displayName changes, this resource needs updating
  const deps = map.get(relatedEntityType) ?? []
  deps.push({
    dependentEntityType: resource.entityType ?? resource.id,
    relationshipSystemAttribute: systemAttribute,
    column,
  })
  map.set(relatedEntityType, deps)
}

/**
 * Cascade displayName changes to dependent entities.
 *
 * When an entity's displayName changes (e.g., a part's title), find all entities
 * that reference it via a RELATIONSHIP display field and update their display columns.
 */
export async function cascadeDependentDisplayNames(
  ctx: FieldValueContext,
  sourceInstanceId: string,
  newDisplayValue: string | null,
  deps: DisplayFieldDep[]
): Promise<void> {
  for (const dep of deps) {
    // Find all instances of the dependent entity where the relationship
    // field points to sourceInstanceId
    const dependentInstances = await ctx.db
      .select({ entityId: schema.FieldValue.entityId })
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
      .where(
        and(
          eq(schema.CustomField.systemAttribute, dep.relationshipSystemAttribute),
          eq(schema.FieldValue.relatedEntityId, sourceInstanceId),
          eq(schema.FieldValue.organizationId, ctx.organizationId)
        )
      )

    if (dependentInstances.length === 0) continue

    const instanceIds = dependentInstances.map((r) => r.entityId)

    // Batch update display column on dependent instances
    await ctx.db
      .update(schema.EntityInstance)
      .set({ [dep.column]: newDisplayValue })
      .where(
        and(
          inArray(schema.EntityInstance.id, instanceIds),
          eq(schema.EntityInstance.organizationId, ctx.organizationId)
        )
      )

    // Update searchText for each dependent instance
    for (const id of instanceIds) {
      await updateSearchText(ctx.db, id, ctx.organizationId)
    }
  }
}
