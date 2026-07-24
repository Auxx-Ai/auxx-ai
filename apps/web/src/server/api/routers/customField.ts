// ~/server/api/routers/customField.ts

import { FieldType } from '@auxx/database/enums'
import { getAllCachedCustomFields } from '@auxx/lib/cache'
import { CustomFieldService } from '@auxx/lib/custom-fields'
import { previewFieldValue } from '@auxx/lib/field-values'
import {
  fieldOptionsUnionSchema,
  relationshipOptionsSchema,
  richReferencePromptSchema,
} from '@auxx/types/custom-field'
import { fieldIdSchema, parseResourceFieldId, resourceFieldIdSchema } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { z } from 'zod'
import { recordAuditFromCtx } from '../audit-context'
import { capabilityProcedure, createTRPCRouter, protectedProcedure } from '../trpc'

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
  create: capabilityProcedure
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
        /** ADDRESS_STRUCT input variant — 'structured' persists, 'single' clears
         *  the key back to the implicit default. See addressFieldOptionsSchema. */
        inputMode: z.enum(['single', 'structured']).optional(),
        icon: z.string().optional(),
        isCustom: z.boolean().optional(),
        entityDefinitionId: z.string(),
        /** Relationship options - required when type is RELATIONSHIP */
        relationship: relationshipOptionsSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Def administration (§9.1): managing a def's fields requires `Full`/`admin`
      // on that def (OWNER/ADMIN or an explicit `admin` type-grant).
      ctx.capabilities.assertAdministerDef(input.entityDefinitionId)
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
      const created = await service.createField(input)
      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'customField.created',
        targetType: 'CustomField',
        targetId: (created as { id?: string } | null)?.id ?? null,
        metadata: {
          name: input.name,
          type: input.type,
          entityDefinitionId: input.entityDefinitionId,
        },
      })
      return created
    }),

  /**
   * Update a custom field
   */
  update: capabilityProcedure
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
        /** ADDRESS_STRUCT input variant — 'structured' persists, 'single' clears
         *  the key back to the implicit default. See addressFieldOptionsSchema. */
        inputMode: z.enum(['single', 'structured']).optional(),
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
      // Def administration (§9.1): the def is encoded in the resourceFieldId
      // (`{def}:{field}`); require `Full`/`admin` on it.
      ctx.capabilities.assertAdministerDef(
        parseResourceFieldId(input.resourceFieldId).entityDefinitionId
      )
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
      const updated = await service.updateField(input)
      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'customField.updated',
        targetType: 'CustomField',
        targetId: String(input.resourceFieldId),
      })
      return updated
    }),

  /**
   * Delete a custom field
   */
  delete: capabilityProcedure
    .input(z.object({ resourceFieldId: resourceFieldIdSchema }))
    .mutation(async ({ ctx, input }) => {
      // Def administration (§9.1): require `Full`/`admin` on the field's def.
      ctx.capabilities.assertAdministerDef(
        parseResourceFieldId(input.resourceFieldId).entityDefinitionId
      )
      const { organizationId, userId } = ctx.session
      const service = new CustomFieldService(organizationId, userId, ctx.db)
      const deleted = await service.deleteField(input.resourceFieldId)
      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'customField.deleted',
        targetType: 'CustomField',
        targetId: String(input.resourceFieldId),
      })
      return deleted
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
      const allFields = await getAllCachedCustomFields(organizationId)
      return allFields.filter((f) => input.fieldIds.includes(f.id))
    }),

  /**
   * Dry-run an AI autofill prompt against a sample record of the target
   * entity. Does not persist a FieldValue — returns the resolved prompt
   * and the generated value so the dialog can show a live preview before
   * the field is saved.
   *
   * Quota is still consumed (same `UsageGuard` + `AiUsage` audit path,
   * `source: 'autofill-preview'`).
   */
  previewAi: protectedProcedure
    .input(
      z.object({
        type: z.enum(FieldType),
        options: fieldOptionsUnionSchema.optional(),
        prompt: richReferencePromptSchema,
        /**
         * Any record in the target entity type. The client picks one from
         * the list it already has loaded; the server resolves `{fieldKey}`
         * badges against this record.
         */
        sampleRecordId: z.string(),
        /** Display name used in the system prompt. */
        name: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await previewFieldValue({
        orgId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        sampleRecordId: input.sampleRecordId as RecordId,
        type: input.type,
        promptJson: input.prompt,
        options: input.options,
        name: input.name,
      })
    }),
})
