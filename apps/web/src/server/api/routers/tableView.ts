// apps/web/src/server/api/routers/tableView.ts

import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure, adminProcedure } from '~/server/api/trpc'
import type { ViewConfig } from '~/components/dynamic-table/types'
import { CustomFieldService } from '@auxx/lib/custom-fields'
import { ModelTypeValues } from '@auxx/types/custom-field'
import {
  listViews,
  listAllViews,
  getView,
  createView,
  updateView,
  duplicateView,
  deleteView,
  setDefaultView,
} from '@auxx/services/table-view'

/** Schema for model type validation */
const modelTypeSchema = z.enum(ModelTypeValues)

/** Schema for kanban column settings (per-column view settings) */
const kanbanColumnSettingsSchema = z.object({
  isVisible: z.boolean().optional(),
})

/** Zod schema for kanban configuration */
const kanbanConfigSchema = z.object({
  groupByFieldId: z.string(),
  columnOrder: z.array(z.string()).optional(),
  collapsedColumns: z.array(z.string()).optional(),
  cardFields: z.array(z.string()).optional(),
  primaryFieldId: z.string().optional(),
  columnSettings: z.record(z.string(), kanbanColumnSettingsSchema).optional(),
})

/** Zod schema for view configuration */
const viewConfigSchema = z.object({
  filters: z.array(
    z.object({ id: z.string(), columnId: z.string(), operator: z.string(), value: z.any() })
  ),
  sorting: z.array(z.object({ id: z.string(), desc: z.boolean() })),
  columnVisibility: z.record(z.string(), z.boolean()),
  columnOrder: z.array(z.string()),
  columnSizing: z.record(z.string(), z.number()),
  columnPinning: z
    .object({
      left: z.array(z.string()).optional(),
      right: z.array(z.string()).optional(),
    })
    .optional(),
  columnLabels: z.record(z.string(), z.string()).optional(),
  rowHeight: z.enum(['compact', 'normal', 'spacious']).optional(),
  viewType: z.enum(['table', 'kanban']).optional().default('table'),
  kanban: kanbanConfigSchema.optional(),
})

/**
 * Map service error codes to TRPCError
 */
function mapErrorToTRPC(error: { code: string; message: string }): never {
  const codeMap: Record<string, 'NOT_FOUND' | 'CONFLICT' | 'BAD_REQUEST' | 'INTERNAL_SERVER_ERROR'> = {
    VIEW_NOT_FOUND: 'NOT_FOUND',
    VIEW_ALREADY_EXISTS: 'CONFLICT',
    CANNOT_DELETE_DEFAULT_VIEW: 'BAD_REQUEST',
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
    .input(z.object({ tableId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await listViews({
        tableId: input.tableId,
        userId: ctx.session.userId,
        organizationId: ctx.session.organizationId,
      })

      if (result.isErr()) mapErrorToTRPC(result.error)
      return result.value.map((v) => ({ ...v, config: v.config as ViewConfig }))
    }),

  /**
   * Get all views across all tables for the user's organization
   * Used to populate the app-wide view store on initialization
   */
  listAll: protectedProcedure.query(async ({ ctx }) => {
    const result = await listAllViews({
      userId: ctx.session.userId,
      organizationId: ctx.session.organizationId,
    })

    if (result.isErr()) mapErrorToTRPC(result.error)
    return result.value.map((v) => ({ ...v, config: v.config as ViewConfig }))
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
        config: viewConfigSchema,
        isShared: z.boolean().optional().default(false),
        /** Optional: Create a new SINGLE_SELECT field for kanban grouping */
        newField: z
          .object({
            name: z.string().min(1).max(50),
            /** Model type: 'contact', 'ticket', 'entity', etc. */
            modelType: modelTypeSchema,
            /** Entity definition ID - required only when modelType is 'entity' */
            entityDefinitionId: z.string().nullish(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      let finalConfig = input.config

      // Handle new kanban field creation (stays in router - uses CustomFieldService)
      if (input.newField && input.config.viewType === 'kanban') {
        const fieldService = new CustomFieldService(organizationId, userId, ctx.db)
        const createdField = await fieldService.createField(
          {
            name: input.newField.name,
            type: 'SINGLE_SELECT',
            entityDefinitionId:
              input.newField.modelType === 'entity' ? input.newField.entityDefinitionId : undefined,
            options: [],
            isCustom: true,
          },
          input.newField.modelType
        )

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
        userId,
        organizationId,
      })

      if (result.isErr()) mapErrorToTRPC(result.error)
      return { ...result.value, config: result.value.config as ViewConfig }
    }),

  /**
   * Update an existing view
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(50).optional(),
        config: viewConfigSchema.optional(),
        isShared: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateView({
        id: input.id,
        userId: ctx.session.userId,
        organizationId: ctx.session.organizationId,
        name: input.name,
        config: input.config,
        isShared: input.isShared,
      })

      if (result.isErr()) mapErrorToTRPC(result.error)
      return { ...result.value, config: result.value.config as ViewConfig }
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
