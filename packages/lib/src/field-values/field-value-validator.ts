// packages/lib/src/field-values/field-value-validator.ts

import {
  isRecordId,
  parseRecordId,
  type RecordId,
  recordIdSchema,
  toRecordId,
} from '@auxx/types/resource'
import { formatPhoneNumber } from '@auxx/utils/contact'
import { formatEmail } from '@auxx/utils/email'
import { z } from 'zod'

/**
 * Validation schemas for each field type using Zod.
 * All use safeParse() for Result types instead of throwing.
 */

// Basic schemas for primitives
const textSchema = z
  .unknown()
  .transform((v) => (v === null || v === undefined ? '' : String(v).trim()))

const numberSchema = z.number().finite()

const booleanSchema = z.unknown().transform((v) => {
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === '1' || v === 1) return true
  if (v === 'false' || v === '0' || v === 0) return false
  return z.NEVER
})

const dateSchema = z.unknown().transform((v) => {
  if (v instanceof Date) return v.toISOString()
  const date = new Date(String(v))
  if (Number.isNaN(date.getTime())) return z.NEVER
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
  phone: z.unknown().transform((v) => {
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

  // RELATIONSHIP - uses RecordId format, also accepts legacy format
  relationship: z
    .union([
      // New format: { recordId }
      z.object({ recordId: recordIdSchema }),
      // Legacy format: { relatedEntityId, relatedEntityDefinitionId }
      z.object({
        relatedEntityId: z.string().min(1, 'Related entity ID required'),
        relatedEntityDefinitionId: z.string().min(1, 'Related entity definition ID required'),
      }),
      // Direct RecordId string
      recordIdSchema,
    ])
    .transform((val): { recordId: RecordId } => {
      // Normalize to new format
      if (typeof val === 'string') {
        return { recordId: val }
      }
      if ('recordId' in val) {
        return { recordId: val.recordId }
      }
      // Legacy format
      return { recordId: toRecordId(val.relatedEntityDefinitionId, val.relatedEntityId) }
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

  // FILE JSON: { ref } — one file reference per FieldValue row ("asset:id" or "file:id")
  fileJson: z.object({
    ref: z.string().regex(/^(asset|file):.+/),
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
   * Returns a map of entityInstanceId → validation result
   *
   * Accepts both new format (RecordId) and legacy format ({ relatedEntityId, relatedEntityDefinitionId })
   */
  async batchValidateRelationships(
    relationships: Array<
      | RecordId
      | { relatedEntityId: string; relatedEntityDefinitionId: string }
      | { recordId: RecordId }
    >,
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

    // Normalize all inputs to extract entity instance IDs
    const entityInstanceIds: string[] = []
    for (const rel of relationships) {
      if (typeof rel === 'string' && isRecordId(rel)) {
        entityInstanceIds.push(parseRecordId(rel).entityInstanceId)
      } else if (typeof rel === 'object' && 'recordId' in rel) {
        entityInstanceIds.push(parseRecordId(rel.recordId).entityInstanceId)
      } else if (typeof rel === 'object' && 'relatedEntityId' in rel) {
        entityInstanceIds.push(rel.relatedEntityId)
      }
    }

    // Check if DB is available
    if (!ctx.db?.entityInstance) {
      for (const id of entityInstanceIds) {
        result.set(id, { success: true })
      }
      return result
    }

    try {
      // Single DB query for all entities
      const entities = await ctx.db.entityInstance.findMany({
        where: { id: { in: entityInstanceIds } },
        select: { id: true, organizationId: true },
      })

      const entitiesByid = new Map(
        entities.map((e: { id: string; organizationId: string }) => [e.id, e])
      )

      // Check each entity instance
      for (const entityId of entityInstanceIds) {
        const entity = entitiesByid.get(entityId)

        if (!entity) {
          result.set(entityId, {
            success: true, // Soft validation: allow even if not found
            message: 'Related entity not found (soft validation)',
          })
          continue
        }

        if (entity.organizationId !== ctx.organizationId) {
          result.set(entityId, {
            success: false,
            message: 'No access to related entity (different organization)',
          })
        } else {
          result.set(entityId, { success: true })
        }
      }
    } catch (err) {
      // Log error but allow all relationships (soft validation)
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      console.warn('[FieldValueValidator] Batch relationship validation error:', errorMessage)

      for (const id of entityInstanceIds) {
        result.set(id, { success: true })
      }
    }

    return result
  }

  /**
   * Validate relationship value PLUS access control
   * Checks organizationId to prevent cross-org relationship creation when possible.
   * If access check fails, logs warning but allows relationship (soft validation).
   *
   * Accepts both new format (RecordId) and legacy format.
   * Returns { recordId } in new format.
   */
  async validateRelationship(
    value: unknown,
    ctx: {
      db: any // Database instance
      organizationId: string // User's organization
    }
  ) {
    // First validate and normalize structure to { recordId }
    const structureResult = fieldValueSchemas.relationship.safeParse(value)
    if (!structureResult.success) {
      return structureResult
    }

    const { recordId } = structureResult.data
    const { entityInstanceId } = parseRecordId(recordId)

    // Then validate access - check that related entity exists AND belongs to same org
    // NOTE: This is a soft validation - if it fails, we still allow the relationship but log a warning
    try {
      if (!ctx.db?.entityInstance) {
        console.warn(
          '[FieldValueValidator] Database context not available for relationship validation, skipping access check'
        )
        return {
          success: true as const,
          data: { recordId },
        }
      }

      const relatedEntity = await ctx.db.entityInstance.findUnique({
        where: { id: entityInstanceId },
        select: { id: true, organizationId: true },
      })

      if (!relatedEntity) {
        console.warn(
          `[FieldValueValidator] Related entity not found: ${entityInstanceId}, allowing relationship`
        )
        return {
          success: true as const,
          data: { recordId },
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
              path: ['recordId'],
            },
          ]),
        }
      }

      return {
        success: true as const,
        data: { recordId },
      }
    } catch (err) {
      // Log actual error but allow relationship (soft validation)
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      console.warn('[FieldValueValidator] Relationship validation warning:', errorMessage)

      return {
        success: true as const,
        data: { recordId },
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
