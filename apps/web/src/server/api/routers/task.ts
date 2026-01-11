// apps/web/src/server/api/routers/task.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { createTaskService, type TaskPriority } from '@auxx/lib/tasks'

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
 * Schema for deadline (relative or absolute)
 */
// const deadlineSchema = z.union(relativeDateSchema, absoluteDateSchema)

/**
 * Schema for entity reference
 */
const entityReferenceSchema = z.object({
  entityInstanceId: z.string(),
  entityDefinitionId: z.string(),
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
        referencedEntities: z.array(entityReferenceSchema).optional(),
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
   * Update a task
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(500).optional(),
        description: z.string().optional().nullable(),
        deadline: absoluteDateSchema.optional().nullable(),
        priority: prioritySchema.optional().nullable(),
        assignedUserIds: z.array(z.string()).optional(),
        referencedEntities: z.array(entityReferenceSchema).optional(),
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
          assignedUserIds: input.assignedUserIds,
          referencedEntities: input.referencedEntities,
        },
        organizationId,
        userId
      )
    }),

  /**
   * Mark a task as complete
   */
  complete: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        completionNotes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const taskService = createTaskService(ctx.db)

      return await taskService.completeTask(
        {
          taskId: input.taskId,
          completionNotes: input.completionNotes,
        },
        organizationId,
        userId
      )
    }),

  /**
   * Reopen a completed task
   */
  reopen: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const taskService = createTaskService(ctx.db)

      return await taskService.reopenTask(input.taskId, organizationId)
    }),

  /**
   * Archive a task (soft delete)
   */
  archive: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const taskService = createTaskService(ctx.db)

      return await taskService.archiveTask(input.taskId, organizationId)
    }),

  /**
   * Unarchive a task
   */
  unarchive: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const taskService = createTaskService(ctx.db)

      return await taskService.unarchiveTask(input.taskId, organizationId)
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
        entityInstanceId: z.string().optional(),
        entityDefinitionId: z.string().optional(),
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
        entityInstanceId: input.entityInstanceId,
        entityDefinitionId: input.entityDefinitionId,
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
