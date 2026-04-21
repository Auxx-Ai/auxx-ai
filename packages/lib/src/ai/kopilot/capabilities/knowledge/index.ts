// packages/lib/src/ai/kopilot/capabilities/knowledge/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import { createSearchDocsTool } from './tools/search-docs'
import { createSearchKBTool } from './tools/search-kb'
import { createSearchRagTool } from './tools/search-rag'

/**
 * Create the global knowledge capability set.
 * Provides tools for searching documentation, knowledge base articles, and RAG datasets.
 * Registered as __global__ — available on all pages.
 */
export function createKnowledgeCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: '__global__',
    tools: [
      createSearchDocsTool(getDeps),
      createSearchKBTool(getDeps),
      createSearchRagTool(getDeps),
    ],
    systemPromptAddition:
      "You can search the help center documentation (search_docs), knowledge base articles (search_kb), and the organization's knowledge datasets (search_rag) to find answers.",
    capabilities: [
      'Search help center documentation, knowledge base articles, and knowledge datasets',
    ],
  }
}
