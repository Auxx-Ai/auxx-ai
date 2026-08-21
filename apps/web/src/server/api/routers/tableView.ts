// apps/web/src/server/api/routers/tableView.ts

import { schema } from '@auxx/database'
import { getUserCache, onCacheEvent } from '@auxx/lib/cache'
import {
  type FieldViewConfig,
  fieldViewConfigSchema,
  type TableViewPreferenceConfig,
  tableViewPreferenceConfigSchema,
  type ViewConfig,
  viewConfigSchema,
  viewContextTypeSchema,
} from '@auxx/lib/conditions'
import {
  createCustomField,
  notifyCustomFieldChanged,
  toCreateFieldError,
} from '@auxx/lib/custom-fields'
import { ForbiddenError } from '@auxx/lib/errors'
import { isAdminOrOwner } from '@auxx/lib/members'
import type { CapabilitySet } from '@auxx/lib/permissions'
import { FeatureKey, FeaturePermissionService } from '@auxx/lib/permissions'
import { countSavedViewsUsed } from '@auxx/lib/table-views'
import {
  createView,
  deleteView,
  duplicateView,
  getView,
  setDefaultView,
  updateView,
} from '@auxx/services/table-view'
import { TRPCError } from '@trpc/server'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter } from '~/server/api/trpc'
import { isStructural, resolveDefId } from './table-view-helpers'

/**
 * Client metadata derived from server-authoritative ownership and capabilities.
 *
 * `isOrgAdmin` deliberately still includes ADMIN after doc 19 step 10, unlike the
 * bypasses narrowed in `capability-set` / `entity-access` / `resource-access-service`.
 * Two reasons, both blocking:
 *  - **It is a mirror, not a gate.** Both server gates it reflects are still binary
 *    role checks: {@link assertStructuralAccess}'s def-less fallback and `update`'s
 *    `isAdminOrOwner` → `updateView({ ownerOnly: !isAdmin, orgWide: isAdmin })`
 *    scope. Narrowing only the client flag would hide affordances the server still
 *    grants. Narrowing the gates too *is* §5.3 **piece 3** (the since-deleted
 *    `adminProcedure` / `isAdminOrOwner` migration, §11.5's own plan) — not this step.
 *  - **No profile-side remedy exists for the branch that matters.** `isOrgAdmin` is
 *    only load-bearing when `entityDefinitionId` is `null` (non-entity surfaces);
 *    when a def resolves, `canSetDefault` already delegates to
 *    `capabilities.canAdministerDef`, which step 10 deliberately left alone. With no
 *    def there is no `ResourceAccess` anchor for a `granteeType:'profile'` grant and
 *    no `PermissionKey` for table views, so narrowing here removes authority with
 *    nothing able to give it back — the same test that spared `canAdministerRecord`.
 */
function withViewPermissions<
  T extends {
    entityDefinitionId: string | null
    contextType: string
    isDefault: boolean
    isShared: boolean
    userId: string
  },
>(view: T, capabilities: CapabilitySet, userId: string) {
  const isOrgAdmin = capabilities.role === 'OWNER' || capabilities.role === 'ADMIN'
  const isOwner = view.userId === userId
  const canSetDefault = view.entityDefinitionId
    ? capabilities.canAdministerDef(view.entityDefinitionId)
    : isOrgAdmin
  const structural = isStructural({
    contextType: view.contextType,
    isDefault: view.isDefault,
  })

  return {
    ...view,
    canUpdate: structural ? canSetDefault : isOwner || isOrgAdmin,
    canDelete: isOwner,
    canSetDefault,
  }
}

/** Effective Read is sufficient for ordinary table-view use and authoring. */
function assertViewAccess(capabilities: CapabilitySet, entityDefinitionId: string | null): void {
  if (entityDefinitionId) capabilities.assertViewEntity(entityDefinitionId)
}

