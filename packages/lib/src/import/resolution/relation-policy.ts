// packages/lib/src/import/resolution/relation-policy.ts

import type { Resource } from '../../resources/registry/types'
import type {
  RelationLinkMode,
  RelationOnNoMatch,
  ResolutionConfig,
  ResolutionType,
} from '../types/resolution'

/**
 * Per-column relation POLICY, the pure half of relation resolution.
 *
 * Everything here is deliberately free of `db`, `@auxx/database` and the org
 * cache so the mapping wizard can call the exact functions the resolver calls.
 * The alternative, the UI restating the rules, is precisely how Defect E and
 * the match-field type gap were born.
 */

/** Relation config as persisted on `ImportMappingProperty.resolutionConfig`. */
export type RelationConfig = NonNullable<ResolutionConfig['relationConfig']>

/**
 * Defect E, fixed in one place.
 *
 * Resolve a resource's primary display field to its **field key** the thing
 * `resource.fields.find(f => f.key === …)` and `queryCustomEntity` actually
 * match on.
 *
 * `DisplayFieldConfig.id` is the CustomField row id for custom resources and
 * the (re-pointed) merged field id for system ones; `DisplayFieldConfig.name`
 * is the HUMAN LABEL. The old resolver trusted `.name` on the custom arm, so
 * `company` defaulted to matching on `Company Name` while its key is `name`,
 * and `part` to `Title` against a key of `title`, the lookup then found no
 * field, logged, and reported "No match found" for every single value.
 *
 * A case-insensitive compare is NOT a fix: it papers over `Title`/`title`
 * and still fails `Company Name`/`name`. Resolve through the fields instead.
 *
 * @param resource - The relation TARGET resource
 * @returns The display field's key, or `'id'` when the resource has none
 */
export function resolveDisplayFieldKey(resource: Resource): string {
  const displayId = resource.display.primaryDisplayField?.id
  if (!displayId) return 'id'
  return resource.fields.find((f) => f.id === displayId || f.key === displayId)?.key ?? 'id'
}

/**
 * The match field a relation column will actually use: the explicitly chosen
 * one, or the target's display field key when the column carries none (the
 * auto-map path).
 *
 * @param resource - The relation TARGET resource
 * @param matchField - The column's persisted `matchField`, if any
 */
export function resolveMatchFieldKey(resource: Resource, matchField?: string | null): string {
  return matchField || resolveDisplayFieldKey(resource)
}

/**
 * Whether the effective match field IS the target's primary display field,
 * the one condition under which auto-create produces a sane record.
 *
 * @param resource - The relation TARGET resource
 * @param matchField - The column's persisted `matchField`, if any
 */
export function matchesDisplayField(resource: Resource, matchField?: string | null): boolean {
  const displayKey = resolveDisplayFieldKey(resource)
  return resolveMatchFieldKey(resource, matchField) === displayKey
}

/**
 * Whether `onNoMatch: 'create'` may be offered for this column.
 *
 * Create is allowed ONLY when the match field is the target's display
 * field. Matching a company on its VAT number and then "creating" it mints a
 * company whose NAME is a VAT number, an unrecoverable mess that looks fine
 * in the preview. Two further hard stops:
 *
 * - `matchField === 'id'`, an unmatched CUID names a record that does not
 *   exist; inventing one under that id is meaningless.
 * - system (table-backed) resources, auto-create writes through the entity
 *   CRUD layer, which only speaks `EntityDefinition`-backed defs.
 *
 * The wizard calls this to enable/disable the *Create* radio; the resolver
 * calls it before honouring the policy, so a stale persisted `'create'` on a
 * column whose match field later moved off the display field cannot slip past.
 *
 * @param resource - The relation TARGET resource
 * @param matchField - The column's persisted `matchField`, if any
 */
export function canCreateOnNoMatch(resource: Resource, matchField?: string | null): boolean {
  if (resource.type === 'system') return false
  if (resolveMatchFieldKey(resource, matchField) === 'id') return false
  return matchesDisplayField(resource, matchField)
}

/**
 * The reason *Create* is unavailable, phrased for a disabled radio's tooltip.
 * `undefined` when create IS available.
 *
 * @param resource - The relation TARGET resource
 * @param matchField - The column's persisted `matchField`, if any
 */
export function explainCreateUnavailable(
  resource: Resource,
  matchField?: string | null
): string | undefined {
  if (canCreateOnNoMatch(resource, matchField)) return undefined
  if (resource.type === 'system') {
    return `${resource.label} records cannot be created by an import.`
  }
  const key = resolveMatchFieldKey(resource, matchField)
  if (key === 'id') {
    return 'Matching on Record ID cannot create, an unmatched ID names a record that does not exist.'
  }
  const displayLabel = resource.display.primaryDisplayField?.name ?? 'the display field'
  return `Creating requires matching on ${displayLabel}. A new ${resource.label} created from "${key}" would carry that value as its name.`
}

/**
 * The default no-match policy for a relation column (contract D-G):
 * `'create'` when the match field IS the target's display field, `'fail'`
 * otherwise.
 *
 * @param resource - The relation TARGET resource
 * @param matchField - The column's persisted `matchField`, if any
 */
