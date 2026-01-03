// apps/web/src/server/api/routers/fieldValue.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { FieldValueService } from '@auxx/lib/field-values'
import { CustomFieldService } from '@auxx/lib/custom-fields'
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
 * Separated from customField router for single responsibility
 */
export const fieldValueRouter = createTRPCRouter({
  /**
   * Get all field values for an entity
   */
  getAll: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        modelType: modelTypeSchema.default(ModelTypes.CONTACT),
      })
    )
    .query(async ({ ctx, input }) => {
      const service = new CustomFieldService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db
      )
      return await service.getValues(input.entityId, input.modelType)
    }),

  /**
   * Set a single field value for an entity
   */
  set: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        fieldId: z.string(),
        value: z.any().nullable(),
        modelType: modelTypeSchema.default(ModelTypes.CONTACT),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new CustomFieldService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db
      )
      return await service.setValue({
        entityId: input.entityId,
        fieldId: input.fieldId,
        value: input.value ?? null,
        modelType: input.modelType,
      })
    }),

  /**
   * Set multiple field values for one entity
   */
  setMany: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
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
      const service = new CustomFieldService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db
      )
      return await service.setValues({
        entityId: input.entityId,
        values: input.values.map((v) => ({
          fieldId: v.fieldId,
          value: v.value ?? null,
        })),
        modelType: input.modelType,
      })
    }),

  /**
   * Set values for multiple entities (bulk operation)
   */
  setBulk: protectedProcedure
    .input(
      z.object({
        entityIds: z.array(z.string()).min(1),
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
      const service = new CustomFieldService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db
      )
      return await service.bulkSetValues({
        entityIds: input.entityIds,
        values: input.values.map((v) => ({
          fieldId: v.fieldId,
          value: v.value ?? null,
        })),
        modelType: input.modelType,
      })
    }),

  /**
   * Delete a field value
   */
  delete: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        fieldId: z.string(),
        modelType: modelTypeSchema.default(ModelTypes.CONTACT),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new CustomFieldService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db
      )
      return await service.deleteValue({
        entityId: input.entityId,
        fieldId: input.fieldId,
        modelType: input.modelType,
      })
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
        entityIds: input.resourceIds,
        fieldIds: input.fieldIds,
      })
    }),

  /**
   * Add value to multi-value field (MULTI_SELECT, TAGS, etc.)
   */
  add: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
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
        entityId: input.entityId,
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
