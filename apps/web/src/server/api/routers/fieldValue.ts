// apps/web/src/server/api/routers/fieldValue.ts

import { FieldValueService } from '@auxx/lib/field-values'
import type { FieldReference } from '@auxx/types/field'
import { fieldIdSchema, resourceFieldIdSchema } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { recordIdSchema } from '@auxx/types/resource'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/** Schema for FieldReference - either ResourceFieldId or FieldPath */
const fieldReferenceSchema = z.union([
  resourceFieldIdSchema, // Direct field: "contact:email"
  z.array(resourceFieldIdSchema).min(1), // Path: ["product:vendor", "vendor:name"]
])

/** Typed value input schema for multi-value fields */
const typedValueInputSchema = z.object({
  type: z.enum(['text', 'number', 'boolean', 'date', 'json', 'option', 'relationship']),
  value: z.any().optional(),
  optionId: z.string().optional(),
  recordId: recordIdSchema.optional(), // For relationship type
})

/**
 * Field Value Router - handles all field value operations
 * Uses FieldValueService directly for all operations
 * RecordId format: "entityDefinitionId:entityInstanceId"
 */
export const fieldValueRouter = createTRPCRouter({
  /**
   * Set a single field value for a resource.
   * Expects recordId in RecordId format (entityDefinitionId:entityInstanceId).
   */
  set: protectedProcedure
    .input(
      z.object({
        recordId: z.string(), // RecordId format
        fieldId: fieldIdSchema,
        value: z.any().nullable(),
        /**
         * Stage 1 AI request. When true, the service short-circuits and
         * enqueues a BullMQ autofill job instead of writing a literal
         * value. `value` is ignored in this mode.
         */
        ai: z.boolean().optional(),
        /**
         * Write mode. Default `'set'` — replaces the field's rows with
         * the input (today's behavior). `'add'` / `'remove'` route to
         * the multi-value primitives and throw `BadRequestError` on
         * single-value fields.
         */
        mode: z.enum(['set', 'add', 'remove']).default('set'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db,
        ctx.headers.get('x-realtime-socket-id') ?? undefined
      )

      if (input.mode === 'set') {
        return await service.setValueWithBuiltIn({
          recordId: input.recordId as RecordId,
          fieldId: input.fieldId,
          value: input.value ?? null,
          ai: input.ai,
        })
      }

      const arr = Array.isArray(input.value) ? input.value : [input.value]
      if (input.mode === 'add') {
        const values = await service.addValues({
          recordId: input.recordId as RecordId,
          fieldId: input.fieldId,
          values: arr,
        })
        return { state: 'complete' as const, performedAt: new Date().toISOString(), values }
      }

      await service.removeValues({
        recordId: input.recordId as RecordId,
        fieldId: input.fieldId,
        values: arr,
      })
      return { state: 'complete' as const, performedAt: new Date().toISOString(), values: [] }
    }),

  /**
   * Set values for multiple resources (bulk operation).
   * Expects recordIds in RecordId format.
   */
  setBulk: protectedProcedure
    .input(
      z.object({
        recordIds: z.array(z.string()).min(1), // RecordId format
        values: z.array(
          z.object({
            fieldId: fieldIdSchema,
            value: z.any().nullable(),
            /**
             * Per-item write mode. Default `'set'` — replace. Use `'add'` /
             * `'remove'` to append / delete values on multi-value fields.
             * Mixing modes across items in one call is the whole point of
             * putting `mode` here instead of at the top level.
             */
            mode: z.enum(['set', 'add', 'remove']).default('set'),
          })
        ),
        /**
         * Stage 1 AI request across the full cartesian product. Each
         * (recordId, fieldId) pair enqueues its own autofill job; the
         * bulk service fans out per-pair calls to setValueWithBuiltIn.
         */
        ai: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db,
        ctx.headers.get('x-realtime-socket-id') ?? undefined
      )

      // AI stage-1 ignores mode — every pair is a request.
      if (input.ai === true) {
        return await service.setBulkValues({
          recordIds: input.recordIds as RecordId[],
          values: input.values.map((v) => ({ fieldId: v.fieldId, value: v.value ?? null })),
          ai: true,
        })
      }

      // Bucket by mode so each gets the right vectorized call.
      const setItems = input.values.filter((v) => v.mode === 'set')
      const addItems = input.values.filter((v) => v.mode === 'add')
      const removeItems = input.values.filter((v) => v.mode === 'remove')

      let count = 0
      if (setItems.length > 0) {
        const res = await service.setBulkValues({
          recordIds: input.recordIds as RecordId[],
          values: setItems.map((v) => ({ fieldId: v.fieldId, value: v.value ?? null })),
        })
        count = res.count
      }

      for (const { fieldId, value } of addItems) {
        await service.addValuesBulk({
          recordIds: input.recordIds as RecordId[],
          fieldId,
          values: Array.isArray(value) ? value : [value],
        })
      }

      for (const { fieldId, value } of removeItems) {
        await service.removeValuesBulk({
          recordIds: input.recordIds as RecordId[],
          fieldId,
          values: Array.isArray(value) ? value : [value],
        })
      }

      return { count }
    }),

  /**
   * Delete a field value for a resource.
   * Expects recordId in RecordId format.
   */
  delete: protectedProcedure
    .input(
      z.object({
        recordId: z.string(), // RecordId format
        fieldId: fieldIdSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db,
        ctx.headers.get('x-realtime-socket-id') ?? undefined
      )
      await service.deleteValue({
        recordId: input.recordId as RecordId,
        fieldId: input.fieldId,
      })
      return { success: true }
    }),

  /**
   * Batch get values with relationship traversal support.
   * Uses RecordId format (entityDefinitionId:entityInstanceId).
   *
   * @param recordIds - Array of RecordIds (max 500)
   * @param fieldReferences - Array of FieldReferences (max 50):
   *   - ResourceFieldId: "contact:email" (direct field)
   *   - FieldPath: ["product:vendor", "vendor:name"] (relationship traversal)
   */
  batchGet: protectedProcedure
    .input(
      z.object({
        recordIds: z.array(z.string()).max(500), // RecordId format
        fieldReferences: z.array(fieldReferenceSchema).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db,
        ctx.headers.get('x-realtime-socket-id') ?? undefined
      )
      return await service.batchGetValues({
        recordIds: input.recordIds as RecordId[],
        fieldReferences: input.fieldReferences as FieldReference[],
      })
    }),

  /**
   * Add value to multi-value field (MULTI_SELECT, TAGS, etc.)
   * Expects recordId in RecordId format.
   */
  add: protectedProcedure
    .input(
      z.object({
        recordId: z.string(), // RecordId format
        fieldId: fieldIdSchema,
        fieldType: z.string(),
        value: typedValueInputSchema,
        position: z
          .union([z.literal('start'), z.literal('end'), z.object({ after: z.string() })])
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db,
        ctx.headers.get('x-realtime-socket-id') ?? undefined
      )
      return await service.addValue({
        recordId: input.recordId as RecordId,
        fieldId: input.fieldId,
        fieldType: input.fieldType,
        value: input.value as any,
        position: input.position,
      })
    }),

  /**
   * Remove value from multi-value field
   */
  remove: protectedProcedure
    .input(z.object({ valueId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db,
        ctx.headers.get('x-realtime-socket-id') ?? undefined
      )
      await service.removeValue(input.valueId)
      return { success: true }
    }),
})