export function defaultOnNoMatch(
  resource: Resource,
  matchField?: string | null
): RelationOnNoMatch {
  return canCreateOnNoMatch(resource, matchField) ? 'create' : 'fail'
}

/**
 * The effective no-match policy: the persisted choice, clamped to what the
 * column can actually support, falling back to {@link defaultOnNoMatch}.
 *
 * @param resource - The relation TARGET resource
 * @param config - The column's persisted relation config
 */
export function effectiveOnNoMatch(
  resource: Resource,
  config: Pick<RelationConfig, 'matchField' | 'onNoMatch'> | undefined
): RelationOnNoMatch {
  const chosen = config?.onNoMatch
  if (!chosen) return defaultOnNoMatch(resource, config?.matchField)
  if (chosen === 'create' && !canCreateOnNoMatch(resource, config?.matchField)) return 'fail'
  return chosen
}

/**
 * Default link mode for a relation column on the UPDATE path, always
 * `'add'`.
 *
 * A CSV column carrying one supplier is not a statement that the part has only
 * that supplier; `'set'` would silently drop every link the file never
 * mentioned. Single-valued sides have nothing to append to, so the mode is
 * irrelevant there and `'set'` is returned for clarity.
 *
 * Naming: the data-connector `FieldMapping.linkMode` is
 * `'upsert' | 'reference'` and answers a DIFFERENT question ("write the target
 * or register a pending reference"). This one answers "replace or append".
 * They never appear on the same object; the type alias keeps them distinct.
 *
 * @param relationshipType - The relation field's cardinality
 */
export function defaultRelationLinkMode(
  relationshipType: RelationConfig['relationshipType']
): RelationLinkMode {
  return relationshipType === 'has_many' || relationshipType === 'many_to_many' ? 'add' : 'set'
}

/**
 * Map a relation column's link mode onto the executor's `FieldWriteModes`
 * vocabulary.
 *
 * Returns `undefined` for single-valued relations, those must not appear in
 * `FieldWriteModes` at all, so they keep the CRUD layer's whole-field `set`
 * semantics without an explicit entry.
 *
 * @param relationshipType - The relation field's cardinality
 * @param linkMode - The column's persisted link mode, if any
 * @returns `'add'` | `'set'` for multi-valued sides, `undefined` otherwise
 */
export function relationFieldWriteMode(
  relationshipType: RelationConfig['relationshipType'],
  linkMode?: RelationLinkMode | null
): 'add' | 'set' | undefined {
  if (relationshipType !== 'has_many' && relationshipType !== 'many_to_many') return undefined
  return linkMode ?? 'add'
}

/**
 * Derive the stored `resolutionType` for a relation column from its policy,
 * instead of hardcoding `'relation:match'` at the call site.
 *
 * - match field `id` ⇒ `'relation:id'` (the cell already carries the target's
 *   record id; no field lookup happens)
 * - `onNoMatch: 'create'` ⇒ `'relation:create'`
 * - otherwise ⇒ `'relation:match'`
 *
 * `'blank'` and `'fail'` share `'relation:match'` on purpose: they differ only
 * in what happens AFTER the lookup misses, which travels on the marker.
 *
 * @param config - The column's relation config (match field + policy)
 * @returns The resolution type to persist
 */
export function deriveRelationResolutionType(
  config: Pick<RelationConfig, 'matchField' | 'onNoMatch'> | undefined
): ResolutionType {
  if (config?.matchField === 'id') return 'relation:id'
  return config?.onNoMatch === 'create' ? 'relation:create' : 'relation:match'
}

/** A complete, persistable relation column config. */
export interface RelationColumnPolicy {
  matchField: string
  onNoMatch: RelationOnNoMatch
  linkMode: RelationLinkMode
  resolutionType: ResolutionType
}

/**
 * Build the full policy for a relation column that has no explicit choices yet
 *the auto-map path.
 *
 * This is the second half of the Defect E fix (03 §6): auto-map persists an
 * EXPLICIT `matchField` instead of leaning on the resolver's fallback, so the
 * mapping row can render `Supplier › Company Name` immediately and no code
 * path depends on the default being right.
 *
 * @param targetResource - The relation TARGET resource (from the org cache)
 * @param relationshipType - The relation field's cardinality
 * @param overrides - Any already-chosen values to preserve
 */
export function buildRelationColumnPolicy(
  targetResource: Resource,
  relationshipType: RelationConfig['relationshipType'],
  overrides: Partial<Pick<RelationConfig, 'matchField' | 'onNoMatch' | 'linkMode'>> = {}
): RelationColumnPolicy {
  const matchField = resolveMatchFieldKey(targetResource, overrides.matchField)
  const onNoMatch = effectiveOnNoMatch(targetResource, {
    matchField,
    onNoMatch: overrides.onNoMatch,
  })
  const linkMode = overrides.linkMode ?? defaultRelationLinkMode(relationshipType)
  return {
    matchField,
    onNoMatch,
    linkMode,
    resolutionType: deriveRelationResolutionType({ matchField, onNoMatch }),
  }
}
