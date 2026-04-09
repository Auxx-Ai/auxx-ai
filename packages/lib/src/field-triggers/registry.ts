// packages/lib/src/field-triggers/registry.ts

import type { SystemAttribute } from '@auxx/types/system-attribute'
import type { EntityTriggerHandler, FieldTriggerHandler } from './types'

/**
 * Field triggers — fire when a specific systemAttribute value changes.
 * Keyed by SystemAttribute for compile-time validation.
 */
export const FIELD_TRIGGERS: Partial<Record<SystemAttribute, FieldTriggerHandler[]>> = {}

/**
 * Entity triggers — fire when an entity of a specific slug is created or deleted.
 * Keyed by entity apiSlug (e.g., 'vendor-parts', 'subparts').
 */
export const ENTITY_TRIGGERS: Record<string, EntityTriggerHandler[]> = {}

/** Get all field trigger handlers for a given systemAttribute */
export function getFieldTriggers(systemAttribute: SystemAttribute): FieldTriggerHandler[] {
  return FIELD_TRIGGERS[systemAttribute] ?? []
}

/** Get all entity trigger handlers for a given entity slug */
export function getEntityTriggers(entitySlug: string): EntityTriggerHandler[] {
  return ENTITY_TRIGGERS[entitySlug] ?? []
}

/** Check if any field triggers are registered for a given systemAttribute */
export function hasFieldTriggers(systemAttribute: SystemAttribute): boolean {
  const triggers = FIELD_TRIGGERS[systemAttribute]
  return triggers !== undefined && triggers.length > 0
}

/**
 * Register field trigger handlers for a systemAttribute.
 * Appends to any existing handlers.
 */
export function registerFieldTriggers(
  systemAttribute: SystemAttribute,
  handlers: FieldTriggerHandler[]
): void {
  const existing = FIELD_TRIGGERS[systemAttribute] ?? []
  FIELD_TRIGGERS[systemAttribute] = [...existing, ...handlers]
}

/**
 * Register entity trigger handlers for an entity slug.
 * Appends to any existing handlers.
 */
export function registerEntityTriggers(entitySlug: string, handlers: EntityTriggerHandler[]): void {
  const existing = ENTITY_TRIGGERS[entitySlug] ?? []
  ENTITY_TRIGGERS[entitySlug] = [...existing, ...handlers]
}
