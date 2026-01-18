// packages/lib/src/import/types/identifiers.ts

import type { RecordId } from '@auxx/types/resource'

/**
 * Entity definition identifier.
 * - System resources: 'contact', 'ticket', 'part', etc.
 * - Custom entities: UUID (cuid2, 25 chars)
 */
export type EntityDefinitionId = string

/**
 * Entity instance identifier (just the record ID, not the full ResourceId).
 * Used internally when entityDefinitionId is known from context.
 */
export type EntityInstanceId = string

/**
 * Field identifier.
 * - System fields: key like 'email', 'firstName'
 * - Custom fields: UUID (cuid2, 25 chars)
 */
export type FieldId = string

/**
 * Re-export branded types for convenience
 */
export type { RecordId }

/**
 * Re-export type guards from @auxx/types/resource
 */
export { isSystemModelType } from '@auxx/types/resource'

/**
 * Type guard to check if an entityDefinitionId is a custom entity (UUID).
 * Custom entities have UUID identifiers (cuid2 = 25 chars)
 */
export function isCustomEntityDefinitionId(id: EntityDefinitionId): boolean {
  // System resources are short strings like 'contact', 'ticket'
  // Custom entities are UUIDs (cuid2 = 25 chars)
  return id.length >= 20
}
