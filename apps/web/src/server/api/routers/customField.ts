// ~/server/api/routers/customField.ts

import { FieldType } from '@auxx/database/enums'
import { getAllCachedCustomFields, getCachedCustomFields } from '@auxx/lib/cache'
import {
  countOptionUsage,
  createCustomField,
  deleteCustomField,
  type FormulaNode,
  getRelationshipPair,
  notifyCustomFieldChanged,
  toCreateFieldError,
  toFieldError,
  updateCustomField,
} from '@auxx/lib/custom-fields'
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
      return await getCachedCustomFields(ctx.session.organizationId, input.entityDefinitionId)
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
      return await getCachedCustomFields(
        ctx.session.organizationId,
        input?.entityDefinitionId ?? 'contact'
      )
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
      const { organizationId } = ctx.session
      const result = await createCustomField({ ...input, organizationId })
      // The frontend reads `cause.code` off this error to tell a duplicate name
      // apart from a validation failure — keep the shape.
      if (result.isErr()) throw toCreateFieldError(result.error)
      const created = result.value
      await notifyCustomFieldChanged(organizationId, input.entityDefinitionId, 'created')
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
      const { entityDefinitionId } = parseResourceFieldId(input.resourceFieldId)
      ctx.capabilities.assertAdministerDef(entityDefinitionId)
      const { organizationId } = ctx.session
      const result = await updateCustomField({ ...input, organizationId })
      if (result.isErr()) throw toFieldError(result.error)
      const updated = result.value
      await notifyCustomFieldChanged(organizationId, entityDefinitionId, 'updated')
      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'customField.updated',
        targetType: 'CustomField',
        targetId: String(input.resourceFieldId),
      })
      return updated
    }),

  /**
   * How many live records carry each option of a select/tag field.
   *
   * Feeds the "used on N records" warning both option editors show before a
   * delete, so it is deliberately UNSCOPED by record access — an admin about to
   * destroy an option must see the true blast radius, not their own slice.
   */
  countOptionUsage: capabilityProcedure
    .input(z.object({ resourceFieldId: resourceFieldIdSchema }))
    .query(async ({ ctx, input }) => {
      // Same gate as `update`: managing a def's fields requires `Full`/`admin`
      // on the def encoded in the resourceFieldId.
      ctx.capabilities.assertAdministerDef(
        parseResourceFieldId(input.resourceFieldId).entityDefinitionId
      )
      const result = await countOptionUsage(
        ctx.db,
        ctx.session.organizationId,
        input.resourceFieldId
      )
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Delete a custom field
   */
  delete: capabilityProcedure
    .input(z.object({ resourceFieldId: resourceFieldIdSchema }))
    .mutation(async ({ ctx, input }) => {
      // Def administration (§9.1): require `Full`/`admin` on the field's def.
      const { entityDefinitionId } = parseResourceFieldId(input.resourceFieldId)
      ctx.capabilities.assertAdministerDef(entityDefinitionId)
      const { organizationId } = ctx.session
      const result = await deleteCustomField({
        resourceFieldId: input.resourceFieldId,
        organizationId,
      })
      if (result.isErr()) throw toFieldError(result.error)
      const deleted = result.value
      await notifyCustomFieldChanged(organizationId, entityDefinitionId, 'deleted')
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
      const { organizationId } = ctx.session
      const result = await getRelationshipPair({
        resourceFieldId: input.resourceFieldId,
        organizationId,
      })
      if (result.isErr()) throw toFieldError(result.error)
      return result.value
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
      // `FieldId` is a branded string, so `FieldId[].includes(string)` does not
      // type-check. A plain `Set<string>` compares in the widening direction and
      // is O(1) per row besides.
      const requestedIds = new Set<string>(input.fieldIds)
      return allFields.filter((f) => requestedIds.has(f.id))
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
        // `RichReferencePrompt` and `FormulaNode` both describe the same TipTap
        // document; they differ only in that the former declares `content` as
        // `unknown[]` instead of recursing. See the referral on packages/types.
        promptJson: input.prompt as FormulaNode,
        options: input.options,
        name: input.name,
      })
    }),
})
