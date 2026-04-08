// packages/lib/src/ai/kopilot/capabilities/tasks/tools/create-task.ts

import { toActorId } from '@auxx/types/actor'
import type { AbsoluteDate, RelativeDate } from '@auxx/types/task'
import { DateLanguageModule } from '../../../../../tasks/date-language-module'
import { createTaskService } from '../../../../../tasks/task-service'
import { TextDateParser } from '../../../../../tasks/text-date-parser'
import type { CreateTaskInput } from '../../../../../tasks/types'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

export function createCreateTaskTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'create_task',
    description:
      'Create a new task. Requires user approval. Before calling: use list_members to find user IDs for assignment, and use search_entities to find linkedRecordIds for any referenced entities (products, orders, contacts, etc.). Supports natural language deadlines like "next Friday", "in 3 days", "end of week".',
    requiresApproval: true,
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
          description: 'ActorId format (e.g., "user:abc"). Defaults to current user.',
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
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const title = args.title as string
      const description = args.description as string | undefined
      const deadlineText = args.deadline as string | undefined
      const priority = args.priority as 'low' | 'medium' | 'high' | undefined
      const assigneeIds = (args.assigneeIds as string[] | undefined) ?? [
        toActorId('user', agentDeps.userId),
      ]
      const linkedRecordIds = args.linkedRecordIds as string[] | undefined

      // Parse deadline from natural language
      let deadline: CreateTaskInput['deadline']
      if (deadlineText) {
        const parser = new TextDateParser()
        const result = parser.parse(deadlineText)

        if (!result.found || !result.duration) {
          return {
            success: false,
            output: null,
            error:
              'Could not parse deadline. Try a format like "next Friday", "in 3 days", or "end of month".',
          }
        }

        // Handle special string durations (eom, next-quarter) by resolving to absolute date
        if (typeof result.duration === 'string') {
          const dateModule = new DateLanguageModule()
          const resolved = dateModule.calculateTargetDate(result.duration)
          deadline = { type: 'static', value: resolved } satisfies AbsoluteDate
        } else {
          deadline = result.duration satisfies RelativeDate
        }
      }

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
