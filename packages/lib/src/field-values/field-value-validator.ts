// packages/lib/src/field-values/field-value-validator.ts

import type { Database, Transaction } from '@auxx/database'
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
import { normalizeCalendarDayIso } from './calendar-day'

/**
 * Validation schemas for each field type using Zod.
 * All use safeParse() for Result types instead of throwing.
 */

// Basic schemas for primitives
const textSchema = z
  .unknown()
  .transform((v) => (v === null || v === undefined ? '' : String(v).trim()))

const numberSchema = z
  .unknown()
  .transform((v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : z.NEVER
    // Coerce numeric strings (e.g. Shopify money fields arrive as "10.00"),
    // consistent with the loose coercion the text/boolean/date schemas already do.
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
    return z.NEVER
  })
  .pipe(z.number().finite())

// `ctx.addIssue` is load-bearing here, exactly as it is on `phone` below: a bare
// transform that returns `z.NEVER` does NOT fail the parse — see the comment on
// `phone` for the full mechanism. `numberSchema` above gets away with the bare
// form only because its `.pipe(z.number().finite())` rejects the sentinel
// downstream; these two have no pipe, so they must report the issue themselves.
const booleanSchema = z.unknown().transform((v, ctx) => {
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === '1' || v === 1) return true
  if (v === 'false' || v === '0' || v === 0) return false
  ctx.addIssue({ code: 'custom', message: 'Invalid boolean value' })
  return z.NEVER
})

const dateSchema = z.unknown().transform((v, ctx) => {
  if (v instanceof Date) return v.toISOString()
  const date = new Date(String(v))
  if (Number.isNaN(date.getTime())) {
    ctx.addIssue({ code: 'custom', message: 'Invalid date value' })
    return z.NEVER
  }
  return date.toISOString()
})

