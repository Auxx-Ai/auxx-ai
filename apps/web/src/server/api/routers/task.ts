// apps/web/src/server/api/routers/task.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { createTaskService, type TaskPriority } from '@auxx/lib/tasks'
import { recordIdSchema } from '@auxx/types/resource'

/**
 * Schema for relative date (days, weeks, months, years offset)
 */
const relativeDateSchema = z.object({
  days: z.number().optional(),
  weeks: z.number().optional(),
  months: z.number().optional(),
  years: z.number().optional(),
})

/**
 * Schema for absolute date
 */
const absoluteDateSchema = z.object({
  type: z.literal('static'),
  value: z.iso.datetime(),
})

/**
 * Priority enum values
 */
const prioritySchema = z.enum(['low', 'medium', 'high'])

/**
 * Task router for CRUD operations on tasks
 */
export const taskRouter = createTRPCRouter({
  /**
   * Create a new task
   */
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(500),
        description: z.string().optional(),
        deadline: absoluteDateSchema.optional(),
        priority: prioritySchema.optional(),
        assignedUserIds: z.array(z.string()).optional(),
        referencedEntities: z.array(recordIdSchema).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const taskService = createTaskService(ctx.db)

      return await taskService.createTask(input, organizationId, userId)
    }),

  /**
   * Get a task by ID
   */
  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const taskService = createTaskService(ctx.db)

    const task = await taskService.getTaskById(input.id, organizationId)
    if (!task) {
      throw new Error('Task not found')
    }

    return task
  }),

  /**
   * Update a task (handles ALL field updates including completion/archiving)
   *
   * @example Complete: { id: 'x', completedAt: new Date().toISOString(), completedById: userId }
   * @example Reopen: { id: 'x', completedAt: null, completedById: null }
   * @example Archive: { id: 'x', archivedAt: new Date().toISOString() }
   * @example Unarchive: { id: 'x', archivedAt: null }
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        // Core fields
        title: z.string().min(1).max(500).optional(),
        description: z.string().optional().nullable(),
        deadline: absoluteDateSchema.optional().nullable(),
        priority: prioritySchema.optional().nullable(),
        // Completion fields
        completedAt: z.string().datetime().optional().nullable(),
        completedById: z.string().optional().nullable(),
        // Archive field
        archivedAt: z.string().datetime().optional().nullable(),
        // Relations
        assignedUserIds: z.array(z.string()).optional(),
        referencedEntities: z.array(recordIdSchema).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const taskService = createTaskService(ctx.db)
      return await taskService.updateTask(
        {
          id: input.id,
          title: input.title,
          description: input.description ?? undefined,
          deadline: input.deadline,
          priority: (input.priority as TaskPriority | null) ?? undefined,
          completedAt: input.completedAt,
          completedById: input.completedById,
          archivedAt: input.archivedAt,
          assignedUserIds: input.assignedUserIds,
          referencedEntities: input.referencedEntities,
        },
        organizationId,
        userId
      )
    }),

  /**
   * Permanently delete a task
   */
  delete: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const taskService = createTaskService(ctx.db)

      await taskService.deleteTask(input.taskId, organizationId)
      return { success: true }
    }),

  /**
   * List tasks with filtering and pagination
   */
  list: protectedProcedure
    .input(
      z.object({
        assigneeIds: z.array(z.string()).optional(),
        createdById: z.string().optional(),
        priority: z.array(prioritySchema).optional(),
        recordId: recordIdSchema.optional(),
        search: z.string().optional(),
        includeCompleted: z.boolean().optional(),
        includeArchived: z.boolean().optional(),
        deadlineFrom: z.date().optional(),
        deadlineTo: z.date().optional(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const taskService = createTaskService(ctx.db)

      return await taskService.listTasks({
        organizationId,
        userId,
        assigneeIds: input.assigneeIds,
        createdById: input.createdById,
        priority: input.priority as TaskPriority[] | undefined,
        recordId: input.recordId,
        search: input.search,
        includeCompleted: input.includeCompleted,
        includeArchived: input.includeArchived,
        deadlineFrom: input.deadlineFrom,
        deadlineTo: input.deadlineTo,
        cursor: input.cursor,
        limit: input.limit,
      })
    }),

  /**
   * Get tasks grouped by deadline status (today, this week, upcoming, overdue, completed)
   */
  grouped: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const taskService = createTaskService(ctx.db)

    return await taskService.getGroupedTasks(organizationId)
  }),
})
