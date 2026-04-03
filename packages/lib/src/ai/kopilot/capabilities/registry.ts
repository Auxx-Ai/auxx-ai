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
      const globalTools = pages.get('__global__')?.tools ?? []
      const pageTools = pages.get(page)?.tools ?? []
      return [...globalTools, ...pageTools]
    },

    getPages(): string[] {
      return [...pages.keys()]
    },

    getSystemPromptAddition(page: string): string | undefined {
      const globalAddition = pages.get('__global__')?.systemPromptAddition
      const pageAddition = pages.get(page)?.systemPromptAddition
      if (globalAddition && pageAddition) return `${globalAddition}\n\n${pageAddition}`
      return globalAddition ?? pageAddition
    },

    register(capability: PageCapability): void {
      pages.set(capability.page, capability)
    },
  }
}
