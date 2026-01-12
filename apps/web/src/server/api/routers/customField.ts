// ~/server/api/routers/customField.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { CustomFieldService } from '@auxx/lib/custom-fields'
import {
  ModelTypes,
  ModelTypeValues,
  fieldOptionsUnionSchema,
  relationshipOptionsSchema,
  type ModelType,
} from '@auxx/types/custom-field'
import { FieldType } from '@auxx/database/enums'
import { isSystemResourceId } from '@auxx/lib/resources'

// Zod schema for ModelType validation
const modelTypeSchema = z.enum(ModelTypeValues)

/**
 * Derive modelType from entityDefinitionId.
 * System resources use their ID as modelType, custom entities use 'entity'.
 */
function deriveModelType(entityDefinitionId: string | undefined | null): ModelType {
  if (!entityDefinitionId) return ModelTypes.CONTACT
  return isSystemResourceId(entityDefinitionId)
    ? (entityDefinitionId as ModelType)
    : ModelTypes.ENTITY
}

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
   * Get all custom fields for an organization and model type.
   * modelType is derived from entityDefinitionId if not provided.
   */
  getAll: protectedProcedure
    .input(
      z
        .object({
          modelType: modelTypeSchema.optional(),
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
      const modelType = input?.modelType ?? deriveModelType(input?.entityDefinitionId)
      return await service.getAllFields(modelType, input?.entityDefinitionId)
    }),

  /**
   * Create a new custom field.
   * modelType is derived from entityDefinitionId if not provided.
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
        modelType: modelTypeSchema.optional(),
        entityDefinitionId: z.string().nullish(),
        /** Relationship options - required when type is RELATIONSHIP */
        relationship: relationshipOptionsSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { modelType: inputModelType, ...fieldData } = input
      const modelType = inputModelType ?? deriveModelType(input.entityDefinitionId)
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
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
      return await service.deleteField(input.id)
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
