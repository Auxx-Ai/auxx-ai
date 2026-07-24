// packages/lib/src/ai/kopilot/capabilities/kb/tools/resolve-block-by-heading.ts

import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import type { ArticleNodeJSON, BlockJSON } from '../../../../../kb/markdown/types'
import { parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'
import { canViewKb } from '../kb-access'

/**
 * Resolves a heading's text → block id. Useful when the agent is
 * referring to a section by name and wants to operate on the heading
 * block (or its first child) by id.
 */
export function createResolveBlockByHeadingTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'resolve_block_by_heading',
    displayName: 'Find article section',
    toolsetSlug: 'auxx:knowledge',
    idempotent: true,
    exampleOutput: {
      blockId: 'b3',
      level: 2,
      text: 'Finding your tracking number',
    },
    description:
      "Resolves a heading's text to its block id in the active article. Returns null if no heading matches. Use this when the user references a section by name and you need a stable block id to operate on.",
    parameters: {
      type: 'object',
      properties: {
        headingText: {
          type: 'string',
          description: 'Heading text (case-insensitive prefix match)',
        },
      },
      required: ['headingText'],
      additionalProperties: false,
    },
    validateInputs: async (args) => {
      const h = parseStringArg(args.headingText, { name: 'headingText', required: true, max: 500 })
      if (!h.ok) return { ok: false, error: h.error }
      return { ok: true, args: { ...args, headingText: h.value } }
    },
    execute: async (args, agentDeps) => {
      const { db, sessionContext, capabilities } = getDeps()
      const articleId = findRef(sessionContext, 'article')?.id
      if (!articleId) {
        return { success: false, output: null, error: 'no active article' }
      }
      const article = await db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, articleId),
          eq(schema.Article.organizationId, agentDeps.organizationId)
        ),
        with: { draftRevision: true },
      })
      // The active-article ref is client-supplied, so re-check instance access
      // here (permissions v2 §3.3). Silent filter — a KB the caller can't view
      // reads as "not found", never a 403.
      if (
        !article ||
        !article.draftRevision ||
        !canViewKb(capabilities, article.homeKnowledgeBaseId)
      ) {
        return { success: false, output: null, error: 'article not found' }
      }
      const content = (article.draftRevision.contentJson as ArticleNodeJSON[] | null) ?? []
      const lowered = (args.headingText as string).toLowerCase()
      for (const node of content) {
        if (node.type !== 'block') continue
        if (node.attrs.blockType !== 'heading') continue
        const text = extractText(node).toLowerCase()
        if (text.startsWith(lowered)) {
          return {
            success: true,
            output: {
              blockId: node.attrs.id ?? null,
              level: node.attrs.level ?? null,
              text: extractText(node),
            },
          }
        }
      }
      return { success: true, output: { blockId: null } }
    },
  }
}

function extractText(block: BlockJSON): string {
  if (!block.content) return ''
  return block.content.map((n) => (n.type === 'text' ? (n.text ?? '') : '')).join('')
}
