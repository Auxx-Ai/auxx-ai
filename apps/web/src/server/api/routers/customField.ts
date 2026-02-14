// ~/server/api/routers/customField.ts

import { FieldType } from '@auxx/database/enums'
import { CustomFieldService } from '@auxx/lib/custom-fields'
import { getFieldsByIds } from '@auxx/services/custom-fields'
import { fieldOptionsUnionSchema, relationshipOptionsSchema } from '@auxx/types/custom-field'
import { fieldIdSchema, resourceFieldIdSchema } from '@auxx/types/field'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

export const customFieldRouter = createTRPCRouter({
  /**
   * Get all custom fields for a specific entity definition
   */
  getByEntityDefinition: protectedProcedure
    .input(z.object({ entityDefinitionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const service = new CustomFieldService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db
      )
      return await service.getAllFields(input.entityDefinitionId)
    }),

  /**
   * Get all custom fields for an organization by entity definition ID
   */
  getAll: protectedProcedure
    .input(
      z
        .object({
          entityDefinitionId: z.string(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const service = new CustomFieldService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db
      )
      return await service.getAllFields(input?.entityDefinitionId ?? 'contact')
    }),

  /**
   * Create a new custom field.
   * For RELATIONSHIP type, pass relationship options to auto-create inverse field.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        type: z.enum(FieldType),
        description: z.string().optional(),
        required: z.boolean().optional(),
        isUnique: z.boolean().optional(),
        defaultValue: z.string().optional(),
        options: fieldOptionsUnionSchema.optional(),
        addressComponents: z.array(z.string()).optional(),
        icon: z.string().optional(),
        isCustom: z.boolean().optional(),
        entityDefinitionId: z.string(),
        /** Relationship options - required when type is RELATIONSHIP */
        relationship: relationshipOptionsSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
      return await service.createField(input)
    }),

  /**
   * Update a custom field
   */
  update: protectedProcedure
    .input(
      z.object({
        resourceFieldId: resourceFieldIdSchema,
        name: z.string().optional(),
        description: z.string().optional(),
        required: z.boolean().optional(),
        isUnique: z.boolean().optional(),
        defaultValue: z.string().optional(),
        options: fieldOptionsUnionSchema.optional(),
        addressComponents: z.array(z.string()).optional(),
        icon: z.string().optional(),
        isCustom: z.boolean().optional(),
        active: z.boolean().optional(),
        sortOrder: z.string().optional(),
        type: z.enum(FieldType).optional(),
        /** Update the inverse relationship field's name (RELATIONSHIP type only) */
        inverseName: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
      return await service.updateField(input)
    }),

  /**
   * Delete a custom field
   */
  delete: protectedProcedure
    .input(z.object({ resourceFieldId: resourceFieldIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
      return await service.deleteField(input.resourceFieldId)
    }),

  /**
   * Get both sides of a relationship field
   */
  getRelationshipPair: protectedProcedure
    .input(z.object({ resourceFieldId: resourceFieldIdSchema }))
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
      return await service.getRelationshipPair(input.resourceFieldId)
    }),

  /**
   * Get multiple custom fields by their IDs.
   * Useful for fetching both sides of a relationship after updates.
   */
  getByIds: protectedProcedure
    .input(z.object({ fieldIds: z.array(fieldIdSchema) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const result = await getFieldsByIds({
        fieldIds: input.fieldIds,
        organizationId,
      })

      if (result.isErr()) {
        throw new Error(result.error.message)
      }

      return result.value
    }),
})
