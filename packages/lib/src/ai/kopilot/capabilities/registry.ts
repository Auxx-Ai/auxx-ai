// packages/lib/src/ai/kopilot/capabilities/registry.ts

import type { AgentToolDefinition } from '../../agent-framework/types'
import type { CapabilityRegistry, PageCapability } from './types'

/**
 * Create a capability registry that maps pages to their tool sets.
 * Simple Map-based implementation — no class.
 */
export function createCapabilityRegistry(): CapabilityRegistry {
  const pages = new Map<string, PageCapability>()

  return {
    getTools(_page: string): AgentToolDefinition[] {
      const allTools: AgentToolDefinition[] = []
      for (const capability of pages.values()) {
        allTools.push(...capability.tools)
      }
      return allTools
    },

    getPages(): string[] {
      return [...pages.keys()]
    },

    getSystemPromptAddition(_page: string): string | undefined {
      const additions: string[] = []
      for (const capability of pages.values()) {
        if (capability.systemPromptAddition) additions.push(capability.systemPromptAddition)
      }
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
        // Merge tools and system prompt additions for the same page key
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
