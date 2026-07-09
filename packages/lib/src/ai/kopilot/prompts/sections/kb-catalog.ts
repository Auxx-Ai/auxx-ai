// packages/lib/src/ai/kopilot/prompts/sections/kb-catalog.ts

import { renderKbCatalog } from '../../../../kb/catalog/render-kb-catalog'
import { ALL_MODES, type PromptSection } from './types'

/**
 * Browse-first knowledge retrieval: inject the org's published-article ToC so
 * the model picks articles from the catalog and reads them whole
 * (`get_article`) instead of leaning on chunk-level embedding search.
 * Customer-facing runs only see PUBLIC KBs — mirrors the `search_knowledge`
 * dataset clamp. See plans/kb/knowledge-retrieval-plan.md.
 */
export const kbCatalog: PromptSection = {
  id: 'kb-catalog',
  modes: ALL_MODES,
  stability: 'org',
  render: (ctx) => {
    if (!ctx.kbCatalog?.length) return null
    const hasGetArticle = ctx.toolNames.has('get_article')
    // Without a way to read or search knowledge, the catalog is dead weight.
    if (!hasGetArticle && !ctx.toolNames.has('search_knowledge')) return null
    return renderKbCatalog(ctx.kbCatalog, {
      publicOnly: ctx.audience === 'customer',
      hasGetArticle,
    })
  },
}
