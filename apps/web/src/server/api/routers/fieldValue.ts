// apps/web/src/server/api/routers/fieldValue.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { FieldValueService, type ModelType } from '@auxx/lib/field-values'
import { ModelTypes, ModelTypeValues } from '@auxx/types/custom-field'

/** Zod schema for ModelType validation */
const modelTypeSchema = z.enum(ModelTypeValues)

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
 */
export const fieldValueRouter = createTRPCRouter({
  /**
   * Set a single field value for a resource
   */
  set: protectedProcedure
    .input(
      z.object({
        resourceId: z.string(),
        fieldId: z.string(),
        value: z.any().nullable(),
        modelType: modelTypeSchema.default(ModelTypes.CONTACT),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db
      )
      return await service.setValueWithBuiltIn({
        entityId: input.resourceId,
        fieldId: input.fieldId,
        value: input.value ?? null,
        modelType: input.modelType as ModelType,
      })
    }),

  /**
   * Set multiple field values for one resource
   */
  setMany: protectedProcedure
    .input(
      z.object({
        resourceId: z.string(),
        values: z.array(
          z.object({
            fieldId: z.string(),
            value: z.any().nullable(),
          })
        ),
        modelType: modelTypeSchema.default(ModelTypes.CONTACT),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db
      )
      return await service.setValuesForEntity({
        entityId: input.resourceId,
        values: input.values.map((v) => ({
          fieldId: v.fieldId,
          value: v.value ?? null,
        })),
        modelType: input.modelType as ModelType,
      })
    }),

  /**
   * Set values for multiple resources (bulk operation)
   */
  setBulk: protectedProcedure
    .input(
      z.object({
        resourceIds: z.array(z.string()).min(1),
        values: z.array(
          z.object({
            fieldId: z.string(),
            value: z.any().nullable(),
          })
        ),
        modelType: modelTypeSchema.default(ModelTypes.ENTITY),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db
      )
      return await service.setBulkValues({
        entityIds: input.resourceIds,
        values: input.values.map((v) => ({
          fieldId: v.fieldId,
          value: v.value ?? null,
        })),
        modelType: input.modelType as ModelType,
      })
    }),

  /**
   * Delete a field value for a resource
   */
  delete: protectedProcedure
    .input(
      z.object({
        resourceId: z.string(),
        fieldId: z.string(),
        modelType: modelTypeSchema.default(ModelTypes.CONTACT),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db
      )
      await service.deleteValue({
        entityId: input.resourceId,
        fieldId: input.fieldId,
      })
      return { success: true }
    }),

  /**
   * Batch get values for syncer
   * Returns TypedFieldValue directly (no legacy wrapper)
   */
  batchGet: protectedProcedure
    .input(
      z.object({
        resourceType: z.enum(['contact', 'ticket', 'entity']),
        entityDefId: z.string().optional(),
        resourceIds: z.array(z.string()).max(500),
        fieldIds: z.array(z.string()).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db
      )
      return await service.batchGetValues({
        resourceType: input.resourceType,
        entityDefId: input.entityDefId,
        resourceIds: input.resourceIds,
        fieldIds: input.fieldIds,
      })
    }),

  /**
   * Add value to multi-value field (MULTI_SELECT, TAGS, etc.)
   */
  add: protectedProcedure
    .input(
      z.object({
        resourceId: z.string(),
        fieldId: z.string(),
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
        ctx.db
      )
      return await service.addValue({
        entityId: input.resourceId,
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
        ctx.db
      )
      await service.removeValue(input.valueId)
      return { success: true }
    }),
})
