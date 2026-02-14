// packages/lib/src/entity-definitions/types.ts

import { EntityTypeValues, StandardTypeValues } from '@auxx/database/enums'
import { z } from 'zod'

export type { EntityType, StandardType } from '@auxx/database/types'

/**
 * Validation schema for creating an entity definition
 */
export const createEntityDefinitionSchema = z.object({
  apiSlug: z
    .string()
    .min(1, 'API slug is required')
    .max(50, 'API slug must be 50 characters or less')
    .regex(/^[a-z0-9-]+$/, 'API slug must contain only lowercase letters, numbers, and hyphens')
    .refine((val) => !val.startsWith('-') && !val.endsWith('-'), {
      message: 'API slug cannot start or end with a hyphen',
    }),
  icon: z.string().min(1, 'Icon is required').default('Box'),
  color: z.string().min(1, 'Color is required').default('blue'),
  singular: z.string().min(1, 'Singular name is required').max(100),
  plural: z.string().min(1, 'Plural name is required').max(100),
  entityType: z.enum(EntityTypeValues).nullable().optional(),
  standardType: z.enum(StandardTypeValues).nullable().optional(),
})

/** Input type for creating an entity definition */
export type CreateEntityDefinitionInput = z.infer<typeof createEntityDefinitionSchema>

/**
 * Validation schema for updating an entity definition
 * Only allows: icon, singular, plural, archivedAt, display field IDs
 * Does NOT allow: apiSlug, entityType, standardType (immutable after creation)
 */
export const updateEntityDefinitionSchema = z.object({
  icon: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  singular: z.string().min(1).max(100).optional(),
  plural: z.string().min(1).max(100).optional(),
  archivedAt: z.date().nullable().optional(),
  /** Custom field ID to use as primary display name */
  primaryDisplayFieldId: z.string().nullable().optional(),
  /** Custom field ID to use as secondary info/subtitle */
  secondaryDisplayFieldId: z.string().nullable().optional(),
  /** Custom field ID to use as avatar/image URL */
  avatarFieldId: z.string().nullable().optional(),
})

/** Input type for updating an entity definition */
export type UpdateEntityDefinitionInput = z.infer<typeof updateEntityDefinitionSchema>
