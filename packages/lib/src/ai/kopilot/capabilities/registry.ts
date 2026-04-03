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

    register(capability: PageCapability): void {
      pages.set(capability.page, capability)
    },
  }
}
