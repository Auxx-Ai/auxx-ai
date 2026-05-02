// packages/lib/src/ai/kopilot/capabilities/tasks/tools/create-task.ts

import { toActorId } from '@auxx/types/actor'
import type { AbsoluteDate, RelativeDate } from '@auxx/types/task'
import { createTaskService } from '../../../../../tasks/task-service'
import {
  getKnownDefIds,
  normalizeActorIdArrayArg,
  normalizeRecordIdArrayArg,
  parseDeadlineArg,
  parseStringArg,
} from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { CreateTaskDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'

export function createCreateTaskTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'create_task',
    description:
      'Create a new task. Resolving names: try list_members first for the assignee — assignees are workspace members (teammates), not contacts. If the name does not match any member, fall back to search_entities — the person is likely a contact (or the subject is a company/record). Pass the matched recordId to linkedRecordIds and leave assigneeIds empty so the task is assigned to the caller. Use search_entities for any other referenced records (products, orders, etc.). Supports natural language deadlines like "next Friday", "in 3 days", "end of week".',
    requiresApproval: true,
    outputDigestSchema: CreateTaskDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as {
        taskId?: string
        title?: string
        deadline?: string | null
        assignees?: string[]
      }
      return {
        taskId: String(out.taskId ?? ''),
        title: typeof out.title === 'string' ? out.title : '',
        deadline: out.deadline ?? undefined,
        assignees: Array.isArray(out.assignees) ? out.assignees : undefined,
      }
    },
    summary: (args) => {
      const title = typeof args.title === 'string' ? args.title : 'task'
      return `Create task: "${title.slice(0, 60)}"`
    },
    captureMint: (args, ctx) => ({
      taskId: `temp_${ctx.localIndex}`,
      title: typeof args.title === 'string' ? args.title : '',
      // deadline is canonicalized to AbsoluteDate | RelativeDate by validateInputs;
      // for capture-mode preview we just show the original phrasing if still a string.
      deadline: typeof args.deadline === 'string' ? args.deadline : args.deadline ? 'parsed' : null,
      priority: (args.priority as string | undefined) ?? null,
      assignees: (args.assigneeIds as string[] | undefined) ?? [],
    }),
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Task title',
        },
        description: {
          type: 'string',
          description: 'Task description',
        },
        deadline: {
          type: 'string',
          description:
            'Natural language deadline (e.g., "next Friday", "in 3 days", "end of month")',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Task priority',
        },
        assigneeIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Workspace member or group actorIds (e.g., "user:abc", "group:xyz"). Defaults to the caller. NOT for contacts — contacts go in linkedRecordIds.',
        },
        linkedRecordIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Entity record references to link',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
    validateInputs: async (args, ctx) => {
      const known = await getKnownDefIds(ctx.organizationId)

      const title = parseStringArg(args.title, { name: 'title', required: true, max: 500 })
      if (!title.ok) return { ok: false, error: title.error }

      const description = parseStringArg(args.description, { name: 'description', max: 10000 })
      if (!description.ok) return { ok: false, error: description.error }

      const deadline = parseDeadlineArg(args.deadline)
      if (!deadline.ok) return { ok: false, error: deadline.error }

      const linked =
        args.linkedRecordIds === undefined
          ? { ok: true as const, value: undefined as undefined }
          : normalizeRecordIdArrayArg(args.linkedRecordIds, {
              knownDefIds: known,
              argName: 'linkedRecordIds',
            })
      if (!linked.ok) return { ok: false, error: linked.error }

      const assignees =
        args.assigneeIds === undefined
          ? { ok: true as const, value: undefined as undefined }
          : normalizeActorIdArrayArg(args.assigneeIds, {
              defaultKind: 'user',
              argName: 'assigneeIds',
            })
      if (!assignees.ok) return { ok: false, error: assignees.error }

      const priority = args.priority
      if (
        priority !== undefined &&
        priority !== 'low' &&
        priority !== 'medium' &&
        priority !== 'high'
      ) {
        return {
          ok: false,
          error: `priority must be 'low' | 'medium' | 'high'; got ${JSON.stringify(priority)}.`,
        }
      }

      return {
        ok: true,
        args: {
          title: title.value,
          description: description.value,
          deadline: deadline.value,
          priority,
          assigneeIds: assignees.value,
          linkedRecordIds: linked.value,
        },
        warnings: [
          ...('warnings' in linked && linked.warnings ? linked.warnings : []),
          ...('warnings' in assignees && assignees.warnings ? assignees.warnings : []),
        ],
      }
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const title = args.title as string
      const description = args.description as string | undefined
      const deadline = args.deadline as AbsoluteDate | RelativeDate | undefined
      const priority = args.priority as 'low' | 'medium' | 'high' | undefined
      const assigneeIds = (args.assigneeIds as string[] | undefined) ?? [
        toActorId('user', agentDeps.userId),
      ]
      const linkedRecordIds = args.linkedRecordIds as string[] | undefined

      const taskService = createTaskService(db)
      const task = await taskService.createTask(
        {
          title,
          description,
          deadline,
          priority,
          assigneeActorIds: assigneeIds,
          referencedEntities: linkedRecordIds,
        },
        agentDeps.organizationId,
        agentDeps.userId
      )

      return {
        success: true,
        output: {
          taskId: task.id,
          title: task.title,
          deadline: task.deadline?.toISOString() ?? null,
          priority: task.priority,
          assignees: assigneeIds,
        },
      }
    },
  }
}
