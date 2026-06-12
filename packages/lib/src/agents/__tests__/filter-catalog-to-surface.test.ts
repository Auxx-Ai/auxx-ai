// packages/lib/src/agents/__tests__/filter-catalog-to-surface.test.ts

import { describe, expect, it } from 'vitest'
import type { CatalogNode, CatalogToolsetNode } from '../client'
import { filterCatalogToSurface, toolEntryToNode } from '../client'

function toolset(
  slug: string,
  label: string,
  tools: Array<Parameters<typeof toolEntryToNode>[0]>
): CatalogToolsetNode {
  return {
    kind: 'toolset',
    id: slug,
    slug,
    label,
    fullLabel: label,
    description: '',
    iconId: null,
    color: null,
    isDefault: false,
    isPopular: false,
    implicit: false,
    children: tools.map((t) => toolEntryToNode(t, slug)),
  }
}

/** Minimal app → toolset tree with three tools of varying `surfaces`/`externalSafe`. */
function fixture(): CatalogNode[] {
  return [
    {
      kind: 'app',
      id: 'app:auxx',
      label: 'Auxx.ai',
      iconId: 'package',
      color: null,
      isBuiltin: true,
      children: [
        toolset('auxx:entities:search', 'Search', [
          // default surfaces (absent ⇒ all), not externalSafe
          { name: 'search_entities', displayName: 'Search records', description: '' },
          // schema read, externalSafe
          {
            name: 'list_entities',
            displayName: 'List entity types',
            description: '',
            externalSafe: true,
          },
        ]),
        toolset('auxx:builder', 'Builder', [
          {
            name: 'set_agent_prompt',
            displayName: 'Set prompt',
            description: '',
            surfaces: ['builder'],
          },
        ]),
      ],
    },
  ]
}

describe('filterCatalogToSurface', () => {
  it('keeps default-surface tools and drops surface-narrowed ones for chat', () => {
    const out = filterCatalogToSurface(fixture(), 'chat')
    const slugs = collectToolsetSlugs(out)
    // The builder-only toolset has zero chat tools → dropped entirely.
    expect(slugs).toEqual(['auxx:entities:search'])
    const tools = toolNames(out, 'auxx:entities:search')
    expect(tools).toEqual(['search_entities', 'list_entities'])
  })

  it('preserves externalSafe on surviving tools', () => {
    const out = filterCatalogToSurface(fixture(), 'chat')
    const search = findTool(out, 'search_entities')
    const list = findTool(out, 'list_entities')
    expect(search?.externalSafe).toBeUndefined()
    expect(list?.externalSafe).toBe(true)
  })

  it('keeps the builder-only tool for the builder surface (alongside default-all reads)', () => {
    const out = filterCatalogToSurface(fixture(), 'builder')
    // Default-all reads are offered on every surface; the builder tool also
    // survives here (page-gate, not `surfaces`, isolates the builder session).
    expect(collectToolsetSlugs(out)).toEqual(['auxx:entities:search', 'auxx:builder'])
    expect(toolNames(out, 'auxx:builder')).toEqual(['set_agent_prompt'])
  })
})

function collectToolsetSlugs(nodes: CatalogNode[]): string[] {
  const out: string[] = []
  const walk = (n: CatalogNode) => {
    if (n.kind === 'tool') return
    if (n.kind === 'toolset') out.push(n.slug)
    else n.children.forEach(walk)
  }
  nodes.forEach(walk)
  return out
}

function toolNames(nodes: CatalogNode[], slug: string): string[] {
  const out: string[] = []
  const walk = (n: CatalogNode) => {
    if (n.kind === 'tool') return
    if (n.kind === 'toolset') {
      if (n.slug === slug) out.push(...n.children.map((t) => t.name))
    } else n.children.forEach(walk)
  }
  nodes.forEach(walk)
  return out
}

function findTool(nodes: CatalogNode[], name: string) {
  let found: { name: string; externalSafe?: boolean } | undefined
  const walk = (n: CatalogNode) => {
    if (n.kind === 'tool') return
    if (n.kind === 'toolset') {
      const t = n.children.find((x) => x.name === name)
      if (t) found = t
    } else n.children.forEach(walk)
  }
  nodes.forEach(walk)
  return found
}
