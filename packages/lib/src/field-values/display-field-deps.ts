// packages/lib/src/field-values/display-field-deps.ts

import { schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedResources } from '../cache'
import type { Resource } from '../resources/registry/types'
import type { FieldValueContext } from './field-value-helpers'
import { updateSearchTextForInstances } from './search-text'

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

/**
 * Memoized per cached-resources array identity: the `resources` org-cache key is
 * invalidated on `custom-field.*` / `entity-def.*` events, so a new array from
 * `getCachedResources` is exactly the signal that the dep map may have changed.
 */
const depsByResources = new WeakMap<readonly Resource[], DisplayFieldDepsMap>()

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
  const resources = await getCachedResources(organizationId)
  let map = depsByResources.get(resources)
  if (!map) {
    map = buildDepsMap(resources)
    depsByResources.set(resources, map)
  }
  return map.get(sourceEntityType) ?? []
}

/**
 * Build the reverse dependency map from the org's cached resources.
 *
 * Iterates all resources, checks if primaryDisplayField or secondaryDisplayField
 * is a RELATIONSHIP type, and if so resolves the target entity type.
 */
function buildDepsMap(resources: readonly Resource[]): DisplayFieldDepsMap {
  const map: DisplayFieldDepsMap = new Map()

  for (const resource of resources) {
    checkDisplayField(resource, 'primaryDisplayField', 'displayName', map)
    checkDisplayField(resource, 'secondaryDisplayField', 'secondaryDisplayValue', map)
  }

  return map
}

/**
 * Check if a display field is a RELATIONSHIP type and add a dependency entry.
 *
 * `display` and `fields` are optional-chained: the dep map is now built on the
 * record DELETE path too, and a cached resource entry missing either one must
 * contribute no dependency rather than fail the delete around it.
 */
function checkDisplayField(
  resource: Resource,
  displayFieldKey: 'primaryDisplayField' | 'secondaryDisplayField',
  column: 'displayName' | 'secondaryDisplayValue',
  map: DisplayFieldDepsMap
): void {
  const displayFieldConfig = resource.display?.[displayFieldKey]
  if (!displayFieldConfig) return

  // Check if the display field type is RELATIONSHIP
  if (displayFieldConfig.type !== 'RELATIONSHIP') return

  // Find the full field definition to get the relationship target
  const field = resource.fields?.find((f) => f.id === displayFieldConfig.id)
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
 *
 * Takes only the two fields it reads rather than the whole {@link FieldValueContext}
 * so the delete path (`field-values/sweep-entity-references.ts`) can reuse it with
 * `null` as the new value — a hard-deleted record leaves the same stale projection
 * behind as a rename, and nothing else clears it.
 */
export async function cascadeDependentDisplayNames(
  ctx: Pick<FieldValueContext, 'db' | 'organizationId'>,
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

    // Refresh the search corpus for every dependent instance in one statement —
    // a rename on a widely-referenced record can fan out to thousands of rows,
    // and the old per-id loop issued one round-trip each.
    await updateSearchTextForInstances(ctx.db, ctx.organizationId, instanceIds)
  }
}
