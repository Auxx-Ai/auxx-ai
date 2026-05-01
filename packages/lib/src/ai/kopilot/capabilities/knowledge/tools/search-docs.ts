// packages/lib/src/ai/kopilot/capabilities/knowledge/tools/search-docs.ts

import { DOCS_URL } from '@auxx/config/urls'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { ArticleSearchDigest, takeSample } from '../../../digests'
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
    idempotent: true,
    outputDigestSchema: ArticleSearchDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as { articles?: string; count?: number }
      const titles =
        typeof out.articles === 'string'
          ? out.articles
              .split(/\n\n---\n\n/)
              .map((chunk) => chunk.match(/^###\s+(.+)$/m)?.[1])
              .filter((t): t is string => Boolean(t))
          : []
      return {
        articleCount: typeof out.count === 'number' ? out.count : titles.length,
        titles: takeSample(titles),
      }
    },
    usageNotes:
      'Cite the docs you actually used in the final message via `[Title](auxx://doc/<slug>)` inline links — the slug is on each article.',
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

      // 4. Build structured output for LLM consumption. The `slug` is what the
      //    LLM cites in `auxx://doc/<slug>` inline links — derived from the URL
      //    path so it round-trips back to a stable key in `snapshots.docs`.
      const docs = articles.map((a) => ({
        slug: deriveDocSlug(a.url),
        title: a.title,
        url: a.url,
        description: a.description ?? undefined,
      }))
      const articleTexts = articles.map(
        (a, i) =>
          `### ${a.title}\nSlug: ${docs[i]!.slug}\nURL: ${a.url}\n${a.description ? `${a.description}\n` : ''}${a.content ? `\n${a.content}` : ''}`
      )

      return {
        success: true,
        output: {
          count: articles.length,
          query: queries.join(', '),
          articles: articleTexts.join('\n\n---\n\n'),
          docs,
        },
      }
    },
  }
}

/**
 * Derive a stable slug from a docs URL. The slug is the URL path with the
 * leading slash stripped — it round-trips through `auxx://doc/<slug>` because
 * `extractLinkSnapshots` splits the href on the first `/` and treats the
 * remainder as the lookup key.
 */
function deriveDocSlug(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname.replace(/^\/+/, '')
  } catch {
    return url
  }
}
