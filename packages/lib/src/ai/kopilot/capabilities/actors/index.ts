// packages/lib/src/ai/kopilot/capabilities/actors/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import { createListGroupsTool } from './tools/list-groups'
import { createListMembersTool } from './tools/list-members'

export function createActorCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: '__global__',
    tools: [createListMembersTool(getDeps), createListGroupsTool(getDeps)],
    systemPromptAddition:
      "You can look up workspace members (teammates who use Auxx) and groups. Use list_members to find a member's actorId for task assignment, thread assignment, ACTOR-typed fields, etc. Use list_groups to find a group's actorId. Members and groups are NOT the same as contacts — contacts are CRM entity records (search_entities).",
    capabilities: ['List workspace members and teams'],
  }
}
