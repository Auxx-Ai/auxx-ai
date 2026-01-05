// packages/lib/src/field-values/field-value-validator.ts

import { z } from 'zod'
import { formatEmail } from '../utils/email'
import { formatPhoneNumber } from '../utils/contact'

/**
 * Validation schemas for each field type using Zod.
 * All use safeParse() for Result types instead of throwing.
 */

// Basic schemas for primitives
const textSchema = z
  .unknown()
  .transform((v) => (v === null || v === undefined ? '' : String(v).trim()))

const numberSchema = z.number().finite()

const booleanSchema = z
  .unknown()
  .transform((v) => {
    if (typeof v === 'boolean') return v
    if (v === 'true' || v === '1' || v === 1) return true
    if (v === 'false' || v === '0' || v === 0) return false
    return z.NEVER
  })

const dateSchema = z
  .unknown()
  .transform((v) => {
    if (v instanceof Date) return v.toISOString()
    const date = new Date(String(v))
    if (isNaN(date.getTime())) return z.NEVER
    return date.toISOString()
  })

// Field-specific schemas
export const fieldValueSchemas = {
  // TEXT, RICH_TEXT, ADDRESS
  text: textSchema,

  // EMAIL - use Zod's built-in z.email(), normalize to lowercase
  email: z
    .unknown()
    .transform((v) => String(v).trim().toLowerCase())
    .pipe(z.email('Invalid email format'))
    .transform((v) => formatEmail(v)),

  // URL - use Zod's built-in z.url(), lowercase, add protocol if missing
  url: z
    .unknown()
    .transform((v) => {
      const str = String(v).trim().toLowerCase()
      return str.startsWith('http') ? str : `https://${str}`
    })
    .pipe(z.url('Invalid URL format')),

  // PHONE_INTL - format to E.164
  phone: z
    .unknown()
    .transform((v) => {
      const formatted = formatPhoneNumber(String(v).trim())
      if (!formatted) return z.NEVER
      return formatted
    }),

  // NUMBER, CURRENCY
  number: numberSchema,

  // CHECKBOX
  boolean: booleanSchema,

  // DATE, DATETIME, TIME
  date: dateSchema,

  // SINGLE_SELECT, MULTI_SELECT, TAGS
  option: z
    .unknown()
    .transform((v) => String(v).trim())
    .refine((v) => v.length > 0, { message: 'Option ID required' }),

  // RELATIONSHIP - with async validation for access control
  relationship: z.object({
    relatedEntityId: z.string().min(1, 'Related entity ID required'),
    relatedEntityDefinitionId: z.string().min(1, 'Related entity definition ID required'),
  }),

  // NAME JSON: { firstName?: string, lastName?: string }
  nameJson: z
    .object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    })
    .refine((v) => v.firstName || v.lastName, {
      message: 'NAME requires at least firstName or lastName',
    }),

  // ADDRESS_STRUCT JSON
  addressStructJson: z
    .object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
      country: z.string().optional(),
    })
    .refine((v) => v.street || v.city || v.state || v.zip || v.country, {
      message: 'ADDRESS_STRUCT requires at least one address field',
    }),

  // FILE JSON: { url, name, size?, type? }
  fileJson: z.object({
    url: z.string().min(1, 'File URL required'),
    name: z.string().min(1, 'File name required'),
    size: z.number().optional(),
    type: z.string().optional(),
  }),

  // Generic JSON fallback
  json: z.object({}).passthrough(),
}

/**
 * Field value validator with Zod schemas and access control checks.
 */
export class FieldValueValidator {
  /**
   * Validate text value using Zod schema
   * Returns { success, data, error }
   */
  validateText(value: unknown) {
    return fieldValueSchemas.text.safeParse(value)
  }

  /**
   * Validate email with format check
   */
  validateEmail(value: unknown) {
    return fieldValueSchemas.email.safeParse(value)
  }

  /**
   * Validate URL with format check
   */
  validateUrl(value: unknown) {
    return fieldValueSchemas.url.safeParse(value)
  }

  /**
   * Validate phone and format to E.164
   */
  validatePhone(value: unknown) {
    return fieldValueSchemas.phone.safeParse(value)
  }

  /**
   * Validate number
   */
  validateNumber(value: unknown) {
    return fieldValueSchemas.number.safeParse(value)
  }

  /**
   * Validate boolean
   */
  validateBoolean(value: unknown) {
    return fieldValueSchemas.boolean.safeParse(value)
  }

  /**
   * Validate date/datetime/time
   */
  validateDate(value: unknown) {
    return fieldValueSchemas.date.safeParse(value)
  }

  /**
   * Validate option ID
   */
  validateOption(value: unknown) {
    return fieldValueSchemas.option.safeParse(value)
  }

