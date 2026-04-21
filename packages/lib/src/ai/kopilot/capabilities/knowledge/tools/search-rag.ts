// packages/lib/src/ai/kopilot/capabilities/knowledge/tools/search-rag.ts

import { SearchService } from '../../../../../datasets/services/search.service'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

const MAX_RESULTS = 10
const MAX_CONTENT_LENGTH = 1500

export function createSearchRagTool(_getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'search_rag',
    idempotent: true,
    usageNotes: 'Emits a `kb-article-list` block automatically.',
    description:
      "Search the organization's uploaded documents and datasets using semantic search. Only for uploaded files/documents (e.g. PDFs, manuals, policy docs). Do NOT use this to look up contacts, customers, products, orders, vendors, or any other entity/record — use search_entities for that.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query — be descriptive for best semantic matching',
        },
        datasetIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: specific dataset IDs to search. Omit to search all datasets.',
        },
        limit: {
          type: 'number',
          description: `Max results (default 5, max ${MAX_RESULTS})`,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const query = args.query as string
      const datasetIds = args.datasetIds as string[] | undefined
      const limit = Math.min((args.limit as number) || 5, MAX_RESULTS)

      try {
        const response = await SearchService.search(
          {
            query,
            datasetIds,
            limit,
            searchType: 'hybrid',
            includeMetadata: true,
          },
          agentDeps.organizationId,
          agentDeps.userId
        )

        if (response.results.length === 0) {
          return {
            success: true,
            output: {
              results: [],
              count: 0,
              message: 'No results found. Try rephrasing your query.',
            },
          }
        }

        const results = response.results.map((r) => ({
          content:
            r.segment.content.length > MAX_CONTENT_LENGTH
              ? `${r.segment.content.slice(0, MAX_CONTENT_LENGTH)}...`
              : r.segment.content,
          score: Math.round(r.score * 100) / 100,
          documentTitle: r.segment.document.title || 'Untitled',
          datasetName: r.segment.document.dataset.name,
          datasetId: r.segment.document.dataset.id,
          searchType: r.searchType,
        }))

        return {
          success: true,
          output: {
            results,
            count: results.length,
            total: response.total,
            searchType: response.searchType,
          },
          blocks: [
            {
              type: 'kb-article-list',
              data: {
                query,
                articles: results.map((r, i) => ({
                  id: `${r.datasetId}:${i}`,
                  title: r.documentTitle,
                  excerpt: r.content,
                  datasetName: r.datasetName,
                  score: r.score,
                })),
              },
            },
          ],
        }
      } catch (error) {
        return {
          success: false,
          output: { results: [], count: 0 },
          error: error instanceof Error ? error.message : 'Search failed',
        }
      }
    },
  }
}
