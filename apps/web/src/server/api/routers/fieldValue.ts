// apps/web/src/server/api/routers/fieldValue.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { FieldValueService } from '@auxx/lib/field-values'
import type { RecordId } from '@auxx/types/resource'
import { fieldIdSchema } from '@auxx/types/field'

/** Typed value input schema for multi-value fields */
const typedValueInputSchema = z.object({
  type: z.enum(['text', 'number', 'boolean', 'date', 'json', 'option', 'relationship']),
  value: z.any().optional(),
  optionId: z.string().optional(),
  relatedEntityId: z.string().optional(),
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(ctx.session.organizationId, ctx.session.user.id, ctx.db)
      return await service.setValueWithBuiltIn({
        recordId: input.recordId as RecordId,
        fieldId: input.fieldId,
        value: input.value ?? null,
      })
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
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(ctx.session.organizationId, ctx.session.user.id, ctx.db)
      return await service.setBulkValues({
        recordIds: input.recordIds as RecordId[],
        values: input.values.map((v) => ({
          fieldId: v.fieldId,
          value: v.value ?? null,
        })),
      })
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
      const service = new FieldValueService(ctx.session.organizationId, ctx.session.user.id, ctx.db)
      await service.deleteValue({
        recordId: input.recordId as RecordId,
        fieldId: input.fieldId,
      })
      return { success: true }
    }),

  /**
   * Batch get values for syncer.
   * Uses RecordId format (entityDefinitionId:entityInstanceId).
   * Returns TypedFieldValue directly (no legacy wrapper).
   */
  batchGet: protectedProcedure
    .input(
      z.object({
        recordIds: z.array(z.string()).max(500), // RecordId format
        fieldIds: z.array(fieldIdSchema).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(ctx.session.organizationId, ctx.session.user.id, ctx.db)
      return await service.batchGetValues({
        recordIds: input.recordIds as any, // Cast to RecordId[]
        fieldIds: input.fieldIds,
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
      const service = new FieldValueService(ctx.session.organizationId, ctx.session.user.id, ctx.db)
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
      const service = new FieldValueService(ctx.session.organizationId, ctx.session.user.id, ctx.db)
      await service.removeValue(input.valueId)
      return { success: true }
    }),
})
