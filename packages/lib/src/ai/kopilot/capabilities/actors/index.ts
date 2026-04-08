// packages/lib/src/ai/kopilot/capabilities/actors/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import { createListGroupsTool } from './tools/list-groups'
import { createListMembersTool } from './tools/list-members'

export function createActorCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: '__global__',
    tools: [createListMembersTool(getDeps), createListGroupsTool(getDeps)],
    systemPromptAddition:
      'You can look up organization members and groups. Use list_members to find user IDs (needed for task assignment, thread assignment, etc.). Use list_groups to find group IDs.',
  }
}