// DATE only: a calendar day, normalised to `YYYY-MM-DDT00:00:00.000Z`
// (plans/money/tasks/33-calendar-day-fields.md §3). A null/empty input is
// rejected here exactly as `dateSchema` rejects it; clearing a value is decided
// upstream in `validateAndConvertValue`, which never reaches a schema for null.
const calendarDateSchema = z.unknown().transform((v, ctx) => {
  const iso = normalizeCalendarDayIso(v)
  if (!iso) {
    ctx.addIssue({ code: 'custom', message: 'Invalid date value' })
    return z.NEVER
  }
  return iso
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

  // PHONE_INTL - normalize to E.164 via the shared `formatPhoneNumber`
  //
  // `ctx.addIssue` is load-bearing: returning `z.NEVER` from a bare transform
  // does NOT fail the parse — `z.NEVER` is the `{status:'aborted'}` sentinel,
  // which without a reported issue becomes the parsed DATA (`success: true`),
  // so an unparseable number reached storage as an object instead of a 400.
  phone: z.unknown().transform((v, ctx) => {
    const formatted = formatPhoneNumber(String(v).trim())
    if (!formatted) {
      ctx.addIssue({ code: 'custom', message: 'Invalid phone number' })
      return z.NEVER
    }
    return formatted
  }),

  // NUMBER, CURRENCY
  number: numberSchema,

  // CHECKBOX
  boolean: booleanSchema,

  // DATETIME, TIME
  date: dateSchema,

  // DATE
  calendarDate: calendarDateSchema,

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

  // ADDRESS_STRUCT JSON — shape matches AddressStruct in custom-fields/types.ts, plus the
  // address-field-plan enrichment keys (plans/address-field/01-single-input-address-field.md
  // §4 decisions #6/#7, §5 item 4): `raw`/`lat`/`lng`/`geocodedAt` are optional persisted
  // enrichment, `_source` is a transient write-time marker the geocoder normalize hook reads and
  // always strips on write-back — all five MUST stay in this schema (not `.passthrough()`, to
  // keep the shape closed) or they're silently dropped here before the value ever reaches
  // storage or the post-write hook.
  addressStructJson: z
    .object({
      street1: z.string().optional(),
      street2: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zipCode: z.string().optional(),
      country: z.string().optional(),
      raw: z.string().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      geocodedAt: z.string().optional(),
      _source: z.enum(['single', 'structured']).optional(),
    })
    .refine((v) => v.street1 || v.street2 || v.city || v.state || v.zipCode || v.country, {
      message: 'ADDRESS_STRUCT requires at least one address field',
    }),

  // FILE JSON: { ref, caption?, internal? } — one file reference per FieldValue row
  // ("asset:id" or "file:id"). `caption`/`internal` are additive (plans/dispatch/
  // 37b-scouting-quote-photos.md §2) — kept here so a future caller doesn't strip
  // them; `validateFileJson` has no callers today.
  fileJson: z.object({
    ref: z.string().regex(/^(asset|file):.+/),
    caption: z.string().optional(),
    internal: z.boolean().optional(),
  }),

  // Generic JSON fallback
  json: z.object({}).passthrough(),
}

/**
 * The verdict for a relationship target with no `EntityInstance` row.
 *
 * 🔀 **Soft on purpose, and NOT safe to flip on its own (D-R4).** Two things
 * have to be true before this can hard-fail:
 *
 * 1. **`relatedEntityId` addresses four backing tables, not one.** `Thread`,
 *    `Article` and `DispatchWorker` targets are legitimate and have no
 *    `EntityInstance` row, so a check that joins only `EntityInstance` reads
 *    ~1,256 healthy references in the dev database as missing. Hard-failing here
 *    would refuse every write that touches a thread or article link — `tag_threads`
 *    alone carries 1,427 live pairs. A hard rule needs per-target-table
 *    resolution first; `findMissingRecordTargets` in `resources/record-existence.ts`
 *    is that resolution, and it answers by REFUSING TO JUDGE anything it cannot
 *    resolve to `EntityInstance`.
 * 2. **Write-ahead callers must be surveyed.** Importer, connector and sync sinks
 *    legitimately write a reference before its target lands; whether any of them
 *    do so today was not established.
 *
 * Until both are settled, a missing target is allowed through and the reference
 * is cleaned up by the read path (the picker's prune) and the backfill instead.
 */
const RELATED_ENTITY_NOT_FOUND = {
  success: true,
  message: 'Related entity not found (soft validation)',
} as const

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
   * Validate datetime/time (an instant)
   */
  validateDate(value: unknown) {
    return fieldValueSchemas.date.safeParse(value)
  }

  /**
   * Validate a DATE (a calendar day, normalised to UTC midnight)
   */
  validateCalendarDate(value: unknown) {
    return fieldValueSchemas.calendarDate.safeParse(value)
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
   *
   * 🛑 **This check did not run for the lifetime of the codebase.** It was
   * written as `ctx.db.entityInstance.findMany({ where: { id: { in: … } } })` —
   * Prisma syntax on a Drizzle database — behind a `if (!ctx.db?.entityInstance)`
   * guard that marked every id valid and returned. The accessor is always
   * `undefined`, so the guard always fired and the query below it was dead code.
   * `db` was typed `any`, which is why the typechecker never said so. It is typed
   * {@link Database} now for exactly that reason.
   *
   * Turning it on changes ONE verdict: a target that resolves to a row in a
   * DIFFERENT organization is now rejected, as the code always intended. The
   * not-found branch stays soft — see {@link RELATED_ENTITY_NOT_FOUND}.
   */
  async batchValidateRelationships(
    relationships: Array<
      | RecordId
      | { relatedEntityId: string; relatedEntityDefinitionId: string }
      | { recordId: RecordId }
    >,
    ctx: {
      db: Database | Transaction
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
    if (entityInstanceIds.length === 0) return result

    try {
      const rows = await ctx.db.query.EntityInstance.findMany({
        where: (instances, { inArray }) => inArray(instances.id, entityInstanceIds),
        columns: { id: true, organizationId: true },
      })

      const byId = new Map(rows.map((row) => [row.id, row]))

      for (const entityId of entityInstanceIds) {
        const entity = byId.get(entityId)

        if (!entity) {
          result.set(entityId, RELATED_ENTITY_NOT_FOUND)
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
      db: Database | Transaction
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

    // Then validate access - check that related entity exists AND belongs to same org.
    // The not-found branch is soft on purpose — see RELATED_ENTITY_NOT_FOUND.
    try {
      const relatedEntity = await ctx.db.query.EntityInstance.findFirst({
        where: (instances, { eq }) => eq(instances.id, entityInstanceId),
        columns: { id: true, organizationId: true },
      })

      if (!relatedEntity) {
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
