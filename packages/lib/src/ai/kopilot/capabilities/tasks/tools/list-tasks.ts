// packages/lib/src/ai/kopilot/capabilities/tasks/tools/list-tasks.ts

import { z } from 'zod'
import { createTaskService } from '../../../../../tasks/task-service'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { takeSample } from '../../../digests'
import type { GetToolDeps } from '../../types'

/** Full success output of `list_tasks` — matched tasks with a count. */
const ListTasksOutput = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      deadline: z.string().nullable(),
      priority: z.string().nullable(),
      completedAt: z.string().nullable(),
      assignees: z.array(z.string()),
      referenceCount: z.number(),
    })
  ),
  count: z.number(),
  hasMore: z.boolean(),
})

export function createListTasksTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_tasks',
    permission: {
      target: 'unmodeled',
      domain: 'tasks',
      level: 'view',
      enforcement: 'unenforced',
      note: 'KNOWN GAP (19b G7). Defaults to ALL org tasks with no check. Tasks are neither an entity definition (no `Task` resource in the registry — the rows live in their own table, not EntityInstance) nor an Area, so there is literally nothing to assert against. Deliberately left org-wide rather than scoped to the caller: `task.list` is `protectedProcedure` and equally org-wide, and `agentDeps.userId` is the agent’s own engine identity on autonomous runs, so a caller-scope default would return an empty list for every agent while silently breaking "show me all open tasks" for interactive Kopilot. It IS bounded (limit 10, max 25), so this is disclosure, not a dump. Needs a `tasks` area to close.',
    },
    displayName: 'List tasks',
    toolsetSlug: 'auxx:tasks:read',
    idempotent: true,
    outputSchema: ListTasksOutput,
    exampleOutput: {
      tasks: [
        {
          id: 'task_5Wm8Lq',
          title: 'Follow up on order #1042 refund',
          deadline: '2026-06-13T17:00:00.000Z',
          priority: 'high',
          completedAt: null,
          assignees: ['user:7Hd2aK'],
          referenceCount: 1,
        },
        {
          id: 'task_2Bn4Xr',
          title: 'Review weekly support backlog',
          deadline: null,
          priority: 'medium',
          completedAt: null,
          assignees: ['group:supp7Hd2'],
          referenceCount: 0,
        },
      ],
      count: 2,
      hasMore: false,
    } satisfies z.output<typeof ListTasksOutput>,
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
