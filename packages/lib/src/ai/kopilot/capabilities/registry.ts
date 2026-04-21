// packages/lib/src/ai/kopilot/capabilities/registry.ts

import type { AgentToolDefinition } from '../../agent-framework/types'
import type { CapabilityRegistry, PageCapability } from './types'

/** Registration key meaning "applies to every page". */
const GLOBAL_PAGE = '__global__'

/**
 * Create a capability registry that maps pages to their tool sets.
 *
 * Tool resolution is page-scoped:
 *   getTools(page) → tools from the capability registered under that page key
 *                    + tools from the `__global__` capability (if any).
 *
 * An unknown page falls back to global tools only — we do NOT return every
 * capability's tools, because that would leak mail tools onto a contacts page,
 * spend context on irrelevant tool descriptions, and violate F20.
 */
export function createCapabilityRegistry(): CapabilityRegistry {
  const pages = new Map<string, PageCapability>()

  return {
    getTools(page: string): AgentToolDefinition[] {
      const collected: AgentToolDefinition[] = []
      const global = pages.get(GLOBAL_PAGE)
      if (global) collected.push(...global.tools)
      const scoped = pages.get(page)
      if (scoped) collected.push(...scoped.tools)
      // Dedupe by name — page-scoped wins when a name clashes with a global one
      const byName = new Map<string, AgentToolDefinition>()
      for (const tool of collected) byName.set(tool.name, tool)
      return [...byName.values()]
    },

    getPages(): string[] {
      return [...pages.keys()]
    },

    getSystemPromptAddition(page: string): string | undefined {
      const additions: string[] = []
      const global = pages.get(GLOBAL_PAGE)
      if (global?.systemPromptAddition) additions.push(global.systemPromptAddition)
      const scoped = pages.get(page)
      if (scoped?.systemPromptAddition) additions.push(scoped.systemPromptAddition)
      return additions.length > 0 ? additions.join('\n\n') : undefined
    },

    getCapabilitiesSummary(): string[] {
      const all: string[] = []
      for (const capability of pages.values()) {
        if (capability.capabilities) all.push(...capability.capabilities)
      }
      return all
    },

    register(capability: PageCapability): void {
      const existing = pages.get(capability.page)
      if (existing) {
        existing.tools.push(...capability.tools)
        if (capability.systemPromptAddition) {
          existing.systemPromptAddition = existing.systemPromptAddition
            ? `${existing.systemPromptAddition}\n\n${capability.systemPromptAddition}`
            : capability.systemPromptAddition
        }
        if (capability.capabilities) {
          existing.capabilities = [...(existing.capabilities ?? []), ...capability.capabilities]
        }
      } else {
        pages.set(capability.page, { ...capability })
      }
    },
  }
}
