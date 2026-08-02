// packages/lib/src/kb/catalog/__tests__/kb-catalog.test.ts

import { describe, expect, it } from 'vitest'
import type { ResolvedKnowledgeScope } from '../../../agents/resolve-knowledge-scope'
import { buildKbCatalog, type KbCatalogSourceRow } from '../kb-catalog'
import { type RenderKbCatalogOptions, renderKbCatalog } from '../render-kb-catalog'

function knowledgeScope(over: Partial<ResolvedKnowledgeScope> = {}): ResolvedKnowledgeScope {
  return {
    datasetIds: new Set(),
    fullKbIds: new Set(),
    articleIds: new Set(),
    excludedArticleIds: new Set(),
    ...over,
  }
}

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
    expect(entry?.articles.map((a) => [a.id, a.depth])).toEqual([
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
    expect(entry?.articles.map((a) => [a.id, a.depth])).toEqual([['art-child', 0]])
  })

  it('drops container nodes with no included descendants', () => {
    const rows = [
      row({ placementId: 'cat', articleKind: 'category' }),
      row({ placementId: 'full', articleKind: 'category', sortOrder: 'a1' }),
      row({ placementId: 'page', parentPlacementId: 'full', sortOrder: 'a0' }),
    ]
    const [entry] = buildKbCatalog([kb('kb1')], rows)
    expect(entry?.articles.map((a) => a.id)).toEqual(['art-full', 'art-page'])
  })

  it('keeps orphans whose parent placement is not in the row set', () => {
    const rows = [row({ placementId: 'lost', parentPlacementId: 'unpublished-parent' })]
    const [entry] = buildKbCatalog([kb('kb1')], rows)
    expect(entry?.articles.map((a) => [a.id, a.depth])).toEqual([['art-lost', 0]])
  })

  it('gates on isPublished for standard KBs but not for source KBs', () => {
    const rows = [
      row({ placementId: 'draft', isPublished: false }),
      row({ placementId: 'live', sortOrder: 'a1' }),
    ]
    const [standard] = buildKbCatalog([kb('kb1')], rows)
    expect(standard?.articles.map((a) => a.id)).toEqual(['art-live'])
    const [source] = buildKbCatalog([kb('kb1', { kind: 'source' })], rows)
    expect(source?.articles.map((a) => a.id)).toEqual(['art-draft', 'art-live'])
  })

  it('falls back to excerpt when description is empty', () => {
    const rows = [row({ placementId: 'p1', description: '  ', excerpt: 'From the excerpt' })]
    const [entry] = buildKbCatalog([kb('kb1')], rows)
    expect(entry?.articles[0]?.description).toBe('From the excerpt')
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
    const out = renderKbCatalog(catalog, { publicOnly: false, kbAccess: 'unrestricted' })
    expect(out).toContain('## Knowledge Catalog')
    expect(out).toContain('### Help Center')
    expect(out).toContain('- Shipping — How shipping works [art-p1]')
    expect(out).toContain('### Internal Playbook')
    expect(out).not.toContain('KB empty')
  })

  it('clamps INTERNAL KBs for customer audiences', () => {
    const out = renderKbCatalog(catalog, { publicOnly: true, kbAccess: 'unrestricted' })
    expect(out).toContain('### Help Center')
    expect(out).not.toContain('Internal Playbook')
  })

  it('returns null when nothing survives filtering', () => {
    expect(renderKbCatalog([], { publicOnly: false, kbAccess: 'unrestricted' })).toBeNull()
    const internalOnly = buildKbCatalog(
      [kb('kb2', { visibility: 'INTERNAL' })],
      [row({ placementId: 'p1', knowledgeBaseId: 'kb2' })]
    )
    expect(renderKbCatalog(internalOnly, { publicOnly: true, kbAccess: 'unrestricted' })).toBeNull()
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
    const out = renderKbCatalog(big, {
      publicOnly: false,
      maxChars: 2000,
      kbAccess: 'unrestricted',
    })
    expect(out).toContain('**Huge KB** — 200 articles')
    expect(out).not.toContain('[p42]')
  })

  it('drops KBs the principal cannot view (capability layer v2 §3.4)', () => {
    const out = renderKbCatalog(catalog, {
      publicOnly: false,
      kbAccess: (id) => id === 'kb1',
    })
    expect(out).toContain('### Help Center')
    expect(out).not.toContain('Internal Playbook')
    expect(out).not.toContain('Escalations')
  })

  it('returns null when no KB survives the view gate', () => {
    expect(renderKbCatalog(catalog, { publicOnly: false, kbAccess: () => false })).toBeNull()
  })

  // 🔴 Replaces "omitting canViewKb is a no-op" (plan v3/06 §3.4 A8 / §11 item
  // 6). The gate is no longer omittable — `kbAccess` is required, so a caller
  // must SAY it has no viewer. The no-op behaviour survives only under that
  // explicit spelling, which is what keeps headless runs (§8.2) unchanged.
  it("'unrestricted' is a no-op, and there is no way to omit the gate", () => {
    expect(renderKbCatalog(catalog, { publicOnly: false, kbAccess: 'unrestricted' })).toContain(
      '### Internal Playbook'
    )
    // @ts-expect-error `kbAccess` is required — a caller cannot fall back to
    // unfiltered output by forgetting a field. Type-level only (never called):
    // the directive self-verifies, since an unused @ts-expect-error is itself a
    // tsc error.
    const missingGate: RenderKbCatalogOptions = { publicOnly: false }
    void missingGate
  })

  it('adapts the read hint when get_article is unavailable', () => {
    const withTool = renderKbCatalog(catalog, {
      publicOnly: false,
      hasGetArticle: true,
      kbAccess: 'unrestricted',
    })
    const withoutTool = renderKbCatalog(catalog, {
      publicOnly: false,
      hasGetArticle: false,
      kbAccess: 'unrestricted',
    })
    expect(withTool).toContain('get_article')
    expect(withoutTool).not.toContain('`get_article`')
  })
})

