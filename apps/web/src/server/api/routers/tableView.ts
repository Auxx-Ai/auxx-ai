// apps/web/src/server/api/routers/tableView.ts

import { schema } from '@auxx/database'
import {
  type FieldViewConfig,
  fieldViewConfigSchema,
  type ViewConfig,
  viewConfigSchema,
  viewContextTypeSchema,
  viewContextTypes,
} from '@auxx/lib/conditions'
import { CustomFieldService } from '@auxx/lib/custom-fields'
import { isAdminOrOwner } from '@auxx/lib/members'
import { FeatureKey, FeaturePermissionService } from '@auxx/lib/permissions'
import {
  createView,
  deleteView,
  duplicateView,
  getView,
  listAllViews,
  listViews,
  setDefaultView,
  updateView,
} from '@auxx/services/table-view'
import { TRPCError } from '@trpc/server'
import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

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
 * Table view router for managing saved table configurations
 */
export const tableViewRouter = createTRPCRouter({
  /**
   * Get all views for a specific table
   */
  list: protectedProcedure
    .input(
      z.object({
        tableId: z.string(),
        contextType: viewContextTypeSchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await listViews({
        tableId: input.tableId,
        userId: ctx.session.userId,
        organizationId: ctx.session.organizationId,
        contextType: input.contextType,
      })

      if (result.isErr()) mapErrorToTRPC(result.error)
      return result.value.map((v) => ({ ...v, config: v.config as ViewConfig }))
    }),

  /**
   * Get all views across all tables for the user's organization
   * Used to populate the app-wide view store on initialization.
   * Includes all context types: table, kanban, panel, dialog_create, dialog_edit
   */
  listAll: protectedProcedure.query(async ({ ctx }) => {
    const result = await listAllViews({
      userId: ctx.session.userId,
      organizationId: ctx.session.organizationId,
      contextType: [...viewContextTypes],
    })

    if (result.isErr()) mapErrorToTRPC(result.error)
    return result.value.map((v) => ({ ...v, config: v.config as ViewConfig | FieldViewConfig }))
  }),

  /**
   * Get a single view by ID
   */
  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const result = await getView({
      id: input.id,
      userId: ctx.session.userId,
      organizationId: ctx.session.organizationId,
    })

    if (result.isErr()) mapErrorToTRPC(result.error)
    return { ...result.value, config: result.value.config as ViewConfig }
  }),

  /**
   * Create a new view
   * Optionally creates a new SINGLE_SELECT field for kanban grouping
   */
  create: protectedProcedure
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

      // Check saved view limit (only for shared/team views)
      if (input.isShared) {
        const featureService = new FeaturePermissionService(ctx.db)
        const viewLimit = await featureService.getLimit(organizationId, FeatureKey.savedViews)
        if (typeof viewLimit === 'number' && viewLimit >= 0) {
          const [{ value: current }] = await ctx.db
            .select({ value: count() })
            .from(schema.TableView)
            .where(
              and(
                eq(schema.TableView.organizationId, organizationId),
                eq(schema.TableView.isShared, true)
              )
            )
          if (current >= viewLimit) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: `You have reached your saved view limit (${viewLimit}). Upgrade your plan to create more views.`,
            })
          }
        }
      }

      let finalConfig = input.config

      // Handle new kanban field creation (stays in router - uses CustomFieldService)
      if (input.newField && 'viewType' in input.config && input.config.viewType === 'kanban') {
        const fieldService = new CustomFieldService(organizationId, userId, ctx.db)
        const createdField = await fieldService.createField({
          name: input.newField.name,
          type: 'SINGLE_SELECT',
          entityDefinitionId: input.newField.entityDefinitionId,
          options: [],
          isCustom: true,
        })

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
        userId,
        organizationId,
      })

      if (result.isErr()) mapErrorToTRPC(result.error)
      return { ...result.value, config: result.value.config as ViewConfig }
    }),

  /**
   * Update an existing view
   * Note: .passthrough() allows extra fields (resourceFieldId, visible) used by client-side
   * onMutate callbacks for optimistic update context - these are ignored server-side.
   */
  update: protectedProcedure
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
      const isAdmin = await isAdminOrOwner(ctx.session.organizationId, ctx.session.userId)

      const result = await updateView({
        id: input.id,
        userId: ctx.session.userId,
        organizationId: ctx.session.organizationId,
        name: input.name,
        config: input.config,
        isShared: input.isShared,
        isAdmin,
      })

      if (result.isErr()) mapErrorToTRPC(result.error)
      return { ...result.value, config: result.value.config as ViewConfig | FieldViewConfig }
    }),

  /**
   * Duplicate an existing view
   */
  duplicate: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const result = await duplicateView({
        id: input.id,
        name: input.name,
        userId: ctx.session.userId,
        organizationId: ctx.session.organizationId,
      })

      if (result.isErr()) mapErrorToTRPC(result.error)
      return { ...result.value, config: result.value.config as ViewConfig }
    }),

  /**
   * Delete a view
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await deleteView({
        id: input.id,
        userId: ctx.session.userId,
        organizationId: ctx.session.organizationId,
      })

      if (result.isErr()) mapErrorToTRPC(result.error)
      return result.value
    }),

  /**
   * Set a view as default for the organization (admin only)
   */
  setDefault: adminProcedure
    .input(z.object({ tableId: z.string(), viewId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await setDefaultView({
        tableId: input.tableId,
        viewId: input.viewId,
        organizationId: ctx.session.organizationId,
      })

      if (result.isErr()) mapErrorToTRPC(result.error)
      return { ...result.value, config: result.value.config as ViewConfig }
    }),
})
