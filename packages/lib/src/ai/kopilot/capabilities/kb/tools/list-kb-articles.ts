// packages/lib/src/ai/kopilot/capabilities/kb/tools/list-kb-articles.ts

import { KBService } from '../../../../../kb/kb-service'
import { parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { getArticleEntityDefinitionId } from '../snapshot-pipeline'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export function createListKbArticlesTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_kb_articles',
    idempotent: true,
    description:
      'List articles in the active knowledge base. Returns id, slug, title, status, parentId, and tag ids. Use to find article ids by name, build cross-links, or navigate the hierarchy. Filter by query (substring match on title) or parentId.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional substring filter on article titles (case-insensitive)',
        },
        parentId: {
          type: 'string',
          description: 'Only return articles with this parent id',
        },
        includeUnpublished: {
          type: 'boolean',
          description: 'Include drafts (default true — agents typically operate on drafts)',
        },
        limit: {
          type: 'number',
          description: `Max results (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`,
        },
      },
      additionalProperties: false,
    },
    validateInputs: async (args) => {
      if (args.query !== undefined) {
        const q = parseStringArg(args.query, { name: 'query', max: 200 })
        if (!q.ok) return { ok: false, error: q.error }
        return { ok: true, args: { ...args, query: q.value } }
      }
      return { ok: true, args }
    },
    execute: async (args, agentDeps) => {
      const { db, sessionContext } = getDeps()
      const knowledgeBaseId = sessionContext.activeKnowledgeBaseId
      if (!knowledgeBaseId) {
        return {
          success: false,
          output: { articles: [] },
          error: 'no active knowledge base — open the KB editor first',
        }
      }
      const query = (args.query as string | undefined)?.toLowerCase()
      const parentId = args.parentId as string | undefined
      const includeUnpublished = (args.includeUnpublished as boolean | undefined) ?? true
      const limit = Math.min((args.limit as number) || DEFAULT_LIMIT, MAX_LIMIT)

      const kb = new KBService(db, agentDeps.organizationId)
      const [all, articleEntityDefinitionId] = await Promise.all([
        kb.getArticles(knowledgeBaseId, { includeUnpublished }),
        getArticleEntityDefinitionId(db, agentDeps.organizationId),
      ])

      let filtered = all
      if (parentId !== undefined) {
        filtered = filtered.filter((a) => a.parentId === parentId)
      }
      if (query) {
        filtered = filtered.filter((a) => a.title?.toLowerCase().includes(query))
      }
      const trimmed = filtered.slice(0, limit)

      return {
        success: true,
        output: {
          articles: trimmed.map((a) => ({
            id: a.id,
            recordId: articleEntityDefinitionId
              ? `${articleEntityDefinitionId}:${a.id}`
              : `article:${a.id}`,
            displayName: a.title || a.slug,
            secondaryInfo: a.slug,
            knowledgeBaseId,
            slug: a.slug,
            title: a.title,
            status: a.status,
            parentId: a.parentId,
            isPublished: a.isPublished,
            hasUnpublishedChanges: a.hasUnpublishedChanges,
          })),
          count: trimmed.length,
          total: filtered.length,
        },
      }
    },
  }
}
