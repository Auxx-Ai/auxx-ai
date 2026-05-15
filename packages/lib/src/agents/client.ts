// packages/lib/src/agents/client.ts

/**
 * Client-safe exports from `@auxx/lib/agents`. The barrel `index.ts` pulls
 * in server-only deps (DB, capabilities); this subpath is what client
 * components should import from.
 */

export type AgentScopeMode = 'include_descendants' | 'include_one' | 'exclude'

export interface ToolCatalogEntry {
  name: string
  description: string
}

export interface ToolsetCatalogEntry {
  slug: string
  label: string
  shortLabel: string
  group: 'native' | 'app'
  parentGroup: string
  iconId: string
  color: string
  appId?: string
  isDefault: boolean
  tools: ToolCatalogEntry[]
}

export interface ToolsetGroupCatalog {
  name: string
  iconId: string
  color: string
}

/**
 * Display metadata for native parent groups, mirrored from
 * `toolset-catalog.ts` so the client can render group headers without a
 * server round-trip.
 */
export const NATIVE_GROUP_CATALOG: Record<string, ToolsetGroupCatalog> = {
  Mail: { name: 'Mail', iconId: 'mail', color: 'blue' },
  Tasks: { name: 'Tasks', iconId: 'check-circle', color: 'green' },
  Entities: { name: 'Entities', iconId: 'boxes', color: 'purple' },
  Knowledge: { name: 'Knowledge', iconId: 'book-open', color: 'orange' },
  Docs: { name: 'Docs', iconId: 'help-circle', color: 'gray' },
  Members: { name: 'Members', iconId: 'users', color: 'pink' },
}

export { getTriggerLabel } from './agent-trigger-label'
export { AGENT_SLUG_MAX, AGENT_SLUG_REGEX, agentSlugSchema } from './slug-schema'

export const ALLOWED_DIRECT_EVENT_TYPES = [
  'ticket:assignee:added',
  'ticket:assignee:removed',
  'ticket:status:changed',
  'ticket:reply:created',
] as const
export type AllowedDirectEventType = (typeof ALLOWED_DIRECT_EVENT_TYPES)[number]
