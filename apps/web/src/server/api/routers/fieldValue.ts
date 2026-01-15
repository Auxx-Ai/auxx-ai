// apps/web/src/server/api/routers/fieldValue.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { FieldValueService } from '@auxx/lib/field-values'
import type { ResourceId } from '@auxx/types/resource'
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
 * ResourceId format: "entityDefinitionId:entityInstanceId"
 */
export const fieldValueRouter = createTRPCRouter({
  /**
   * Set a single field value for a resource.
   * Expects resourceId in ResourceId format (entityDefinitionId:entityInstanceId).
   */
  set: protectedProcedure
    .input(
      z.object({
        resourceId: z.string(), // ResourceId format
        fieldId: fieldIdSchema,
        value: z.any().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(ctx.session.organizationId, ctx.session.user.id, ctx.db)
      return await service.setValueWithBuiltIn({
        resourceId: input.resourceId as ResourceId,
        fieldId: input.fieldId,
        value: input.value ?? null,
      })
    }),

  /**
   * Set multiple field values for one resource.
   * Expects resourceId in ResourceId format.
   */
  // setMany: protectedProcedure
  //   .input(
  //     z.object({
  //       resourceId: z.string(), // ResourceId format
  //       values: z.array(
  //         z.object({
  //           fieldId: z.string(),
  //           value: z.any().nullable(),
  //         })
  //       ),
  //     })
  //   )
  //   .mutation(async ({ ctx, input }) => {
  //     const { entityDefinitionId, entityInstanceId } = parseResourceId(input.resourceId as ResourceId)
  //     const modelType = getModelType(entityDefinitionId)

  //     const service = new FieldValueService(
  //       ctx.session.organizationId,
  //       ctx.session.user.id,
  //       ctx.db
  //     )
  //     return await service.setValuesForEntity({
  //       entityId: entityInstanceId,
  //       values: input.values.map((v) => ({
  //         fieldId: v.fieldId,
  //         value: v.value ?? null,
  //       })),
  //       modelType,
  //     })
  //   }),

  /**
   * Set values for multiple resources (bulk operation).
   * Expects resourceIds in ResourceId format.
   */
  setBulk: protectedProcedure
    .input(
      z.object({
        resourceIds: z.array(z.string()).min(1), // ResourceId format
        values: z.array(
          z.object({
            fieldId: fieldIdSchema,
            value: z.any().nullable(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(ctx.session.organizationId, ctx.session.user.id, ctx.db)
      return await service.setBulkValues({
        resourceIds: input.resourceIds as ResourceId[],
        values: input.values.map((v) => ({
          fieldId: v.fieldId,
          value: v.value ?? null,
        })),
      })
    }),

  /**
   * Delete a field value for a resource.
   * Expects resourceId in ResourceId format.
   */
  delete: protectedProcedure
    .input(
      z.object({
        resourceId: z.string(), // ResourceId format
        fieldId: fieldIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(ctx.session.organizationId, ctx.session.user.id, ctx.db)
      await service.deleteValue({
        resourceId: input.resourceId as ResourceId,
        fieldId: input.fieldId,
      })
      return { success: true }
    }),

  /**
   * Batch get values for syncer.
   * Uses ResourceId format (entityDefinitionId:entityInstanceId).
   * Returns TypedFieldValue directly (no legacy wrapper).
   */
  batchGet: protectedProcedure
    .input(
      z.object({
        resourceIds: z.array(z.string()).max(500), // ResourceId format
        fieldIds: z.array(fieldIdSchema).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(ctx.session.organizationId, ctx.session.user.id, ctx.db)
      return await service.batchGetValues({
        resourceIds: input.resourceIds as any, // Cast to ResourceId[]
        fieldIds: input.fieldIds,
      })
    }),

  /**
   * Add value to multi-value field (MULTI_SELECT, TAGS, etc.)
   * Expects resourceId in ResourceId format.
   */
  add: protectedProcedure
    .input(
      z.object({
        resourceId: z.string(), // ResourceId format
        fieldId: fieldIdSchema,
        fieldType: z.string(),
        value: typedValueInputSchema,
        position: z
          .union([z.literal('start'), z.literal('end'), z.object({ after: z.string() })])
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const service = new FieldValueService(ctx.session.organizationId, ctx.session.user.id, ctx.db)
      return await service.addValue({
        resourceId: input.resourceId as ResourceId,
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