  /**
   * Batch validate multiple relationships in a single DB query.
   * Much more efficient than validating each relationship individually.
   * Returns a map of relatedEntityId → validation result
   */
  async batchValidateRelationships(
    relationships: Array<{ relatedEntityId: string; relatedEntityDefinitionId: string }>,
    ctx: {
      db: any // Database instance
      organizationId: string // User's organization
    }
  ): Promise<Map<string, { success: boolean; message?: string }>> {
    const result = new Map<string, { success: boolean; message?: string }>()

    // Handle empty case
    if (relationships.length === 0) {
      return result
    }

    // Check if DB is available
    if (!ctx.db?.entityInstance) {
      for (const rel of relationships) {
        result.set(rel.relatedEntityId, { success: true })
      }
      console.warn('[FieldValueValidator] Database context not available for batch relationship validation, skipping access checks')
      return result
    }

    try {
      // Get all entity IDs
      const entityIds = relationships.map((r) => r.relatedEntityId)

      // Single DB query for all entities
      const entities = await ctx.db.entityInstance.findMany({
        where: { id: { in: entityIds } },
        select: { id: true, organizationId: true },
      })

      const entitiesByid = new Map(entities.map((e) => [e.id, e]))

      // Check each relationship
      for (const rel of relationships) {
        const entity = entitiesByid.get(rel.relatedEntityId)

        if (!entity) {
          result.set(rel.relatedEntityId, {
            success: true, // Soft validation: allow even if not found
            message: 'Related entity not found (soft validation)',
          })
          continue
        }

        if (entity.organizationId !== ctx.organizationId) {
          result.set(rel.relatedEntityId, {
            success: false,
            message: 'No access to related entity (different organization)',
          })
        } else {
          result.set(rel.relatedEntityId, { success: true })
        }
      }
    } catch (err) {
      // Log error but allow all relationships (soft validation)
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      console.warn('[FieldValueValidator] Batch relationship validation error:', errorMessage)

      for (const rel of relationships) {
        result.set(rel.relatedEntityId, { success: true })
      }
    }

    return result
  }

  /**
   * Validate relationship value PLUS access control
   * Checks organizationId to prevent cross-org relationship creation when possible.
   * If access check fails, logs warning but allows relationship (soft validation).
   */
  async validateRelationship(
    value: unknown,
    ctx: {
      db: any // Database instance
      organizationId: string // User's organization
    }
  ) {
    // First validate structure
    const structureResult = fieldValueSchemas.relationship.safeParse(value)
    if (!structureResult.success) {
      return structureResult
    }

    const { relatedEntityId, relatedEntityDefinitionId } = structureResult.data

    // Then validate access - check that related entity exists AND belongs to same org
    // NOTE: This is a soft validation - if it fails, we still allow the relationship but log a warning
    try {
      if (!ctx.db?.entityInstance) {
        console.warn('[FieldValueValidator] Database context not available for relationship validation, skipping access check')
        return {
          success: true as const,
          data: { relatedEntityId, relatedEntityDefinitionId },
        }
      }

      const relatedEntity = await ctx.db.entityInstance.findUnique({
        where: { id: relatedEntityId },
        select: { id: true, organizationId: true },
      })

      if (!relatedEntity) {
        console.warn(`[FieldValueValidator] Related entity not found: ${relatedEntityId}, allowing relationship`)
        return {
          success: true as const,
          data: { relatedEntityId, relatedEntityDefinitionId },
        }
      }

      // CRITICAL: Verify entity belongs to user's organization
      if (relatedEntity.organizationId !== ctx.organizationId) {
        return {
          success: false as const,
          error: new z.ZodError([
            {
              code: 'custom' as const,
              message: 'No access to related entity (different organization)',
              path: ['relatedEntityId'],
            },
          ]),
        }
      }

      return {
        success: true as const,
        data: { relatedEntityId, relatedEntityDefinitionId },
      }
    } catch (err) {
      // Log actual error but allow relationship (soft validation)
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      console.warn('[FieldValueValidator] Relationship validation warning:', errorMessage)

      return {
        success: true as const,
        data: { relatedEntityId, relatedEntityDefinitionId },
      }
    }
  }

  /**
   * Validate NAME JSON structure
   */
  validateNameJson(value: unknown) {
    return fieldValueSchemas.nameJson.safeParse(value)
  }

  /**
   * Validate ADDRESS_STRUCT JSON
   */
  validateAddressStructJson(value: unknown) {
    return fieldValueSchemas.addressStructJson.safeParse(value)
  }

  /**
   * Validate FILE JSON
   */
  validateFileJson(value: unknown) {
    return fieldValueSchemas.fileJson.safeParse(value)
  }

  /**
   * Generic JSON validation
   */
  validateJson(value: unknown) {
    return fieldValueSchemas.json.safeParse(value)
  }
}
