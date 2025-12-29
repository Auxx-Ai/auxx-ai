// packages/sdk/src/root/workflow/values/mock-context.ts

import type { TransformationContext } from './types.js'

/**
 * Mock transformation context for testing
 */
export function createMockTransformationContext(): TransformationContext {
  const mockRules = new Map([
    [
      'auto-reply-rule',
      {
        id: 'rule-uuid-123',
        slug: 'auto-reply-rule',
        name: 'Auto Reply Rule',
        conditions: [],
      },
    ],
  ])

  return {
    getRuleBySlug: async (slug: string) => {
      const rule = mockRules.get(slug)
      if (!rule) throw new Error(`Rule not found: ${slug}`)
      return { id: rule.id, slug: rule.slug }
    },

    getRuleById: async (id: string) => {
      for (const rule of mockRules.values()) {
        if (rule.id === id) return { id: rule.id, slug: rule.slug }
      }
      throw new Error(`Rule not found: ${id}`)
    },

    loadRule: async (id: string) => {
      for (const rule of mockRules.values()) {
        if (rule.id === id) return rule
      }
      throw new Error(`Rule not found: ${id}`)
    },
  }
}