/** Resolve and validate the entity target for a user-owned preference write. */
async function resolvePreferenceTarget(input: {
  tableId: string
  tableViewId: string | null
  userId: string
  organizationId: string
}): Promise<string | null> {
  if (!input.tableViewId) {
    return resolveDefId(input.tableId, input.organizationId)
  }

  const rowResult = await getView({
    id: input.tableViewId,
    userId: input.userId,
    organizationId: input.organizationId,
  })
  if (rowResult.isErr()) mapErrorToTRPC(rowResult.error)
  if (rowResult.value.tableId !== input.tableId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'View does not belong to this table.' })
  }
  return rowResult.value.entityDefinitionId
}

/**
 * Map service error codes to TRPCError
 */
function mapErrorToTRPC(error: { code: string; message: string }): never {
  const codeMap: Record<string, 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL_SERVER_ERROR'> = {
    VIEW_NOT_FOUND: 'NOT_FOUND',
    VIEW_ALREADY_EXISTS: 'CONFLICT',
    DATABASE_ERROR: 'INTERNAL_SERVER_ERROR',
  }

  throw new TRPCError({
    code: codeMap[error.code] ?? 'INTERNAL_SERVER_ERROR',
    message: error.message,
  })
}

/**
 * Gate a STRUCTURAL table-view write (perms v2 doc 07): setting the org default
 * view or editing a panel/dialog field config. Requires def administration
 * (`Full`/`admin`) when the view resolves to a def; for non-entity surfaces
 * (`entityDefinitionId` null — no def to delegate) it falls closed to org-admin.
 */
async function assertStructuralAccess(
  capabilities: CapabilitySet,
  entityDefinitionId: string | null,
  organizationId: string,
  userId: string
): Promise<void> {
  if (entityDefinitionId) {
    capabilities.assertAdministerDef(entityDefinitionId)
    return
  }
  // Scope selection, not a gate — see note at top (plan 21 §5.2).
  const isAdmin = await isAdminOrOwner(organizationId, userId)
  if (!isAdmin) {
    throw new ForbiddenError('You do not have permission to configure this view.')
  }
}

/**
 * Table view router for managing saved table configurations
 */
