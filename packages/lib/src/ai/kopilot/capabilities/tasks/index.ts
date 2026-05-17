// packages/lib/src/ai/kopilot/capabilities/tasks/index.ts

import type { GetToolDeps, PageCapability, SystemPromptAdditionContext } from '../types'
import { createCreateTaskTool } from './tools/create-task'
import { createListTasksTool } from './tools/list-tasks'

export function createTaskCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: '__global__',
    tools: [createListTasksTool(getDeps), createCreateTaskTool(getDeps)],
    systemPromptAddition: (ctx) => buildTaskPrompt(ctx),
    capabilities: ({ toolNames }) => {
      const hasCreate = toolNames.has('create_task')
      const hasList = toolNames.has('list_tasks')
      if (hasCreate && hasList) return ['Create and search tasks']
      if (hasCreate) return ['Create tasks']
      if (hasList) return ['Search tasks']
      return []
    },
  }
}

function buildTaskPrompt({ toolNames }: SystemPromptAdditionContext): string {
  const hasCreate = toolNames.has('create_task')
  const hasList = toolNames.has('list_tasks')
  if (!hasCreate && !hasList) return ''
  if (hasCreate) {
    return 'You can create and search tasks. Tasks have a title, optional description, deadline (natural language like "next Friday", "in 3 days", "end of week"), priority (low/medium/high), and can be assigned to workspace members or groups (NOT to contacts — contacts go in linkedRecordIds). Resolving names for a task: (1) call list_members first to find assignee actorIds for workspace members, (2) if a name does not match any member, call search_entities — the person is likely a contact (or the subject is a company/order/etc.). When search_entities returns a match, pass its recordId to linkedRecordIds and leave assigneeIds empty so the task is assigned to the caller. Only ask the caller to clarify if both list_members and search_entities come back empty. Always use search_entities for any other referenced records mentioned in the task (products, orders, etc.).'
  }
  // list-only fallback (rare configuration)
  return 'You can search existing tasks via `list_tasks`. Tasks are assigned to workspace members or groups, with optional linkedRecordIds for related contacts/companies/orders.'
}
