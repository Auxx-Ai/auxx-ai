// packages/lib/src/seed/entity-seeder/types.ts

import type { ResourceField } from '../../resources/registry/field-types'
import type { FieldType } from '@auxx/database/types'
import type { FieldOptions } from '../../custom-fields'

/**
 * EntityDefinition lookup by entityType
 * Key: entityType (e.g., 'contact', 'ticket', 'part')
 */
export interface EntityDefRecord {
  id: string
  entityType: string
  apiSlug: string
  singular: string
  plural: string
  icon: string
  color: string
  isVisible: boolean
}

export type EntityDefMap = Map<string, EntityDefRecord>

/**
 * CustomField lookup by entityType:fieldId
 * Key: `${entityType}:${field.id}` (e.g., 'contact:primaryEmail', 'ticket:contact')
 * Note: Uses field.id (from toFieldId), NOT systemAttribute
 */
export interface FieldRecord {
  /** CustomField.id (database UUID) */
  id: string
  entityDefinitionId: string
  systemAttribute: string
  name: string
  type: FieldType
  options: FieldOptions
  /** Original field definition for Pass 3 */
  _fieldDef: ResourceField
}

export type FieldMap = Map<string, FieldRecord>

/**
 * System entity configuration for seeding
 */
export interface SystemEntityConfig {
  entityType: string
  apiSlug: string
  singular: string
  plural: string
  icon: string
  color: string
  /** Whether this entity should appear in the sidebar (default: true) */
  isVisible?: boolean
}

/**
 * Display field configuration
 */
export interface DisplayFieldConfig {
  /** field.id for primary display (e.g., 'fullName', 'title') */
  primaryDisplayField: string
  /** field.id for secondary display (e.g., 'primaryEmail', 'number') */
  secondaryDisplayField: string
}
