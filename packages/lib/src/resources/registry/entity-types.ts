// packages/lib/src/resources/registry/entity-types.ts
// Client-safe entity type constants (no server dependencies)

/**
 * System types that are now stored in EntityDefinition table (excluding 'entity' which is generic)
 * These types have their own EntityDefinition row with entityType field set.
 */
export const NEW_SYSTEM_ENTITY_TYPES = [
  'contact',
  'part',
  'ticket',
  'entity_group',
  'inbox',
] as const

/** Type for new system entity types */
export type NewSystemEntityType = (typeof NEW_SYSTEM_ENTITY_TYPES)[number]
