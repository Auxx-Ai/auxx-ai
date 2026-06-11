// packages/lib/src/ai/mcp/templates/__tests__/catalog.test.ts
//
// Sanity checks over the static catalog — pure data, no mocks.

import { describe, expect, it } from 'vitest'
import { mcpTemplateCategories, mcpTemplates } from '../catalog'

describe('mcpTemplates catalog', () => {
  it('has unique, slug-shaped ids', () => {
    const ids = mcpTemplates.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('keeps the originally-seeded slugs stable', () => {
    // These predate the catalog (seeded rows exist in prod) — the upsert must match them in place.
    const ids = new Set(mcpTemplates.map((t) => t.id))
    expect(ids.has('linear')).toBe(true)
    expect(ids.has('notion')).toBe(true)
    expect(ids.has('shopify')).toBe(true)
  })

  it('only uses declared categories', () => {
    const known = new Set(mcpTemplateCategories.map((c) => c.value))
    for (const t of mcpTemplates) {
      expect(t.categories.length).toBeGreaterThan(0)
      for (const c of t.categories) expect(known.has(c)).toBe(true)
    }
  })

  it('has https endpoints that parse as URLs (placeholders substituted)', () => {
    for (const t of mcpTemplates) {
      const resolved = t.endpoint.replace(/\{[^}]+\}/g, 'placeholder')
      const url = new URL(resolved)
      expect(url.protocol).toBe('https:')
    }
  })

  it('declares a connection variable for every endpoint placeholder', () => {
    for (const t of mcpTemplates) {
      const placeholders = t.endpoint.match(/\{([^}]+)\}/g)?.map((m) => m.slice(1, -1)) ?? []
      const declared = new Set((t.connectionVariables ?? []).map((v) => v.key))
      for (const p of placeholders) expect(declared.has(p)).toBe(true)
    }
  })
})
