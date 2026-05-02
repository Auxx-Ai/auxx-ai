// packages/lib/src/ai/kopilot/capabilities/tasks/tools/list-tasks.ts

import { createTaskService } from '../../../../../tasks/task-service'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { ListTasksDigest, takeSample } from '../../../digests'
import type { GetToolDeps } from '../../types'

export function createListTasksTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_tasks',
    idempotent: true,
    outputDigestSchema: ListTasksDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as {
        tasks?: Array<{
          id?: string
          title?: string
          deadline?: string | null
          completedAt?: string | null
        }>
        count?: number
      }
      const tasks = Array.isArray(out.tasks) ? out.tasks : []
      return {
        count: typeof out.count === 'number' ? out.count : tasks.length,
        sample: takeSample(tasks).map((t) => ({
          taskId: String(t.id ?? ''),
          title: typeof t.title === 'string' ? t.title : '',
          deadline: t.deadline ?? undefined,
          completedAt: t.completedAt ?? undefined,
        })),
      }
    },
    description:
      'Search and filter tasks. Returns all organization tasks by default. Use assigneeId to filter by a specific workspace member or group (actorId).',
    parameters: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Free-text search on title and description',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Filter by priority',
        },
        assigneeId: {
          type: 'string',
          description:
            'Filter by a specific workspace member or group actorId (use list_members / list_groups to find actorIds).',
        },
        includeCompleted: {
          type: 'boolean',
          description: 'Include completed tasks (default: false)',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 10, max: 25)',
        },
      },
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const search = args.search as string | undefined
      const priority = args.priority as 'low' | 'medium' | 'high' | undefined
      const assigneeId = args.assigneeId as string | undefined
      const includeCompleted = (args.includeCompleted as boolean) ?? false
      const limit = Math.min((args.limit as number) ?? 10, 25)

      // Only filter by assignee when explicitly requested via assigneeId.
      // By default, show all org tasks (matches the tasks page UI).
      const assigneeIds = assigneeId ? [assigneeId] : undefined

      const taskService = createTaskService(db)
      const result = await taskService.listTasks({
        organizationId: agentDeps.organizationId,
        assigneeIds,
        search,
        priority: priority ? [priority] : undefined,
        includeCompleted,
        limit,
      })

      const tasks = result.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        deadline: task.deadline?.toISOString() ?? null,
        priority: task.priority ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
        assignees: task.assignments,
        referenceCount: task.references.length,
      }))

      return {
        success: true,
        output: { tasks, count: tasks.length, hasMore: result.hasMore },
      }
    },
  }
}
