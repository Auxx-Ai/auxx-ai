// packages/lib/src/ai/kopilot/capabilities/knowledge/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import { createSearchDocsTool } from './tools/search-docs'
import { createSearchKnowledgeTool } from './tools/search-knowledge'

/**
 * Create the global knowledge capability set.
 * Provides tools for searching the help-center documentation and the
 * organization's knowledge (KB articles + uploaded RAG datasets) via a single
 * unified hybrid-search tool.
 */
export function createKnowledgeCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: '__global__',
    tools: [createSearchDocsTool(getDeps), createSearchKnowledgeTool(getDeps)],
    systemPromptAddition:
      "You can search the help center documentation (search_docs) and the organization's own knowledge (search_knowledge) — both KB articles and uploaded RAG documents in one query.",
    capabilities: ['Search help center documentation, knowledge base articles, and RAG datasets'],
  }
}
