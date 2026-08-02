// packages/lib/src/ai/kopilot/prompts/sections/kb-catalog.ts

import { renderKbCatalog } from '../../../../kb/catalog/render-kb-catalog'
import { ALL_MODES, type PromptSection } from './types'

/**
 * Browse-first knowledge retrieval: inject the org's published-article ToC so
 * the model picks articles from the catalog and reads them whole
 * (`get_article`) instead of leaning on chunk-level embedding search.
 * Customer-facing runs only see PUBLIC KBs — mirrors the `search_knowledge`
 * dataset clamp. See plans/kb/knowledge-retrieval-plan.md.
 *
 * Member-audience runs are additionally gated per KB by `ctx.recordAccess`
 * (capability layer v2 §3.4). Without it the catalog handed a member the full
 * ToC — titles plus body-derived descriptions — of every INTERNAL KB, including
 * ones they hold no instance grant on.
 *
 * `ctx.knowledgeScope` (permissions v2 §1.2/1.3) narrows further: the agent's
 * own retrieval scope, same allowlist `search_knowledge` enforces. Without
 * this the catalog could advertise a KB or article the tool can't actually
 * return.
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
    const recordAccess = ctx.recordAccess
    return renderKbCatalog(ctx.kbCatalog, {
      publicOnly: ctx.audience === 'customer',
      hasGetArticle,
      // 🔴 `'unrestricted'` is stated, not defaulted (plan v3/06 §3.4 A8). An
      // absent `recordAccess` means the run has **no viewer to be relative to** —
      // the workflow AI node is the one remaining un-threaded caller — which is
      // the same `capabilities: undefined ⇒ unrestricted` convention every other
      // headless path in this codebase relies on (§8.2). A viewer who is present
      // but grants nothing takes the predicate branch and gets `null` back, which
      // drops the whole section.
      kbAccess: recordAccess ? (kbId) => recordAccess.canViewInstance('kb', kbId) : 'unrestricted',
      knowledgeScope: ctx.knowledgeScope,
    })
  },
}
