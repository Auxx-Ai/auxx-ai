// packages/lib/src/tasks/task-service.ts

import type { TaskEntity } from '@auxx/database'
import { type Database, schema, type Transaction } from '@auxx/database'
import { type ActorId, getActorRawId, getActorType, toActorId } from '@auxx/types/actor'
import type { RecordId } from '@auxx/types/resource'
import type { Deadline, RelativeDate } from '@auxx/types/task'
import { TRPCError } from '@trpc/server'
import { and, eq, gte, ilike, inArray, isNull, lt, lte } from 'drizzle-orm'
import { parseRecordId, toRecordId } from '../field-values/relationship-field'
import { hasDefinedProps, pickDefined } from '../utils/pick-defined'
import type {
  CreateTaskInput,
  GroupedTasksResponse,
  TaskFilterOptions,
  TaskListResponse,
  TaskWithRelations,
  UpdateTaskInput,
} from './types'

/**
 * Convert a relative or absolute deadline to a concrete Date
 */
function resolveDeadline(deadline: Deadline): Date {
  if ('type' in deadline && deadline.type === 'static') {
    // Ensure we return a Date object, not a string
    return deadline.value instanceof Date ? deadline.value : new Date(deadline.value)
  }

  // Relative date
  const relative = deadline as RelativeDate
  const now = new Date()

  if (relative.days) {
    now.setDate(now.getDate() + relative.days)
  }
  if (relative.weeks) {
    now.setDate(now.getDate() + relative.weeks * 7)
  }
  if (relative.months) {
    now.setMonth(now.getMonth() + relative.months)
  }
  if (relative.years) {
    now.setFullYear(now.getFullYear() + relative.years)
  }

  return now
}

/**
 * Generate searchable text from title and description
 */
function generateSearchText(title: string, description?: string | null): string {
  const parts = [title]
  if (description) {
    parts.push(description)
  }
  return parts.join(' ')
}

/**
 * Get the start of today in UTC
 */
function getStartOfToday(): Date {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return now
}

/**
 * Get the end of today in UTC
 */
function getEndOfToday(): Date {
  const now = new Date()
  now.setHours(23, 59, 59, 999)
  return now
}

/**
 * Get the end of the current week (Sunday)
 */
function getEndOfWeek(): Date {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const daysUntilSunday = 7 - dayOfWeek
  now.setDate(now.getDate() + daysUntilSunday)
  now.setHours(23, 59, 59, 999)
  return now
}

/**
 * Service class for handling task operations
 */
export class TaskService {
  constructor(private db: Database) {}

