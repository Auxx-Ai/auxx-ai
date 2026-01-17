// ~/server/api/routers/customField.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { CustomFieldService } from '@auxx/lib/custom-fields'
import { fieldOptionsUnionSchema, relationshipOptionsSchema } from '@auxx/types/custom-field'
import { FieldType } from '@auxx/database/enums'
import { resourceFieldIdSchema } from '@auxx/types/field'

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

  })
