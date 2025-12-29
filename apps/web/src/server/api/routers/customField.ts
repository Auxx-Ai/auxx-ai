// ~/server/api/routers/customField.ts

import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { CustomFieldService } from '@auxx/lib/custom-fields'
import { ModelTypes, ModelTypeValues, SELECT_OPTION_COLORS } from '@auxx/lib/custom-fields/types'
import { FieldType } from '@auxx/database/enums'
import { batchGetFieldValuesQuery } from '@auxx/services/custom-fields'

// Zod schema for ModelType validation
const modelTypeSchema = z.enum(ModelTypeValues)

/** Schema for target time in status (kanban-specific) */
const targetTimeInStatusSchema = z.object({
  value: z.number().min(1),
  unit: z.enum(['days', 'months', 'years']),
})

/** Schema for select/multi-select field options */
const selectOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
  color: z.enum(SELECT_OPTION_COLORS).optional(),
  targetTimeInStatus: targetTimeInStatusSchema.optional(),
  celebration: z.boolean().optional(),
})

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
            z.object({ allowMultiple: z.boolean() }),
            z.object({
              currency: z.object({
                currencyCode: z.string().length(3),
                decimalPlaces: z.enum(['two-places', 'no-decimal']),
                displayType: z.enum(['symbol', 'name', 'code']),
                groups: z.enum(['default', 'no-groups']),
              }),
            }),
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
            z.object({ allowMultiple: z.boolean() }),
            z.object({
              currency: z.object({
                currencyCode: z.string().length(3),
                decimalPlaces: z.enum(['two-places', 'no-decimal']),
                displayType: z.enum(['symbol', 'name', 'code']),
                groups: z.enum(['default', 'no-groups']),
              }),
            }),
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
   * Get all field values for an entity
   */
  getValues: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        modelType: modelTypeSchema.default(ModelTypes.CONTACT),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
      return await service.getValues(input.entityId, input.modelType)
    }),

  /**
   * Set a field value for an entity
   */
  setValue: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        fieldId: z.string(),
        value: z.any().nullable(),
        modelType: modelTypeSchema.default(ModelTypes.CONTACT),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
      return await service.setValue({
        entityId: input.entityId,
        fieldId: input.fieldId,
        value: input.value ?? null,
        modelType: input.modelType,
      })
    }),

  /**
   * Delete a field value
   */
  deleteValue: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        fieldId: z.string(),
        modelType: modelTypeSchema.default(ModelTypes.CONTACT),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
      return await service.deleteValue({
        entityId: input.entityId,
        fieldId: input.fieldId,
        modelType: input.modelType,
      })
    }),

  /**
   * Set multiple field values for an entity in a batch operation
   */
  setValues: protectedProcedure
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
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
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
   * Get both sides of a relationship field
   */
  getRelationshipPair: protectedProcedure
    .input(z.object({ fieldId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
      return await service.getRelationshipPair(input.fieldId)
    }),

  /**
   * Bulk set field values for multiple entities
   */
  bulkSetValues: protectedProcedure
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
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
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
   * Batch get field values for multiple resources (used by smart value syncer)
   */
  batchGetValues: protectedProcedure
    .input(
      z.object({
        resourceType: z.enum(['contact', 'ticket', 'entity']),
        entityDefId: z.string().optional(),
        resourceIds: z.array(z.string()).max(500), // Limit batch size
        fieldIds: z.array(z.string()).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await batchGetFieldValuesQuery({
        ...input,
        orgId: ctx.session.organizationId,
      })

      if (result.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
        })
      }

      return result.value
    }),

  /**
   * Update a specific select option in a SINGLE_SELECT/MULTI_SELECT field.
   * Used by kanban column settings to update option properties.
   */
  updateSelectOption: protectedProcedure
    .input(
      z.object({
        fieldId: z.string(),
        optionValue: z.string(),
        updates: z.object({
          label: z.string().optional(),
          color: z.enum(SELECT_OPTION_COLORS).optional(),
          targetTimeInStatus: targetTimeInStatusSchema.nullish(),
          celebration: z.boolean().optional(),
        }),
        modelType: modelTypeSchema.default(ModelTypes.CONTACT),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { fieldId, optionValue, updates, modelType } = input
      const service = new CustomFieldService(organizationId, userId, ctx.db)

      // Get the current field to retrieve existing options
      const fields = await service.getAllFields(modelType)
      const field = fields.find((f) => f.id === fieldId)

      if (!field) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found' })
      }

      if (field.type !== 'SINGLE_SELECT' && field.type !== 'MULTI_SELECT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Field must be SINGLE_SELECT or MULTI_SELECT',
        })
      }

      // Get current options from the field
      const currentOptions = (field.options as { options?: Array<Record<string, unknown>> })
        ?.options ?? []

      // Find and update the target option
      const updatedOptions = currentOptions.map((opt) => {
        if (opt.value === optionValue) {
          return {
            ...opt,
            ...(updates.label !== undefined && { label: updates.label }),
            ...(updates.color !== undefined && { color: updates.color }),
            ...(updates.targetTimeInStatus !== undefined && {
              targetTimeInStatus: updates.targetTimeInStatus ?? undefined,
            }),
            ...(updates.celebration !== undefined && { celebration: updates.celebration }),
          }
        }
        return opt
      })

      // Update the field with modified options
      return await service.updateField({
        id: fieldId,
        options: updatedOptions as Array<{
          label: string
          value: string
          color?: (typeof SELECT_OPTION_COLORS)[number]
          targetTimeInStatus?: { value: number; unit: 'days' | 'months' | 'years' }
          celebration?: boolean
        }>,
      })
    }),

  /**
   * Delete a select option from a SINGLE_SELECT/MULTI_SELECT field.
   * Used by kanban column settings to delete a stage.
   */
  deleteSelectOption: protectedProcedure
    .input(
      z.object({
        fieldId: z.string(),
        optionValue: z.string(),
        modelType: modelTypeSchema.default(ModelTypes.CONTACT),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { fieldId, optionValue, modelType } = input
      const service = new CustomFieldService(organizationId, userId, ctx.db)

      // Get the current field to retrieve existing options
      const fields = await service.getAllFields(modelType)
      const field = fields.find((f) => f.id === fieldId)

      if (!field) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found' })
      }

      if (field.type !== 'SINGLE_SELECT' && field.type !== 'MULTI_SELECT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Field must be SINGLE_SELECT or MULTI_SELECT',
        })
      }

      // Get current options and filter out the deleted one
      const currentOptions = (field.options as { options?: Array<Record<string, unknown>> })
        ?.options ?? []
      const updatedOptions = currentOptions.filter((opt) => opt.value !== optionValue)

      // Update the field with filtered options
      return await service.updateField({
        id: fieldId,
        options: updatedOptions as Array<{
          label: string
          value: string
          color?: (typeof SELECT_OPTION_COLORS)[number]
          targetTimeInStatus?: { value: number; unit: 'days' | 'months' | 'years' }
          celebration?: boolean
        }>,
      })
    }),
})
