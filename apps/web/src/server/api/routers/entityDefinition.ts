// apps/web/src/server/api/routers/entityDefinition.ts

import { schema } from '@auxx/database'
import { EntityDefinitionService } from '@auxx/lib/entity-definitions'
import {
  createEntityDefinitionSchema,
  updateEntityDefinitionSchema,
} from '@auxx/lib/entity-definitions/types'
import {
  getOrgTemplateSummaries,
  installTemplates,
  resolveOrgTemplateById,
  resolveOrgTemplatesByIds,
} from '@auxx/lib/entity-templates'
import { ForbiddenError } from '@auxx/lib/errors'
import { FeatureKey, FeaturePermissionService, PermissionKey } from '@auxx/lib/permissions'
import { checkSlugExists } from '@auxx/services/entity-definitions'
import { and, count, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { recordAuditFromCtx } from '../audit-context'
import {
  capabilityProcedure,
  createTRPCRouter,
  permissionProcedure,
  protectedProcedure,
} from '../trpc'

export const entityDefinitionRouter = createTRPCRouter({
  /**
   * Check if an apiSlug already exists for the organization or is reserved
   */
  checkSlugExists: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        excludeId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await checkSlugExists({
        slug: input.slug,
        organizationId: ctx.session.organizationId,
        excludeId: input.excludeId,
      })
      if (result.isErr()) {
        if (result.error.code === 'RESERVED_SLUG') {
          return { exists: true, reason: 'reserved' as const }
        }
        throw new Error(result.error.message)
      }
      return { exists: result.value, reason: result.value ? ('taken' as const) : null }
    }),

  /**
   * Get all entity definitions for the organization
   */
  getAll: protectedProcedure
    .input(
      z
        .object({
          includeArchived: z.boolean().optional().default(false),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const service = new EntityDefinitionService(ctx.session.organizationId, ctx.session.user.id)
      return await service.getAll(input)
    }),

  /**
   * Get a single entity definition by ID
   */
  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const service = new EntityDefinitionService(ctx.session.organizationId, ctx.session.user.id)
    const result = await service.getById(input.id)
    if (!result) {
      throw new Error('Entity definition not found')
    }
    return result
  }),

  /**
   * Get entity definition by apiSlug
   */
  getBySlug: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const service = new EntityDefinitionService(ctx.session.organizationId, ctx.session.user.id)
      const result = await service.getBySlug(input.slug)
      if (!result) {
        throw new Error('Entity definition not found')
      }
      return result
    }),

  /**
   * Create a new entity definition
   */
  // Creating a NEW def is an org-level structural change (not per-def def
  // administration), so it is gated on `settingsManage` rather than the
  // `channels` area (plan 21 §4.3/§6 — decided individually). Admins hold
  // `settingsManage` via `ROLE_DEFAULTS.ADMIN`, members stay `None` by default
  // (`USER_ADMIN_NONE_AREAS`), so behavior is preserved. Was `protectedProcedure`
  // — any member could create a def (perms v2 doc 09). Editing/deleting existing
  // defs is gated on def-`admin`.
  create: permissionProcedure(PermissionKey.settingsManage)
    .input(createEntityDefinitionSchema)
    .mutation(async ({ ctx, input }) => {
      // Feature gate: check custom entity limit (only counts custom entities, not system ones)
      await new FeaturePermissionService(ctx.db).requireLimit(
        ctx.session.organizationId,
        FeatureKey.entities,
        async () => {
          const [{ value }] = await ctx.db
            .select({ value: count() })
            .from(schema.EntityDefinition)
            .where(
              and(
                eq(schema.EntityDefinition.organizationId, ctx.session.organizationId),
                isNull(schema.EntityDefinition.entityType),
                isNull(schema.EntityDefinition.archivedAt)
              )
            )
          return value
        }
      )

      const service = new EntityDefinitionService(ctx.session.organizationId, ctx.session.user.id)
      const created = await service.create(input)
      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'entityDef.created',
        targetType: 'EntityDefinition',
        targetId: created.id,
        metadata: { apiSlug: input.apiSlug, singular: input.singular },
      })
      return created
    }),

  /**
   * Update an entity definition
   * Only allows updating: icon, singular, plural, archivedAt
   *
   * Def administration (§9.1): requires `Full`/`admin` on this def — OWNER/ADMIN
   * or an explicit `admin` type-grant. Was `protectedProcedure` (any member could
   * rename/re-icon any def); this closes that hole.
   */
  update: capabilityProcedure
    .input(
      z.object({
        id: z.string(),
        data: updateEntityDefinitionSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      ctx.capabilities.assertAdministerDef(input.id)
      const service = new EntityDefinitionService(ctx.session.organizationId, ctx.session.user.id)
      const updated = await service.update(input.id, input.data)
      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'entityDef.updated',
        targetType: 'EntityDefinition',
        targetId: input.id,
      })
      return updated
    }),

  /**
   * Archive an entity definition (soft delete). Def administration (§9.1):
   * OWNER/ADMIN or a def-`admin` grantee of this def (full delegation).
   */
  archive: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      ctx.capabilities.assertAdministerDef(input.id)
      const service = new EntityDefinitionService(ctx.session.organizationId, ctx.session.user.id)
      const archived = await service.archive(input.id)
      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'entityDef.archived',
        targetType: 'EntityDefinition',
        targetId: input.id,
      })
      return archived
    }),

  /**
   * Restore an archived entity definition (pairs with archive). Def
   * administration (§9.1): OWNER/ADMIN or a def-`admin` grantee of this def.
   */
  restore: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      ctx.capabilities.assertAdministerDef(input.id)
      const service = new EntityDefinitionService(ctx.session.organizationId, ctx.session.user.id)
      const restored = await service.restore(input.id)
      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'entityDef.restored',
        targetType: 'EntityDefinition',
        targetId: input.id,
      })
      return restored
    }),

  /**
   * Permanently delete an entity definition (with relationship + connector
   * teardown) — irreversible and org-wide. Def administration (§9.1): OWNER/ADMIN
   * or a def-`admin` grantee of this def (full delegation, user decision 2026-07-23).
   */
  delete: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      ctx.capabilities.assertAdministerDef(input.id)
      const service = new EntityDefinitionService(ctx.session.organizationId, ctx.session.user.id)
      const deleted = await service.delete(input.id)
      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'entityDef.deleted',
        targetType: 'EntityDefinition',
        targetId: input.id,
      })
      return deleted
    }),

  /**
   * List all available entity templates (lightweight, no field details)
   */
  getTemplates: protectedProcedure
    .input(z.object({ category: z.string().optional() }).optional())
    .query(({ ctx, input }) =>
      getOrgTemplateSummaries(ctx.session.organizationId, input?.category)
    ),

  /**
   * Get full template details (with fields) for preview
   */
  getTemplateById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const template = await resolveOrgTemplateById(ctx.session.organizationId, input.id)
      if (!template) {
        throw new Error('Template not found')
      }
      return template
    }),

  /**
   * Get full details for MANY templates in one roundtrip (the install dialog loads a
   * primary + its companions at once). Returns only the ids that resolve, in input
   * order; unknown ids are silently dropped. App-projected templates re-derive from the
   * installed-app catalog once (not per id).
   */
  getTemplateByIds: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).max(20) }))
    .query(({ ctx, input }) => resolveOrgTemplatesByIds(ctx.session.organizationId, input.ids)),

  /**
   * Install selected templates — creates entity definitions with fields
   */
  createFromTemplates: protectedProcedure
    .input(
      z.object({
        templateIds: z.array(z.string()).max(10),
        fieldModifications: z
          .record(
            z.string(),
            z.record(
              z.string(),
              z.object({
                customName: z.string().min(1).max(100).optional(),
                removed: z.boolean().optional(),
              })
            )
          )
          .optional(),
        linkedEntities: z
          .record(
            z.string(),
            z.object({
              entityDefinitionId: z.string(),
              newRelationshipFieldTemplateIds: z.array(z.string()).optional(),
            })
          )
          .optional(),
        // Connector/app ownership stamped on installed defs + fields when the install
        // runs inside a connector wizard (v6).
        installContext: z
          .object({
            dataConnectorId: z.string().optional(),
            appInstallationId: z.string().optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Feature gate: check custom entity limit before installing templates
      const featureService = new FeaturePermissionService(ctx.db)
      const limit = await featureService.getLimit(ctx.session.organizationId, FeatureKey.entities)
      if (typeof limit === 'number') {
        const [{ value: currentCount }] = await ctx.db
          .select({ value: count() })
          .from(schema.EntityDefinition)
          .where(
            and(
              eq(schema.EntityDefinition.organizationId, ctx.session.organizationId),
              isNull(schema.EntityDefinition.entityType),
              isNull(schema.EntityDefinition.archivedAt)
            )
          )
        const newCount = currentCount + input.templateIds.length
        if (newCount > limit) {
          throw new ForbiddenError(
            `Installing ${input.templateIds.length} template(s) would exceed your custom entities limit (${limit}). You currently have ${currentCount}.`
          )
        }
      }

      return await installTemplates(ctx.session.organizationId, input.templateIds, {
        fieldModifications: input.fieldModifications,
        linkedEntities: input.linkedEntities,
        // Org-aware so `app:*` record-type templates resolve from installed-app catalogs.
        resolveTemplates: (ids) => resolveOrgTemplatesByIds(ctx.session.organizationId, ids),
        installContext: input.installContext,
      })
    }),
})
