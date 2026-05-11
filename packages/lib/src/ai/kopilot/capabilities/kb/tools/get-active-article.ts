// packages/lib/src/ai/kopilot/capabilities/kb/tools/get-active-article.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { buildActiveArticleSnapshot } from '../snapshot-pipeline'

/**
 * Returns the full draft body + outline of the article the user is
 * currently editing. The id is read from `SessionContext.activeArticleId`
 * — the agent doesn't pass an id.
 */
export function createGetActiveArticleTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_active_article',
    idempotent: true,
    description:
      'Returns the active KB article the user is editing — title, slug, status, full markdown body, content hash, and a flat outline of every block by id. Call this first when the user references "this article" or asks for changes.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async (_args, agentDeps) => {
      const { db, sessionContext } = getDeps()
      const activeArticleId = sessionContext.activeArticleId
      if (!activeArticleId) {
        return {
          success: false,
          output: null,
          error:
            'no active article — open an article in the KB editor and try again, or use list_kb_articles to find one',
        }
      }
      const snapshot = await buildActiveArticleSnapshot({
        db,
        organizationId: agentDeps.organizationId,
        articleId: activeArticleId,
      })
      if (!snapshot) {
        return { success: false, output: null, error: `article '${activeArticleId}' not found` }
      }
      return { success: true, output: snapshot }
    },
  }
}
