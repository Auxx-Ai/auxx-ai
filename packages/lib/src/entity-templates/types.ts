// packages/lib/src/entity-templates/types.ts

import type { CreateEntityDefinitionInput } from '@auxx/lib/entity-definitions/types'
import type { CreateCustomFieldInput } from '@auxx/services/custom-fields'

/**
 * Template-specific metadata that wraps around the entity/field creation inputs.
 * The entity + field shapes are the same types the creation services already accept,
 * minus runtime-only fields (organizationId, entityDefinitionId) which the installer provides.
 */
export interface EntityTemplate {
  /** Unique template identifier (used for cross-template refs like @template:company) */
  id: string
  /** Display name for the template card */
  name: string
  /** Short description for the template card */
  description: string
  /** Categories for filtering (e.g., 'crm', 'e-commerce') */
  categories: string[]

  /**
   * Entity definition config — same shape as CreateEntityDefinitionInput.
   * The installer passes this directly to createEntityDefinition() with organizationId injected.
   */
  entity: CreateEntityDefinitionInput

  /** Primary display field (references a field in `fields` by its `templateFieldId`) */
  primaryDisplayField: string
  /** Secondary display field (optional) */
  secondaryDisplayField?: string
  /** Avatar display field — FILE or URL field shown as entity avatar (optional) */
  avatarField?: string

  /** Suggested companion template IDs (shown as "works best with") */
  companions?: string[]

  /** Field definitions */
  fields: EntityTemplateField[]
}

/**
 * Template field definition — wraps CreateCustomFieldInput with template-specific additions.
 *
 * Omits runtime fields that the installer provides:
 *   - organizationId (from context)
 *   - entityDefinitionId (from entity creation result)
 *   - isCustom (always true for template fields)
 *
 * Extends relationship.relatedResourceId with symbolic refs:
 *   - "@system:contact" → resolved to org's Contact entityDefinitionId
 *   - "@system:ticket" → resolved to org's Ticket entityDefinitionId
 *   - "@template:company" → resolved to the entity created from the "company" template
 */
export type EntityTemplateField = {
  /** Template-local field identifier (for display field cross-references within the template) */
  templateFieldId: string
} & Omit<CreateCustomFieldInput, 'organizationId' | 'entityDefinitionId' | 'isCustom'>

/** Symbolic reference prefix for system entities */
export const SYSTEM_REF_PREFIX = '@system:'

/** Symbolic reference prefix for template entities */
export const TEMPLATE_REF_PREFIX = '@template:'

/** Resolution choice when a template conflicts with an existing entity */
export type ConflictResolution = 'use-existing' | 'create-new'

/** Type guard to check if a string is a symbolic ref */
export function isSymbolicRef(value: string): boolean {
  return value.startsWith(SYSTEM_REF_PREFIX) || value.startsWith(TEMPLATE_REF_PREFIX)
}

/** Parse a symbolic ref into its type and target */
export function parseSymbolicRef(ref: string): { type: 'system' | 'template'; target: string } {
  if (ref.startsWith(SYSTEM_REF_PREFIX)) {
    return { type: 'system', target: ref.slice(SYSTEM_REF_PREFIX.length) }
  }
  if (ref.startsWith(TEMPLATE_REF_PREFIX)) {
    return { type: 'template', target: ref.slice(TEMPLATE_REF_PREFIX.length) }
  }
  throw new Error(`Invalid symbolic ref: ${ref}`)
}