export const tableViewRouter = createTRPCRouter({
  /**
   * Get all views across all tables for the user's organization.
   * Used to populate the app-wide view store on initialization.
   * Includes all context types: table, kanban, panel, dialog_create, dialog_edit.
   * Served from user cache (Redis + local).
   */
  listAll: capabilityProcedure.query(async ({ ctx }) => {
    const userCache = getUserCache()
    const cachedViews = await userCache.get(
      ctx.session.userId,
      'userTableViews',
      ctx.session.organizationId
    )
    // **Saved views stay on `canViewEntity`, deliberately** (plan v3/03 §6.2).
    // An org-authored saved view embeds a filter CONFIG and field references —
    // def-level information about a definition a grant-only member cannot see —
    // so widening this to `hasDefPresence` would hand them the definition's
    // schema through its views. Their default-view fallback is the preference
    // loop below, which is what P5 widens instead.
    const views = cachedViews
      .filter(
        (view) =>
          !view.entityDefinitionId || ctx.capabilities.canViewEntity(view.entityDefinitionId)
      )
      .map((view) =>
        withViewPermissions(
          view as typeof view & { config: ViewConfig | FieldViewConfig },
          ctx.capabilities,
          ctx.session.userId
        )
      )

    const preferenceRows = await ctx.db
      .select()
      .from(schema.TableViewPreference)
      .where(
        and(
          eq(schema.TableViewPreference.userId, ctx.session.userId),
          eq(schema.TableViewPreference.organizationId, ctx.session.organizationId)
        )
      )

    const accessibleViewIds = new Set(views.map((view) => view.id))
    const defaultPreferenceAccess = new Map<string, boolean>()
    const preferences: Array<{
      id: string
      tableId: string
      tableViewId: string | null
      config: TableViewPreferenceConfig
    }> = []

    for (const preference of preferenceRows) {
      if (preference.tableViewId) {
        if (!accessibleViewIds.has(preference.tableViewId)) continue
      } else {
        // `tableViewId: null` is the DEFAULT TABLE — the member's own column
        // widths / order / visibility for the def's built-in grid, carrying no
        // org-authored filter config and no reference to anything but the def's
        // own fields. So this half gates on {@link hasDefPresence}: a grant-only
        // member gets the def's DEFAULT view and columns (plan v3/03 §6.2), and
        // the rows inside it are scoped per row in SQL by `recordVisibilityScope`.
        let allowed = defaultPreferenceAccess.get(preference.tableId)
        if (allowed === undefined) {
          const entityDefinitionId = await resolveDefId(
            preference.tableId,
            ctx.session.organizationId
          )
          allowed = !entityDefinitionId || ctx.capabilities.hasDefPresence(entityDefinitionId)
          defaultPreferenceAccess.set(preference.tableId, allowed)
        }
        if (!allowed) continue
      }

      preferences.push({
        id: preference.id,
        tableId: preference.tableId,
        tableViewId: preference.tableViewId,
        config: preference.config as TableViewPreferenceConfig,
      })
    }

    return { views, preferences }
  }),

  /**
   * Get a single view by ID
   */
  get: capabilityProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const result = await getView({
      id: input.id,
      userId: ctx.session.userId,
      organizationId: ctx.session.organizationId,
    })

    if (result.isErr()) mapErrorToTRPC(result.error)
    assertViewAccess(ctx.capabilities, result.value.entityDefinitionId)
    return withViewPermissions(
      { ...result.value, config: result.value.config as ViewConfig },
      ctx.capabilities,
      ctx.session.userId
    )
  }),

  /**
   * Create a new view
   * Optionally creates a new SINGLE_SELECT field for kanban grouping
   */
  create: capabilityProcedure
    .input(
      z.object({
        tableId: z.string(),
        name: z.string().min(1).max(50),
        config: z.union([viewConfigSchema, fieldViewConfigSchema]),
        contextType: viewContextTypeSchema.optional().default('table'),
        isShared: z.boolean().optional().default(false),
        isDefault: z.boolean().optional().default(false),
        /** Optional: Create a new SINGLE_SELECT field for kanban grouping */
        newField: z
          .object({
            name: z.string().min(1).max(50),
            /** Entity definition ID (e.g., 'contact', 'ticket', or custom entity ID) */
            entityDefinitionId: z.string(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session

      // Resolve the def this view belongs to (null for non-entity surfaces) and
      // persist it as the typed link that backs the def-admin gate. Structural
      // writes (panel/dialog config or setting the org default) require def
      // administration; ordinary table/kanban authoring stays open (doc 07 §2).
      const entityDefinitionId = await resolveDefId(input.tableId, organizationId)
      assertViewAccess(ctx.capabilities, entityDefinitionId)
      if (input.newField) {
        if (!entityDefinitionId || input.newField.entityDefinitionId !== entityDefinitionId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Kanban field does not belong to this table.',
          })
        }
        ctx.capabilities.assertAdministerDef(entityDefinitionId)
      }
      if (isStructural(input)) {
        await assertStructuralAccess(ctx.capabilities, entityDefinitionId, organizationId, userId)
      }

      // Check saved view limit (only for shared/team views)
      if (input.isShared) {
        const featureService = new FeaturePermissionService(ctx.db)
        const viewLimit = await featureService.getLimit(organizationId, FeatureKey.savedViews)
        if (typeof viewLimit === 'number' && viewLimit >= 0) {
          const current = await countSavedViewsUsed(ctx.db, organizationId)
          if (current >= viewLimit) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: `You have reached your saved view limit (${viewLimit}). Upgrade your plan to create more views.`,
            })
          }
        }
      }

      let finalConfig = input.config

      // Handle new kanban field creation (stays in router)
      if (input.newField && 'viewType' in input.config && input.config.viewType === 'kanban') {
        const fieldResult = await createCustomField({
          organizationId,
          name: input.newField.name,
          type: 'SINGLE_SELECT',
          entityDefinitionId: input.newField.entityDefinitionId,
          options: [],
          isCustom: true,
        })
        if (fieldResult.isErr()) throw toCreateFieldError(fieldResult.error)
        const createdField = fieldResult.value
        await notifyCustomFieldChanged(organizationId, input.newField.entityDefinitionId, 'created')

        finalConfig = {
          ...input.config,
          kanban: { ...input.config.kanban, groupByFieldId: createdField.id },
        }
      }

      const result = await createView({
        tableId: input.tableId,
        name: input.name,
        config: finalConfig,
        isShared: input.isShared,
        isDefault: input.isDefault,
        contextType: input.contextType,
        entityDefinitionId,
        userId,
        organizationId,
      })

      if (result.isErr()) mapErrorToTRPC(result.error)

      await onCacheEvent('table-view.created', {
        orgId: organizationId,
        userId,
        broadcastUserKeys: input.isShared,
      })

      return withViewPermissions(
        { ...result.value, config: result.value.config as ViewConfig },
        ctx.capabilities,
        userId
      )
    }),

  /**
   * Update an existing view
   * Note: .passthrough() allows extra fields (resourceFieldId, visible) used by client-side
   * onMutate callbacks for optimistic update context - these are ignored server-side.
   */
  update: capabilityProcedure
    .input(
      z
        .object({
          id: z.string(),
          name: z.string().min(1).max(50).optional(),
          config: z.union([viewConfigSchema, fieldViewConfigSchema]).optional(),
          isShared: z.boolean().optional(),
        })
        .passthrough()
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      // Scope selection, not a gate — see note at top (plan 21 §5.2).
      const isAdmin = await isAdminOrOwner(organizationId, userId)

      // Load the target row (org-wide) to key the structural gate off its stored
      // contextType / entityDefinitionId. A write is structural if the row is a
      // panel/dialog config OR it's a default view OR the input flips isDefault on
      // (the back-door — gated the same as setDefault, doc 07 §2).
      const rowResult = await getView({
        id: input.id,
        userId,
        organizationId,
        options: { orgWide: true },
      })
      if (rowResult.isErr()) mapErrorToTRPC(rowResult.error)
      const row = rowResult.value
      assertViewAccess(ctx.capabilities, row.entityDefinitionId)

      const wantsDefault = (input as { isDefault?: unknown }).isDefault === true
      const structural =
        isStructural({ contextType: row.contextType, isDefault: row.isDefault }) || wantsDefault

      if (structural) {
        await assertStructuralAccess(
          ctx.capabilities,
          row.entityDefinitionId,
          organizationId,
          userId
        )
      }

      // Structural writes are org-wide (a def-admin edits shared panel/dialog
      // configs they may not own); non-structural writes keep today's ownership
      // scope (own views, or any org view for org-admins).
      const result = await updateView({
        id: input.id,
        userId,
        organizationId,
        name: input.name,
        config: input.config,
        isShared: input.isShared,
        isAdmin: structural ? true : isAdmin,
      })

      if (result.isErr()) mapErrorToTRPC(result.error)

      await onCacheEvent('table-view.updated', {
        orgId: ctx.session.organizationId,
        userId: ctx.session.userId,
        broadcastUserKeys: result.value.isShared,
      })

      return withViewPermissions(
        { ...result.value, config: result.value.config as ViewConfig | FieldViewConfig },
        ctx.capabilities,
        userId
      )
    }),

  /**
   * Duplicate an existing view
   */
  duplicate: capabilityProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const rowResult = await getView({
        id: input.id,
        userId: ctx.session.userId,
        organizationId: ctx.session.organizationId,
      })
      if (rowResult.isErr()) mapErrorToTRPC(rowResult.error)
      assertViewAccess(ctx.capabilities, rowResult.value.entityDefinitionId)

      const result = await duplicateView({
        id: input.id,
        name: input.name,
        userId: ctx.session.userId,
        organizationId: ctx.session.organizationId,
      })

      if (result.isErr()) mapErrorToTRPC(result.error)

      await onCacheEvent('table-view.created', {
        orgId: ctx.session.organizationId,
        userId: ctx.session.userId,
      })

      return withViewPermissions(
        { ...result.value, config: result.value.config as ViewConfig },
        ctx.capabilities,
        ctx.session.userId
      )
    }),

  /**
   * Delete a view
   */
  delete: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rowResult = await getView({
        id: input.id,
        userId: ctx.session.userId,
        organizationId: ctx.session.organizationId,
      })
      if (rowResult.isErr()) mapErrorToTRPC(rowResult.error)
      assertViewAccess(ctx.capabilities, rowResult.value.entityDefinitionId)

      const result = await deleteView({
        id: input.id,
        userId: ctx.session.userId,
        organizationId: ctx.session.organizationId,
      })

      if (result.isErr()) mapErrorToTRPC(result.error)

      await onCacheEvent('table-view.deleted', {
        orgId: ctx.session.organizationId,
        userId: ctx.session.userId,
        broadcastUserKeys: true,
      })

      return result.value
    }),

  /** Persist presentation-only state for the current user. */
  upsertPreference: capabilityProcedure
    .input(
      z.object({
        tableId: z.string(),
        tableViewId: z.string().nullable(),
        config: tableViewPreferenceConfigSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const entityDefinitionId = await resolvePreferenceTarget({
        tableId: input.tableId,
        tableViewId: input.tableViewId,
        userId,
        organizationId,
      })
      assertViewAccess(ctx.capabilities, entityDefinitionId)

      const [preference] = await ctx.db
        .insert(schema.TableViewPreference)
        .values({
          tableId: input.tableId,
          tableViewId: input.tableViewId,
          config: input.config,
          userId,
          organizationId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            schema.TableViewPreference.organizationId,
            schema.TableViewPreference.userId,
            schema.TableViewPreference.tableId,
            schema.TableViewPreference.tableViewId,
          ],
          set: { config: input.config, updatedAt: new Date() },
        })
        .returning()

      if (!preference) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to save table preference.',
        })
      }

      return {
        id: preference.id,
        tableId: preference.tableId,
        tableViewId: preference.tableViewId,
        config: preference.config as TableViewPreferenceConfig,
      }
    }),

  /** Reset the current user's presentation preference for one table/view. */
  deletePreference: capabilityProcedure
    .input(z.object({ tableId: z.string(), tableViewId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const entityDefinitionId = await resolvePreferenceTarget({
        tableId: input.tableId,
        tableViewId: input.tableViewId,
        userId: ctx.session.userId,
        organizationId: ctx.session.organizationId,
      })
      assertViewAccess(ctx.capabilities, entityDefinitionId)

      await ctx.db
        .delete(schema.TableViewPreference)
        .where(
          and(
            eq(schema.TableViewPreference.organizationId, ctx.session.organizationId),
            eq(schema.TableViewPreference.userId, ctx.session.userId),
            eq(schema.TableViewPreference.tableId, input.tableId),
            input.tableViewId
              ? eq(schema.TableViewPreference.tableViewId, input.tableViewId)
              : isNull(schema.TableViewPreference.tableViewId)
          )
        )

      return { success: true }
    }),

  /**
   * Set a view as the org default (perms v2 doc 07): def administration
   * (`Full`/`admin`) for the view's def, or org-admin for non-entity surfaces.
   */
  setDefault: capabilityProcedure
    .input(z.object({ tableId: z.string(), viewId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session

      // Load the target view to gate on its stored def link (fail closed to
      // org-admin when it belongs to no def).
      const rowResult = await getView({
        id: input.viewId,
        userId,
        organizationId,
        options: { orgWide: true },
      })
      if (rowResult.isErr()) mapErrorToTRPC(rowResult.error)
      await assertStructuralAccess(
        ctx.capabilities,
        rowResult.value.entityDefinitionId,
        organizationId,
        userId
      )

      const result = await setDefaultView({
        tableId: input.tableId,
        viewId: input.viewId,
        organizationId,
      })

      if (result.isErr()) mapErrorToTRPC(result.error)

      await onCacheEvent('table-view.default-changed', {
        orgId: ctx.session.organizationId,
        broadcastUserKeys: true,
      })

      return withViewPermissions(
        { ...result.value, config: result.value.config as ViewConfig },
        ctx.capabilities,
        userId
      )
    }),
})
