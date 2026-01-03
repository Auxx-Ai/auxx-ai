// ~/server/api/routers/customField.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { CustomFieldService } from '@auxx/lib/custom-fields'
import {
  ModelTypes,
  ModelTypeValues,
  selectOptionSchema,
  currencyOptionsSchema,
  fileOptionsSchema,
} from '@auxx/types/custom-field'
import { FieldType } from '@auxx/database/enums'

// Zod schema for ModelType validation
const modelTypeSchema = z.enum(ModelTypeValues)

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
      return await service.getAllFields(ModelTypes.ENTITY, input.entityDefinitionId)
    }),

  /**
   * Get all custom fields for an organization and model type
   */
  getAll: protectedProcedure
    .input(
      z
        .object({
          modelType: modelTypeSchema.default(ModelTypes.CONTACT),
          entityDefinitionId: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const service = new CustomFieldService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db
      )
      return await service.getAllFields(input?.modelType, input?.entityDefinitionId)
    }),

  /**
   * Create a new custom field
   * For RELATIONSHIP type, pass relationship options to auto-create inverse field
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
        options: z
          .union([
            z.array(selectOptionSchema),
            z.object({ file: fileOptionsSchema }),
            z.object({ currency: currencyOptionsSchema }),
          ])
          .optional(),
        addressComponents: z.array(z.string()).optional(),
        icon: z.string().optional(),
        isCustom: z.boolean().optional(),
        modelType: modelTypeSchema.default(ModelTypes.CONTACT),
        entityDefinitionId: z.string().nullish(),
        /** Relationship options - required when type is RELATIONSHIP */
        relationship: z
          .object({
            relatedResourceId: z.string().optional(),
            relatedModelType: modelTypeSchema.nullish(),
            relatedEntityDefinitionId: z.string().nullish(),
            relationshipType: z.enum(['belongs_to', 'has_one', 'has_many', 'many_to_many']),
            displayFieldId: z.string().nullish(),
            inverseName: z.string(),
            inverseDescription: z.string().optional(),
            inverseIcon: z.string().optional(),
            inverseDisplayFieldId: z.string().nullish(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { modelType, ...fieldData } = input
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
      return await service.createField(fieldData, modelType)
    }),

  /**
   * Update a custom field
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        required: z.boolean().optional(),
        isUnique: z.boolean().optional(),
        defaultValue: z.string().optional(),
        options: z
          .union([
            z.array(selectOptionSchema),
            z.object({ file: fileOptionsSchema }),
            z.object({ currency: currencyOptionsSchema }),
          ])
          .optional(),
        addressComponents: z.array(z.string()).optional(),
        icon: z.string().optional(),
        isCustom: z.boolean().optional(),
        active: z.boolean().optional(),
        position: z.number().optional(),
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
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
      return await service.deleteField(input.id)
    }),

  /**
   * Update positions of multiple custom fields
   */
  updatePositions: protectedProcedure
    .input(
      z.object({
        positions: z.array(z.object({ id: z.string(), position: z.number() })),
        modelType: modelTypeSchema.default(ModelTypes.CONTACT),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
      return await service.updatePositions({
        positions: input.positions,
        modelType: input.modelType,
      })
    }),

  /**
   * Get both sides of a relationship field
   */
  getRelationshipPair: protectedProcedure
    .input(z.object({ fieldId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
      return await service.getRelationshipPair(input.fieldId)
    }),

  })
