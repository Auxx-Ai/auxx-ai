// packages/lib/src/ai/kopilot/capabilities/learned/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import { createUpsertLearnedArticleTool } from './tools/upsert-learned-article'

const GLOBAL_PAGE = '__global__'

/**
 * Learned-KB (AI memory) write capability. Registered by runs that are allowed
 * to propose memory writes: the learned-extraction headless runner (which
 * supplies its own system prompt) and the interactive kopilot registry when
 * the `learnedMemory` feature flag is on — the explicit "remember this" door,
 * where `requiresApproval` renders an in-chat approval card and approving
 * executes + publishes. Recall stays read-side (Knowledge Catalog + read
 * tools); this capability only adds the approval-gated write door.
 */
export function createLearnedKbCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: GLOBAL_PAGE,
    tools: [createUpsertLearnedArticleTool(getDeps)],
    systemPromptAddition:
      "You can save durable organizational knowledge to the learned knowledge base (AI memory) with upsert_learned_article. In conversation, reach for it when the user explicitly asks you to remember something (\"remember this\", \"save this for next time\") or when they state a durable correction/policy worth keeping — the write is approval-gated, so proposing is safe. Only save reusable knowledge — policies, product facts, how humans chose to answer, stable customer facts — never one-off details. Before creating an article, check the Knowledge Catalog for an existing article on the topic and update it instead (read it with get_article first and preserve its content, especially human edits). Articles about a specific contact or company belong in the 'contacts'/'companies' categories with their recordId; topical knowledge goes in 'policies'.",
    capabilities: ['Save durable knowledge to the AI memory (learned knowledge base)'],
  }
}
