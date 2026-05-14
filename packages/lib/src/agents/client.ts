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
  group: 'native' | 'app'
  appId?: string
  isDefault: boolean
  tools: ToolCatalogEntry[]
}