  /**
   * Create a new task with optional assignments and references
   */
  async createTask(
    input: CreateTaskInput,
    organizationId: string,
    userId: string
  ): Promise<TaskEntity> {
    const { title, description, deadline, priority, assigneeActorIds, referencedEntities } = input

    const resolvedDeadline = deadline ? resolveDeadline(deadline) : null
    const searchText = generateSearchText(title, description)

    // Extract user IDs from ActorIds (filter out groups for now)
    const assignedUserIds = assigneeActorIds
      ?.filter((id) => getActorType(id) === 'user')
      .map((id) => getActorRawId(id))

    return await this.db.transaction(async (tx: Transaction) => {
      // Insert the task
      const [task] = await tx
        .insert(schema.Task)
        .values({
          organizationId,
          title,
          description,
          deadline: resolvedDeadline,
          priority: priority ?? null,
          createdById: userId,
          searchText,
          assignedUserCount: assignedUserIds?.length ?? 0,
          referenceCount: referencedEntities?.length ?? 0,
          updatedAt: new Date(),
        })
        .returning()

      if (!task) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create task' })
      }

      // Create assignments if provided
      if (assignedUserIds && assignedUserIds.length > 0) {
        await tx.insert(schema.TaskAssignment).values(
          assignedUserIds.map((assignedToUserId) => ({
            organizationId,
            taskId: task.id,
            assignedToUserId,
            assignedById: userId,
          }))
        )
      }

      // Create references if provided
      if (referencedEntities && referencedEntities.length > 0) {
        await tx.insert(schema.TaskReference).values(
          referencedEntities.map((recordId) => {
            const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
            return {
              organizationId,
              taskId: task.id,
              referencedEntityInstanceId: entityInstanceId,
              referencedEntityDefinitionId: entityDefinitionId,
              createdById: userId,
            }
          })
        )
      }

      return task
    })
  }

  /**
   * Get a task by ID with relations
   */
  async getTaskById(taskId: string, organizationId: string): Promise<TaskWithRelations | null> {
    const task = await this.db.query.Task.findFirst({
      where: (t, { eq, and }) => and(eq(t.id, taskId), eq(t.organizationId, organizationId)),
    })

    if (!task) {
      return null
    }

    // Get assignments - only need user IDs to convert to ActorId
    const assignmentRows = await this.db.query.TaskAssignment.findMany({
      where: (a, { eq, and, isNull }) => and(eq(a.taskId, taskId), isNull(a.unassignedAt)),
      columns: { assignedToUserId: true },
    })

    // Convert to ActorId[]
    const assignments = assignmentRows.map((a) => toActorId('user', a.assignedToUserId))

    // Get references - load only IDs
    const referenceRows = await this.db.query.TaskReference.findMany({
      where: (r, { eq, and, isNull }) => and(eq(r.taskId, taskId), isNull(r.deletedAt)),
      columns: {
        referencedEntityDefinitionId: true,
        referencedEntityInstanceId: true,
      },
    })

    // Convert to RecordId[]
    const references = referenceRows.map((ref) =>
      toRecordId(ref.referencedEntityDefinitionId, ref.referencedEntityInstanceId)
    )

    return {
      ...task,
      assignments,
      references,
    }
  }

  /**
   * Update an existing task with partial data.
   * Only fields that are defined (not undefined) will be updated.
   * Pass null to explicitly clear a field.
   *
   * Handles all field updates including completion and archiving:
   * - Complete: { completedAt: new Date(), completedById: userId }
   * - Reopen: { completedAt: null, completedById: null }
   * - Archive: { archivedAt: new Date() }
   * - Unarchive: { archivedAt: null }
   */
  async updateTask(
    input: UpdateTaskInput,
    organizationId: string,
    userId: string
  ): Promise<TaskEntity> {
    const {
      id,
      title,
      description,
      deadline,
      priority,
      completedAt,
      completedById,
      archivedAt,
      assigneeActorIds,
      referencedEntities,
    } = input

    // Check if task exists
    const existingTask = await this.db.query.Task.findFirst({
      where: (t, { eq, and }) => and(eq(t.id, id), eq(t.organizationId, organizationId)),
    })

    if (!existingTask) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' })
    }

    // Build update object - only include defined fields
    const coreUpdates = pickDefined({
      title,
      description,
      priority,
      completedAt:
        completedAt !== undefined
          ? completedAt === null
            ? null
            : new Date(completedAt)
          : undefined,
      completedById,
      archivedAt:
        archivedAt !== undefined ? (archivedAt === null ? null : new Date(archivedAt)) : undefined,
      updatedAt: new Date(),
    })

    // Handle deadline separately (needs resolution)
    if (deadline !== undefined) {
      ;(coreUpdates as any).deadline = deadline === null ? null : resolveDeadline(deadline)
    }

    // Update searchText if title or description changed
    if (title !== undefined || description !== undefined) {
      ;(coreUpdates as any).searchText = generateSearchText(
        title ?? existingTask.title,
        description !== undefined ? description : existingTask.description
      )
    }

    return await this.db.transaction(async (tx: Transaction) => {
      // Update the task (only if there are core updates)
      let updatedTask = existingTask
      if (hasDefinedProps(coreUpdates)) {
        const [result] = await tx
          .update(schema.Task)
          .set(coreUpdates)
          .where(and(eq(schema.Task.id, id), eq(schema.Task.organizationId, organizationId)))
          .returning()

        if (!result) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update task' })
        }
        updatedTask = result
      }

      // Sync assignments if provided
      if (assigneeActorIds !== undefined) {
        await this.syncAssignments(tx, id, organizationId, userId, assigneeActorIds)
      }

      // Sync references if provided
      if (referencedEntities !== undefined) {
        await this.syncReferences(tx, id, organizationId, userId, referencedEntities)
      }

      return updatedTask
    })
  }

  /**
   * Sync task assignments - add new, remove old
   */
  private async syncAssignments(
    tx: Transaction,
    taskId: string,
    organizationId: string,
    userId: string,
    assigneeActorIds: ActorId[]
  ): Promise<void> {
    // Extract user IDs from ActorIds (filter out groups for now)
    const assignedUserIds = assigneeActorIds
      .filter((id) => getActorType(id) === 'user')
      .map((id) => getActorRawId(id))

    const currentAssignments = await tx.query.TaskAssignment.findMany({
      where: (a, { eq, and, isNull }) => and(eq(a.taskId, taskId), isNull(a.unassignedAt)),
    })
    const currentUserIds = new Set(currentAssignments.map((a) => a.assignedToUserId))
    const newUserIds = new Set(assignedUserIds)

    // Unassign removed users
    const toUnassign = currentAssignments.filter((a) => !newUserIds.has(a.assignedToUserId))
    if (toUnassign.length > 0) {
      await tx
        .update(schema.TaskAssignment)
        .set({ unassignedAt: new Date() })
        .where(
          inArray(
            schema.TaskAssignment.id,
            toUnassign.map((a) => a.id)
          )
        )
    }

    // Assign new users
    const toAssign = assignedUserIds.filter((uid) => !currentUserIds.has(uid))
    if (toAssign.length > 0) {
      await tx.insert(schema.TaskAssignment).values(
        toAssign.map((assignedToUserId) => ({
          organizationId,
          taskId,
          assignedToUserId,
          assignedById: userId,
        }))
      )
    }

    // Update denormalized count
    await tx
      .update(schema.Task)
      .set({ assignedUserCount: assignedUserIds.length })
      .where(eq(schema.Task.id, taskId))
  }

  /**
   * Sync task references - add new, remove old
   */
  private async syncReferences(
    tx: Transaction,
    taskId: string,
    organizationId: string,
    userId: string,
    referencedEntities: RecordId[]
  ): Promise<void> {
    const currentRefs = await tx.query.TaskReference.findMany({
      where: (r, { eq, and, isNull }) => and(eq(r.taskId, taskId), isNull(r.deletedAt)),
    })
    const currentRefIds = new Set(currentRefs.map((r) => r.referencedEntityInstanceId))

    // Parse RecordId[] to get instance IDs for comparison
    const parsedEntities = referencedEntities.map((recordId) => parseRecordId(recordId))
    const newRefIds = new Set(parsedEntities.map((e) => e.entityInstanceId))

    // Soft-delete removed references
    const toRemove = currentRefs.filter((r) => !newRefIds.has(r.referencedEntityInstanceId))
    if (toRemove.length > 0) {
      await tx
        .update(schema.TaskReference)
        .set({ deletedAt: new Date() })
        .where(
          inArray(
            schema.TaskReference.id,
            toRemove.map((r) => r.id)
          )
        )
    }

    // Add new references (filter by entity instance ID not in current)
    const toAdd = parsedEntities.filter((e) => !currentRefIds.has(e.entityInstanceId))
    if (toAdd.length > 0) {
      await tx.insert(schema.TaskReference).values(
        toAdd.map((parsed) => ({
          organizationId,
          taskId,
          referencedEntityInstanceId: parsed.entityInstanceId,
          referencedEntityDefinitionId: parsed.entityDefinitionId,
          createdById: userId,
        }))
      )
    }

    // Update denormalized count
    await tx
      .update(schema.Task)
      .set({ referenceCount: referencedEntities.length })
      .where(eq(schema.Task.id, taskId))
  }

  /**
   * Permanently delete a task
   */
  async deleteTask(taskId: string, organizationId: string): Promise<void> {
    const result = await this.db
      .delete(schema.Task)
      .where(and(eq(schema.Task.id, taskId), eq(schema.Task.organizationId, organizationId)))

    if (result.rowCount === 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' })
    }
  }

  /**
   * List tasks with filtering and pagination
   */
  async listTasks(options: TaskFilterOptions): Promise<TaskListResponse> {
    const {
      organizationId,
      assigneeIds,
      createdById,
      priority,
      recordId,
      search,
      includeCompleted = false,
      includeArchived = false,
      deadlineFrom,
      deadlineTo,
      limit = 50,
      cursor,
    } = options

    // Build where conditions
    const conditions = [eq(schema.Task.organizationId, organizationId)]

    if (!includeArchived) {
      conditions.push(isNull(schema.Task.archivedAt))
    }

    if (!includeCompleted) {
      conditions.push(isNull(schema.Task.completedAt))
    }

    if (createdById) {
      conditions.push(eq(schema.Task.createdById, createdById))
    }

    if (priority && priority.length > 0) {
      conditions.push(inArray(schema.Task.priority, priority))
    }

    if (deadlineFrom) {
      conditions.push(gte(schema.Task.deadline, deadlineFrom))
    }

    if (deadlineTo) {
      conditions.push(lte(schema.Task.deadline, deadlineTo))
    }

    if (search) {
      conditions.push(ilike(schema.Task.searchText, `%${search}%`))
    }

    if (cursor) {
      conditions.push(lt(schema.Task.createdAt, new Date(cursor)))
    }

    // Query tasks
    const tasks = await this.db.query.Task.findMany({
      where: and(...conditions),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: limit + 1,
    })

    const hasMore = tasks.length > limit
    const resultTasks = hasMore ? tasks.slice(0, limit) : tasks

    // Filter by assignee if needed (requires a join)
    let filteredTasks = resultTasks
    if (assigneeIds && assigneeIds.length > 0) {
      const taskIds = resultTasks.map((t) => t.id)
      const assignments = await this.db.query.TaskAssignment.findMany({
        where: (a, { and, inArray, isNull }) =>
          and(
            inArray(a.taskId, taskIds),
            inArray(a.assignedToUserId, assigneeIds),
            isNull(a.unassignedAt)
          ),
      })
      const assignedTaskIds = new Set(assignments.map((a) => a.taskId))
      filteredTasks = resultTasks.filter((t) => assignedTaskIds.has(t.id))
    }

    // Filter by entity reference if needed
    if (recordId) {
      const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
      const taskIds = filteredTasks.map((t) => t.id)
      const references = await this.db.query.TaskReference.findMany({
        where: (r, { and, inArray, eq, isNull }) =>
          and(
            inArray(r.taskId, taskIds),
            eq(r.referencedEntityInstanceId, entityInstanceId),
            eq(r.referencedEntityDefinitionId, entityDefinitionId),
            isNull(r.deletedAt)
          ),
      })
      const referencedTaskIds = new Set(references.map((r) => r.taskId))
      filteredTasks = filteredTasks.filter((t) => referencedTaskIds.has(t.id))
    }

    // Load relations for each task
    const tasksWithRelations: TaskWithRelations[] = await Promise.all(
      filteredTasks.map(async (task) => {
        // Get assignments - only need user IDs to convert to ActorId
        const assignmentRows = await this.db.query.TaskAssignment.findMany({
          where: (a, { eq, and, isNull }) => and(eq(a.taskId, task.id), isNull(a.unassignedAt)),
          columns: { assignedToUserId: true },
        })

        // Convert to ActorId[]
        const assignments = assignmentRows.map((a) => toActorId('user', a.assignedToUserId))

        // Load only IDs
        const referenceRows = await this.db.query.TaskReference.findMany({
          where: (r, { eq, and, isNull }) => and(eq(r.taskId, task.id), isNull(r.deletedAt)),
          columns: {
            referencedEntityDefinitionId: true,
            referencedEntityInstanceId: true,
          },
        })

        // Convert to RecordId[]
        const references = referenceRows.map((ref) =>
          toRecordId(ref.referencedEntityDefinitionId, ref.referencedEntityInstanceId)
        )

        return {
          ...task,
          assignments,
          references,
        }
      })
    )

    const nextCursor = hasMore
      ? resultTasks[resultTasks.length - 1]?.createdAt?.toISOString()
      : undefined

    return {
      tasks: tasksWithRelations,
      nextCursor,
      hasMore,
      total: tasksWithRelations.length,
    }
  }

  /**
   * Get tasks grouped by deadline status
   */
  async getGroupedTasks(organizationId: string): Promise<GroupedTasksResponse> {
    const startOfToday = getStartOfToday()
    const endOfToday = getEndOfToday()
    const endOfWeek = getEndOfWeek()

    // Base conditions: not archived
    const baseConditions = [
      eq(schema.Task.organizationId, organizationId),
      isNull(schema.Task.archivedAt),
    ]

    // Today: deadline is today and not completed
    const todayTasks = await this.db.query.Task.findMany({
      where: (t, { and, gte, lte, isNull }) =>
        and(
          ...baseConditions,
          isNull(t.completedAt),
          gte(t.deadline, startOfToday),
          lte(t.deadline, endOfToday)
        ),
      orderBy: (t, { asc }) => [asc(t.deadline)],
    })

    // This week: deadline is after today but before end of week
    const thisWeekTasks = await this.db.query.Task.findMany({
      where: (t, { and, gt, lte, isNull }) =>
        and(
          ...baseConditions,
          isNull(t.completedAt),
          gt(t.deadline, endOfToday),
          lte(t.deadline, endOfWeek)
        ),
      orderBy: (t, { asc }) => [asc(t.deadline)],
    })

    // Upcoming: deadline is after this week
    const upcomingTasks = await this.db.query.Task.findMany({
      where: (t, { and, gt, isNull }) =>
        and(...baseConditions, isNull(t.completedAt), gt(t.deadline, endOfWeek)),
      orderBy: (t, { asc }) => [asc(t.deadline)],
      limit: 50,
    })

    // Overdue: deadline is before today and not completed
    const overdueTasks = await this.db.query.Task.findMany({
      where: (t, { and, lt, isNull, isNotNull }) =>
        and(
          ...baseConditions,
          isNull(t.completedAt),
          lt(t.deadline, startOfToday),
          isNotNull(t.deadline)
        ),
      orderBy: (t, { asc }) => [asc(t.deadline)],
    })

    // Completed: has completedAt
    const completedTasks = await this.db.query.Task.findMany({
      where: (t, { and, isNotNull }) => and(...baseConditions, isNotNull(t.completedAt)),
      orderBy: (t, { desc }) => [desc(t.completedAt)],
      limit: 50,
    })

    // Helper to load relations for tasks
    const loadRelations = async (tasks: TaskEntity[]): Promise<TaskWithRelations[]> => {
      return Promise.all(
        tasks.map(async (task) => {
          // Get assignments - only need user IDs to convert to ActorId
          const assignmentRows = await this.db.query.TaskAssignment.findMany({
            where: (a, { eq, and, isNull }) => and(eq(a.taskId, task.id), isNull(a.unassignedAt)),
            columns: { assignedToUserId: true },
          })

          // Convert to ActorId[]
          const assignments = assignmentRows.map((a) => toActorId('user', a.assignedToUserId))

          // Load only IDs
          const referenceRows = await this.db.query.TaskReference.findMany({
            where: (r, { eq, and, isNull }) => and(eq(r.taskId, task.id), isNull(r.deletedAt)),
            columns: {
              referencedEntityDefinitionId: true,
              referencedEntityInstanceId: true,
            },
          })

          // Convert to RecordId[]
          const references = referenceRows.map((ref) =>
            toRecordId(ref.referencedEntityDefinitionId, ref.referencedEntityInstanceId)
          )

          return {
            ...task,
            assignments,
            references,
          }
        })
      )
    }

    return {
      today: await loadRelations(todayTasks),
      thisWeek: await loadRelations(thisWeekTasks),
      upcoming: await loadRelations(upcomingTasks),
      overdue: await loadRelations(overdueTasks),
      completed: await loadRelations(completedTasks),
    }
  }
}

/**
 * Create a TaskService instance with the provided database
 */
export function createTaskService(db: Database): TaskService {
  return new TaskService(db)
}
