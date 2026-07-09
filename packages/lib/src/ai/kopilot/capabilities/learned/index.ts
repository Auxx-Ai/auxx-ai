// packages/lib/src/ai/kopilot/capabilities/learned/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import { createUpsertLearnedArticleTool } from './tools/upsert-learned-article'

const GLOBAL_PAGE = '__global__'

/**
 * Learned-KB (AI memory) write capability. Registered by runs that are allowed
 * to propose memory writes — the learned-extraction headless runner and,
 * later, the explicit "remember this" flow. Not part of the default
 * interactive registry: recall happens via the Knowledge Catalog + read tools;
 * this capability only adds the approval-gated write door.
 */
export function createLearnedKbCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: GLOBAL_PAGE,
    tools: [createUpsertLearnedArticleTool(getDeps)],
    systemPromptAddition:
      "You can save durable organizational knowledge to the learned knowledge base (AI memory) with upsert_learned_article. Only save reusable knowledge — policies, product facts, how humans chose to answer, stable customer facts — never one-off details. Before creating an article, check the Knowledge Catalog for an existing article on the topic and update it instead (read it with get_article first and preserve its content, especially human edits). Articles about a specific contact or company belong in the 'contacts'/'companies' categories with their recordId; topical knowledge goes in 'policies'.",
    capabilities: ['Save durable knowledge to the AI memory (learned knowledge base)'],
  }
}
