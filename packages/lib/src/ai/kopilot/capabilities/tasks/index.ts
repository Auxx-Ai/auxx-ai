// packages/lib/src/ai/kopilot/capabilities/tasks/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import { createCreateTaskTool } from './tools/create-task'
import { createListTasksTool } from './tools/list-tasks'

export function createTaskCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: '__global__',
    tools: [createListTasksTool(getDeps), createCreateTaskTool(getDeps)],
    systemPromptAddition:
      'You can create and search tasks. Tasks have a title, optional description, deadline (natural language like "next Friday", "in 3 days", "end of week"), priority (low/medium/high), and can be assigned to users or groups. Before creating a task: use list_members to find assignee IDs for specific people, and use search_entities to find linkedRecordIds for any referenced entities (e.g. products, orders, contacts mentioned in the task).',
    capabilities: ['Create and search tasks'],
  }
}
