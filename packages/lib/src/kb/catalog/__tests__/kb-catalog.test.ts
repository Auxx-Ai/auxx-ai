// packages/lib/src/kb/catalog/__tests__/kb-catalog.test.ts

import { describe, expect, it } from 'vitest'
import { buildKbCatalog, type KbCatalogSourceRow } from '../kb-catalog'
import { renderKbCatalog } from '../render-kb-catalog'

const kb = (id: string, over: Partial<Parameters<typeof buildKbCatalog>[0][number]> = {}) => ({
  id,
  name: `KB ${id}`,
  description: null,
  kind: 'standard',
  visibility: 'PUBLIC',
  ...over,
})

const row = (over: Partial<KbCatalogSourceRow> & Pick<KbCatalogSourceRow, 'placementId'>) => ({
  parentPlacementId: null,
  sortOrder: 'a0',
  knowledgeBaseId: 'kb1',
  articleId: `art-${over.placementId}`,
  articleKind: 'page',
  aiEnabled: true,
  archived: false,
  isPublished: true,
  title: `Title ${over.placementId}`,
  description: null,
  excerpt: null,
  ...over,
})

describe('buildKbCatalog', () => {
  it('builds a depth-first tree ordered by sortOrder', () => {
    const rows = [
      row({ placementId: 'p2', sortOrder: 'a2' }),
      row({ placementId: 'p1', sortOrder: 'a1' }),
      row({ placementId: 'p1a', parentPlacementId: 'p1', sortOrder: 'a0' }),
    ]
    const [entry] = buildKbCatalog([kb('kb1')], rows)
    expect(entry.articles.map((a) => [a.id, a.depth])).toEqual([
      ['art-p1', 0],
      ['art-p1a', 1],
      ['art-p2', 0],
    ])
  })

  it('excludes link/archived/aiDisabled nodes but promotes their children', () => {
    const rows = [
      row({ placementId: 'link', articleKind: 'link' }),
      row({ placementId: 'off', aiEnabled: false, sortOrder: 'a1' }),
      row({ placementId: 'child', parentPlacementId: 'off', sortOrder: 'a0' }),
      row({ placementId: 'gone', archived: true, sortOrder: 'a2' }),
    ]
    const [entry] = buildKbCatalog([kb('kb1')], rows)
    expect(entry.articles.map((a) => [a.id, a.depth])).toEqual([['art-child', 0]])
  })

  it('drops container nodes with no included descendants', () => {
    const rows = [
      row({ placementId: 'cat', articleKind: 'category' }),
      row({ placementId: 'full', articleKind: 'category', sortOrder: 'a1' }),
      row({ placementId: 'page', parentPlacementId: 'full', sortOrder: 'a0' }),
    ]
    const [entry] = buildKbCatalog([kb('kb1')], rows)
    expect(entry.articles.map((a) => a.id)).toEqual(['art-full', 'art-page'])
  })

  it('keeps orphans whose parent placement is not in the row set', () => {
    const rows = [row({ placementId: 'lost', parentPlacementId: 'unpublished-parent' })]
    const [entry] = buildKbCatalog([kb('kb1')], rows)
    expect(entry.articles.map((a) => [a.id, a.depth])).toEqual([['art-lost', 0]])
  })

  it('gates on isPublished for standard KBs but not for source KBs', () => {
    const rows = [
      row({ placementId: 'draft', isPublished: false }),
      row({ placementId: 'live', sortOrder: 'a1' }),
    ]
    const [standard] = buildKbCatalog([kb('kb1')], rows)
    expect(standard.articles.map((a) => a.id)).toEqual(['art-live'])
    const [source] = buildKbCatalog([kb('kb1', { kind: 'source' })], rows)
    expect(source.articles.map((a) => a.id)).toEqual(['art-draft', 'art-live'])
  })

  it('falls back to excerpt when description is empty', () => {
    const rows = [row({ placementId: 'p1', description: '  ', excerpt: 'From the excerpt' })]
    const [entry] = buildKbCatalog([kb('kb1')], rows)
    expect(entry.articles[0].description).toBe('From the excerpt')
  })
})

describe('renderKbCatalog', () => {
  const catalog = buildKbCatalog(
    [
      kb('kb1', { name: 'Help Center' }),
      kb('kb2', { name: 'Internal Playbook', visibility: 'INTERNAL' }),
      kb('empty'),
    ],
    [
      row({ placementId: 'p1', title: 'Shipping', description: 'How shipping works' }),
      row({ placementId: 'p2', knowledgeBaseId: 'kb2', title: 'Escalations' }),
    ]
  )

  it('renders KBs with articles and skips empty ones', () => {
    const out = renderKbCatalog(catalog, { publicOnly: false })
    expect(out).toContain('## Knowledge Catalog')
    expect(out).toContain('### Help Center')
    expect(out).toContain('- Shipping — How shipping works [art-p1]')
    expect(out).toContain('### Internal Playbook')
    expect(out).not.toContain('KB empty')
  })

  it('clamps INTERNAL KBs for customer audiences', () => {
    const out = renderKbCatalog(catalog, { publicOnly: true })
    expect(out).toContain('### Help Center')
    expect(out).not.toContain('Internal Playbook')
  })

  it('returns null when nothing survives filtering', () => {
    expect(renderKbCatalog([], { publicOnly: false })).toBeNull()
    const internalOnly = buildKbCatalog(
      [kb('kb2', { visibility: 'INTERNAL' })],
      [row({ placementId: 'p1', knowledgeBaseId: 'kb2' })]
    )
    expect(renderKbCatalog(internalOnly, { publicOnly: true })).toBeNull()
  })

  it('degrades to names + counts over the size cap', () => {
    const big = buildKbCatalog(
      [kb('kb1', { name: 'Huge KB' })],
      Array.from({ length: 200 }, (_, i) =>
        row({
          placementId: `p${i}`,
          sortOrder: `a${String(i).padStart(3, '0')}`,
          title: `Article number ${i}`,
          description: 'A rather long description that pads the rendered output significantly.',
        })
      )
    )
    const out = renderKbCatalog(big, { publicOnly: false, maxChars: 2000 })
    expect(out).toContain('**Huge KB** — 200 articles')
    expect(out).not.toContain('[p42]')
  })

  it('adapts the read hint when get_article is unavailable', () => {
    const withTool = renderKbCatalog(catalog, { publicOnly: false, hasGetArticle: true })
    const withoutTool = renderKbCatalog(catalog, { publicOnly: false, hasGetArticle: false })
    expect(withTool).toContain('get_article')
    expect(withoutTool).not.toContain('`get_article`')
  })
})
