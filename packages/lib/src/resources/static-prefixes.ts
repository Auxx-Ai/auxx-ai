// packages/lib/src/resources/static-prefixes.ts
//
// Pure static tier of RecordId prefix resolution. Client-safe by construction:
// only build-time constants, no React, no stores, no server dependencies.
//
// Canonical prefix = `entityDefinitionId`:
// - Def-backed types (ENTITY_DEFINITION_TYPES + custom entities): the
//   EntityDefinition row id (CUID) — org-specific, resolved by the dynamic tier.
// - Legacy system types (thread, message, user, …): the modelType string itself
//   (`SystemResource.entityDefinitionId === id`), knowable at build time.

import { type ModelType, ModelTypeMeta, ModelTypeValues } from '@auxx/database/enums'
import { ENTITY_DEFINITION_TYPES, isEntityDefinitionType } from '@auxx/types/resource'

/**
 * Legacy system model types without an EntityDefinition row. For these the
 * modelType string IS the canonical entityDefinitionId (e.g. `thread`).
 */
export const LEGACY_SYSTEM_TYPES = ModelTypeValues.filter(
  (t): t is ModelType => t !== 'entity' && !isEntityDefinitionType(t)
)

/** prefix → canonical id for everything resolvable at build time. */
const staticCanonicalByPrefix = new Map<string, string>()
for (const t of LEGACY_SYSTEM_TYPES) {
  staticCanonicalByPrefix.set(t, t)
  const apiSlug = ModelTypeMeta[t]?.apiSlug
  if (apiSlug) staticCanonicalByPrefix.set(apiSlug, t)
}

/**
 * Prefixes that are known org-dynamic aliases: def-backed entityTypes
 * (`contact`, `work_order`, …) and their apiSlugs (`contacts`, `work_orders`, …).
 * These always need the org's entityDefs/entityDefSlugs mapping to resolve.
 */
const dynamicAliasPrefixes = new Set<string>()
for (const t of ENTITY_DEFINITION_TYPES) {
  dynamicAliasPrefixes.add(t)
  const meta = (ModelTypeMeta as Partial<Record<string, { apiSlug?: string }>>)[t]
  if (meta?.apiSlug) dynamicAliasPrefixes.add(meta.apiSlug)
}

/**
 * Resolve a prefix through the static tier. Returns the canonical id for
 * legacy system names and their apiSlugs (`threads` → `thread`), undefined
 * for everything else (org-dynamic aliases, CUIDs, unknown strings).
 */
export function resolveStaticPrefix(prefix: string): string | undefined {
  return staticCanonicalByPrefix.get(prefix)
}

/**
 * True when the prefix is a known org-dynamic alias (def-backed entityType or
 * its apiSlug) — resolvable only via the org's dynamic prefix map.
 */
export function isDynamicAliasPrefix(prefix: string): boolean {
  return dynamicAliasPrefixes.has(prefix)
}

/**
 * True when the prefix is already a canonical definition id: a legacy system
 * name, or a long-form EntityDefinition id (same validated convention as the
 * server's `isCustomResourceId` — length ≥ 20 and not a known alias).
 */
export function isStaticCanonicalDefinitionId(prefix: string): boolean {
  if (staticCanonicalByPrefix.get(prefix) === prefix) return true
  return prefix.length >= 20 && !dynamicAliasPrefixes.has(prefix)
}
