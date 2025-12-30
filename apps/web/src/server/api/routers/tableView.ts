// apps/web/src/server/api/routers/tableView.ts

import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import type { ViewConfig } from '~/components/dynamic-table/types'
import { database as db, schema } from '@auxx/database'
import { and, eq, or, desc, asc, inArray } from 'drizzle-orm'
import { CustomFieldService } from '@auxx/lib/custom-fields'
import { ModelTypeValues } from '@auxx/types/custom-field'

/** Schema for model type validation */
const modelTypeSchema = z.enum(ModelTypeValues)

/** Schema for kanban column settings (per-column view settings) */
const kanbanColumnSettingsSchema = z.object({
  isVisible: z.boolean().optional(),
})

/**
 * Zod schema for kanban configuration
 */
const kanbanConfigSchema = z.object({
  groupByFieldId: z.string(),
  columnOrder: z.array(z.string()).optional(),
  collapsedColumns: z.array(z.string()).optional(),
  cardFields: z.array(z.string()).optional(),
  primaryFieldId: z.string().optional(),
  columnSettings: z.record(z.string(), kanbanColumnSettingsSchema).optional(),
})

/**
 * Zod schema for view configuration
 */
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
 * Table view router for managing saved table configurations
 */
export const tableViewRouter = createTRPCRouter({
  /**
   * Get all views for a specific table
   */
  list: protectedProcedure
    .input(z.object({ tableId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const views = await db
        .select()
        .from(schema.TableView)
        .where(
          and(
            eq(schema.TableView.tableId, input.tableId),
            or(
              // User's personal views
              eq(schema.TableView.userId, userId),
              // Organization's shared views
              and(
                eq(schema.TableView.organizationId, organizationId),
                eq(schema.TableView.isShared, true)
              )
            )
          )
        )
        .orderBy(desc(schema.TableView.isDefault), asc(schema.TableView.name))

      return views.map((view) => ({ ...view, config: view.config as ViewConfig }))
    }),

  /**
   * Get a single view by ID
   */
  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { userId, organizationId } = ctx.session
    const [view] = await db
      .select()
      .from(schema.TableView)
      .where(
        and(
          eq(schema.TableView.id, input.id),
          or(
            eq(schema.TableView.userId, userId),
            and(
              eq(schema.TableView.organizationId, organizationId),
              eq(schema.TableView.isShared, true)
            )
          )
        )
      )
      .limit(1)

    if (!view) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'View not found',
      })
    }

    return { ...view, config: view.config as ViewConfig }
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
      const { tableId, name, config, isShared, newField } = input

      let finalConfig = config

      // If creating a new field for kanban, create it first
      if (newField && config.viewType === 'kanban') {
        const fieldService = new CustomFieldService(organizationId, userId, ctx.db)

        const createdField = await fieldService.createField(
          {
            name: newField.name,
            type: 'SINGLE_SELECT',
            // Only pass entityDefinitionId for custom entities
            entityDefinitionId:
              newField.modelType === 'entity' ? newField.entityDefinitionId : undefined,
            options: [], // Empty - stages added later in kanban
            isCustom: true,
          },
          newField.modelType
        )

        // Update kanban config with the new field ID
        finalConfig = {
          ...config,
          kanban: {
            ...config.kanban,
            groupByFieldId: createdField.id,
          },
        }
      }

      // Check if user already has a view with this name for this table
      const [existingView] = await db
        .select()
        .from(schema.TableView)
        .where(
          and(
            eq(schema.TableView.tableId, tableId),
            eq(schema.TableView.userId, userId),
            eq(schema.TableView.name, name)
          )
        )
        .limit(1)

      if (existingView) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A view with this name already exists',
        })
      }

      try {
        const [view] = await db
          .insert(schema.TableView)
          .values({
            tableId,
            name,
            config: finalConfig,
            isShared,
            userId,
            organizationId,
            updatedAt: new Date(),
          })
          .returning()

        return { ...view, config: view.config as ViewConfig }
      } catch (error) {
        console.error('Failed to create view:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create view. Please try again.',
        })
      }
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
      const { userId } = ctx.session
      const { id, name, config, isShared } = input
      // Verify ownership
      const [existingView] = await db
        .select()
        .from(schema.TableView)
        .where(and(eq(schema.TableView.id, id), eq(schema.TableView.userId, userId)))
        .limit(1)

      if (!existingView) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: "View not found or you don't have permission to update it",
        })
      }

      const [view] = await db
        .update(schema.TableView)
        .set({ name, config, isShared })
        .where(eq(schema.TableView.id, id))
        .returning()

      return { ...view, config: view.config as ViewConfig }
    }),

  /**
   * Duplicate an existing view
   */
  duplicate: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const { id, name } = input
      const [originalView] = await db
        .select()
        .from(schema.TableView)
        .where(
          and(
            eq(schema.TableView.id, id),
            or(
              eq(schema.TableView.userId, userId),
              and(
                eq(schema.TableView.organizationId, organizationId),
                eq(schema.TableView.isShared, true)
              )
            )
          )
        )
        .limit(1)

      if (!originalView) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'View not found',
        })
      }

      const [view] = await db
        .insert(schema.TableView)
        .values({
          tableId: originalView.tableId,
          name,
          config: originalView.config,
          isShared: false, // Duplicated views are always personal
          userId,
          organizationId,
          updatedAt: new Date(),
        })
        .returning()

      return { ...view, config: view.config as ViewConfig }
    }),

  /**
   * Delete a view
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const { id } = input
      const [view] = await db
        .select()
        .from(schema.TableView)
        .where(and(eq(schema.TableView.id, id), eq(schema.TableView.userId, userId)))
        .limit(1)

      if (!view) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: "View not found or you don't have permission to delete it",
        })
      }

      if (view.isDefault) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot delete the default view',
        })
      }

      await db.delete(schema.TableView).where(eq(schema.TableView.id, input.id))

      return { success: true }
    }),

  /**
   * Set a view as default for the organization
   */
  setDefault: protectedProcedure
    .input(z.object({ tableId: z.string(), viewId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const { tableId, viewId } = input
      // Check if user is admin/owner
      const [membership] = await db
        .select()
        .from(schema.OrganizationMember)
        .where(
          and(
            eq(schema.OrganizationMember.userId, userId),
            eq(schema.OrganizationMember.organizationId, organizationId),
            inArray(schema.OrganizationMember.role, ['OWNER', 'ADMIN'])
          )
        )
        .limit(1)

      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: "You don't have permission to set default views",
        })
      }

      // Remove current default
      await db
        .update(schema.TableView)
        .set({ isDefault: false })
        .where(
          and(
            eq(schema.TableView.tableId, tableId),
            eq(schema.TableView.organizationId, organizationId),
            eq(schema.TableView.isDefault, true)
          )
        )

      // Set new default
      const [view] = await db
        .update(schema.TableView)
        .set({
          isDefault: true,
          isShared: true, // Default views must be shared
        })
        .where(eq(schema.TableView.id, input.viewId))
        .returning()

      return { ...view, config: view.config as ViewConfig }
    }),
})
