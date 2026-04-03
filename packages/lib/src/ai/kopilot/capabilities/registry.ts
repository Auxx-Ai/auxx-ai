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
    getTools(page: string): AgentToolDefinition[] {
      return pages.get(page)?.tools ?? []
    },

    getPages(): string[] {
      return [...pages.keys()]
    },

    getSystemPromptAddition(page: string): string | undefined {
      return pages.get(page)?.systemPromptAddition
    },

    register(capability: PageCapability): void {
      pages.set(capability.page, capability)
    },
  }
}
