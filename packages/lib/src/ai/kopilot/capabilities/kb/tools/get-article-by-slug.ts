// packages/lib/src/ai/kopilot/capabilities/kb/tools/get-article-by-slug.ts

import { KBService } from '../../../../../kb/kb-service'
import { parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { buildActiveArticleSnapshot } from '../snapshot-pipeline'

export function createGetArticleBySlugTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_article_by_slug',
    idempotent: true,
    description:
      'Look up an article in the active knowledge base by its slug. Returns the same shape as get_active_article — title, body, outline, hash. Use to load a referenced article (e.g. "compare it to the refunds policy") without dropping the active article context.',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Article slug (the URL-safe path segment, not a full path)',
        },
      },
      required: ['slug'],
      additionalProperties: false,
    },
    validateInputs: async (args) => {
      const slug = parseStringArg(args.slug, { name: 'slug', required: true, max: 200 })
      if (!slug.ok) return { ok: false, error: slug.error }
      return { ok: true, args: { ...args, slug: slug.value } }
    },
    execute: async (args, agentDeps) => {
      const { db, sessionContext } = getDeps()
      const knowledgeBaseId = sessionContext.activeKnowledgeBaseId
      if (!knowledgeBaseId) {
        return {
          success: false,
          output: null,
          error: 'no active knowledge base — open the KB editor first',
        }
      }
      const slug = args.slug as string
      const kb = new KBService(db, agentDeps.organizationId)
      try {
        const article = await kb.getArticleBySlug(slug, knowledgeBaseId)
        const snapshot = await buildActiveArticleSnapshot({
          db,
          organizationId: agentDeps.organizationId,
          articleId: article.id,
        })
        return { success: true, output: snapshot }
      } catch (error) {
        return {
          success: false,
          output: null,
          error: error instanceof Error ? error.message : 'lookup failed',
        }
      }
    },
  }
}