describe('renderKbCatalog — agent knowledge scope (permissions v2 §1.2/1.3)', () => {
  // kb1 ("Full KB"): fully in scope — both articles survive regardless of
  // articleIds. kb2 ("Partial KB"): only individually scoped. kb3 ("Out of
  // scope KB"): neither full nor contributing a scoped article — dropped.
  const scopedCatalog = buildKbCatalog(
    [
      kb('kb1', { name: 'Full KB' }),
      kb('kb2', { name: 'Partial KB' }),
      kb('kb3', { name: 'Out of scope KB' }),
    ],
    [
      row({ placementId: 'p1', title: 'Full article one' }),
      row({ placementId: 'p2', title: 'Full article two', sortOrder: 'a1' }),
      row({ placementId: 'p3', knowledgeBaseId: 'kb2', title: 'Scoped article' }),
      row({
        placementId: 'p4',
        knowledgeBaseId: 'kb2',
        title: 'Unscoped article',
        sortOrder: 'a1',
      }),
      row({ placementId: 'p5', knowledgeBaseId: 'kb3', title: 'Never in scope' }),
    ]
  )

  it('null/undefined scope is a no-op', () => {
    const base = renderKbCatalog(scopedCatalog, { publicOnly: false, kbAccess: 'unrestricted' })
    expect(
      renderKbCatalog(scopedCatalog, {
        publicOnly: false,
        knowledgeScope: null,
        kbAccess: 'unrestricted',
      })
    ).toBe(base)
    expect(
      renderKbCatalog(scopedCatalog, {
        publicOnly: false,
        knowledgeScope: undefined,
        kbAccess: 'unrestricted',
      })
    ).toBe(base)
    expect(base).toContain('Out of scope KB')
  })

  it('keeps every article of a fully-included KB', () => {
    const out = renderKbCatalog(scopedCatalog, {
      publicOnly: false,
      kbAccess: 'unrestricted',
      knowledgeScope: knowledgeScope({ fullKbIds: new Set(['kb1']) }),
    })
    expect(out).toContain('### Full KB')
    expect(out).toContain('Full article one')
    expect(out).toContain('Full article two')
  })

  it('in a partially-included KB, keeps only the individually scoped article and drops the KB if none survive', () => {
    const out = renderKbCatalog(scopedCatalog, {
      publicOnly: false,
      kbAccess: 'unrestricted',
      knowledgeScope: knowledgeScope({ articleIds: new Set(['art-p3']) }),
    })
    expect(out).toContain('### Partial KB')
    expect(out).toContain('Scoped article')
    expect(out).not.toContain('Unscoped article')
    // kb1 and kb3 contribute nothing to this scope — dropped entirely.
    expect(out).not.toContain('Full KB')
    expect(out).not.toContain('Out of scope KB')
  })

  it('drops an excluded article even inside a fully-included KB', () => {
    const out = renderKbCatalog(scopedCatalog, {
      publicOnly: false,
      kbAccess: 'unrestricted',
      knowledgeScope: knowledgeScope({
        fullKbIds: new Set(['kb1']),
        excludedArticleIds: new Set(['art-p1']),
      }),
    })
    expect(out).toContain('### Full KB')
    expect(out).not.toContain('Full article one')
    expect(out).toContain('Full article two')
  })

  it('drops a KB with no surviving article', () => {
    const out = renderKbCatalog(scopedCatalog, {
      publicOnly: false,
      kbAccess: 'unrestricted',
      knowledgeScope: knowledgeScope({ fullKbIds: new Set(['kb1']) }),
    })
    expect(out).not.toContain('Partial KB')
    expect(out).not.toContain('Out of scope KB')
  })

  it('returns null when nothing survives the scope', () => {
    expect(
      renderKbCatalog(scopedCatalog, {
        publicOnly: false,
        knowledgeScope: knowledgeScope(),
        kbAccess: 'unrestricted',
      })
    ).toBeNull()
  })
})
