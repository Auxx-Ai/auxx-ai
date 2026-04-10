// packages/lib/src/ai/kopilot/capabilities/knowledge/tools/search-docs.ts

import { DOCS_URL } from '@auxx/config/urls'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

interface SortedResult {
  id: string
  type: 'page' | 'heading' | 'text'
  content: string
  url: string
}

interface ContentResponse {
  title: string
  description: string | null
  url: string
  content: string
}

const MAX_RESULTS = 10

export function createSearchDocsTool(_getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'search_docs',
    description:
      'Search Auxx.ai help center and developer documentation. Only for questions about how Auxx platform features work, setup guides, API docs, and troubleshooting. Do NOT use this to look up contacts, customers, products, orders, vendors, or any other entity/record — use search_entities for that.',
    parameters: {
      type: 'object',
      properties: {
        objective: {
          type: 'string',
          description: 'What you are trying to find or answer',
        },
        search_queries: {
          type: 'array',
          items: { type: 'string' },
          description: 'One or more search queries (2-3 varied phrasings for better recall)',
        },
        limit: {
          type: 'number',
          description: `Max results to fetch content for (default 5, max ${MAX_RESULTS})`,
        },
      },
      required: ['objective', 'search_queries'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const queries = args.search_queries as string[]
      const limit = Math.min((args.limit as number) || 5, MAX_RESULTS)

      // 1. Fan out search queries to /api/search
      const searchResults = await Promise.all(
        queries.map(async (query) => {
          try {
            const res = await fetch(`${DOCS_URL}/api/search?query=${encodeURIComponent(query)}`)
            if (!res.ok) return []
            return (await res.json()) as SortedResult[]
          } catch {
            return []
          }
        })
      )

      // 2. Flatten + deduplicate by URL, keep only type: 'page'
      const seen = new Set<string>()
      const pages: Array<{ url: string; title: string }> = []
      for (const results of searchResults) {
        for (const r of results) {
          if (r.type !== 'page' || seen.has(r.url)) continue
          seen.add(r.url)
          pages.push({ url: r.url, title: r.content })
        }
      }

      if (pages.length === 0) {
        return {
          success: true,
          output: { articles: [], count: 0, message: 'No documentation found' },
        }
      }

      // 3. Fetch full content for top N pages via /api/content
      const articles = await Promise.all(
        pages.slice(0, limit).map(async (page) => {
          try {
            const res = await fetch(`${DOCS_URL}/api/content?url=${encodeURIComponent(page.url)}`)
            if (!res.ok) {
              return {
                title: page.title,
                url: `${DOCS_URL}${page.url}`,
                description: null as string | null,
                content: null as string | null,
              }
            }
            const data = (await res.json()) as ContentResponse
            return {
              title: data.title,
              url: `${DOCS_URL}${data.url}`,
              description: data.description,
              content: data.content,
            }
          } catch {
            return {
              title: page.title,
              url: `${DOCS_URL}${page.url}`,
              description: null as string | null,
              content: null as string | null,
            }
          }
        })
      )

      // 4. Build structured output for LLM consumption
      const articleTexts = articles.map(
        (a) =>
          `### ${a.title}\nURL: ${a.url}\n${a.description ? `${a.description}\n` : ''}${a.content ? `\n${a.content}` : ''}`
      )

      return {
        success: true,
        output: {
          count: articles.length,
          query: queries.join(', '),
          articles: articleTexts.join('\n\n---\n\n'),
        },
        blocks: [
          {
            type: 'docs-results',
            data: {
              articles: articles.map((a) => ({
                title: a.title,
                url: a.url,
                description: a.description,
              })),
              query: queries.join(', '),
            },
          },
        ],
        text: articleTexts.join('\n\n---\n\n'),
      }
    },
  }
}
