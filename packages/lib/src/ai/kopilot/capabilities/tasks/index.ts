// packages/lib/src/ai/kopilot/capabilities/tasks/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import { createCreateTaskTool } from './tools/create-task'
import { createListTasksTool } from './tools/list-tasks'

export function createTaskCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: '__global__',
    tools: [createListTasksTool(getDeps), createCreateTaskTool(getDeps)],
    systemPromptAddition:
      'You can create and search tasks. Tasks have a title, optional description, deadline (natural language like "next Friday", "in 3 days", "end of week"), priority (low/medium/high), and can be assigned to users or groups. Resolving names for a task: (1) call list_members first to find assignee IDs for workspace members, (2) if a name does not match any member, call search_entities — the person is likely a contact (or the subject is a company/order/etc.). When search_entities returns a match, pass its recordId to linkedRecordIds and leave assigneeIds empty so the task is assigned to the current user. Only ask the user to clarify if both list_members and search_entities come back empty. Always use search_entities for any other referenced records mentioned in the task (products, orders, etc.).',
    capabilities: ['Create and search tasks'],
  }
}
