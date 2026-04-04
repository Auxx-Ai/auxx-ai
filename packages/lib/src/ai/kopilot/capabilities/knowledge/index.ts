// packages/lib/src/ai/kopilot/capabilities/knowledge/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import { createSearchDocsTool } from './tools/search-docs'
import { createSearchKBTool } from './tools/search-kb'

/**
 * Create the global knowledge capability set.
 * Provides tools for searching documentation and knowledge base articles.
 * Registered as __global__ — available on all pages.
 */
export function createKnowledgeCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: '__global_knowledge__',
    tools: [createSearchDocsTool(getDeps), createSearchKBTool(getDeps)],
    systemPromptAddition:
      'You can search the help center documentation (search_docs) and internal knowledge base articles (search_kb) to find answers.',
  }
}
