// packages/lib/src/agents/__tests__/builtin-installed-row.test.ts

import { describe, expect, it } from 'vitest'
import { BUILTIN_TOOLSETS } from '../builtin-app'
import { getBuiltinAuxxInstalledRow } from '../builtin-installed-row'

describe('getBuiltinAuxxInstalledRow — enriched tool projection', () => {
  const tools = getBuiltinAuxxInstalledRow().agentTools ?? []

  it('projects at least one tool', () => {
    expect(tools.length).toBeGreaterThan(0)
  })

  it('stamps a category on every tool, and never control (no toolsetSlug ⇒ excluded)', () => {
    for (const tool of tools) {
      expect(['capability', 'system']).toContain(tool.category)
    }
  })

  it('defaults idempotent to a boolean', () => {
    for (const tool of tools) {
      expect(typeof tool.idempotent).toBe('boolean')
    }
  })

  it('serializes declared output schemas to JSON Schema instead of stripping them', () => {
    // Native tools with a Zod `outputSchema` must no longer cache `{}` — the
    // eval editor scaffolds from this field client-side.
    const withSchema = tools.filter((t) => Object.keys(t.outputsJsonSchema).length > 0)
    expect(withSchema.length).toBeGreaterThan(0)
    for (const tool of withSchema) {
      // The serializer strips the meta keys the LLM/editor never needs.
      expect(tool.outputsJsonSchema.$schema).toBeUndefined()
      expect(tool.outputsJsonSchema.id).toBeUndefined()
    }
  })

  it('every projected tool references a declared toolset (filterToolsByToolsets drops unknown slugs)', () => {
    const knownSlugs = new Set(BUILTIN_TOOLSETS.map((ts) => ts.slug))
    for (const tool of tools) {
      expect(knownSlugs, `toolset for ${tool.registeredName}`).toContain(tool.toolsetSlug)
    }
  })

  it('carries exampleOutput verbatim (find_threads declares one)', () => {
    // `find_threads` declares an exampleOutput at its definition site — the
    // projection must copy it (it was dropped entirely before this plan).
    const findThreads = tools.find((t) => t.registeredName === 'find_threads')
    expect(findThreads).toBeDefined()
    expect(findThreads?.exampleOutput).toBeDefined()
    expect(Object.keys(findThreads?.outputsJsonSchema ?? {}).length).toBeGreaterThan(0)
  })
})
