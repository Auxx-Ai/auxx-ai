// packages/lib/src/ai/kopilot/capabilities/kb/tools/get-article-section.ts

import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { articleToMarkdown } from '../../../../../kb/markdown/article-to-markdown'
import type { ArticleNodeJSON, BlockJSON } from '../../../../../kb/markdown/types'
import { parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'

/**
 * Reads a contiguous section of an article between two heading anchors
 * — useful when `get_article` truncated the body. Identifies the section
 * by the `headingPath` (a top-level heading's text); returns the markdown
 * for everything from that heading to the next heading at the same-or-higher
 * level, or to end-of-doc.
 */
export function createGetArticleSectionTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_article_section',
    toolsetSlug: 'knowledge',
    idempotent: true,
    description:
      'Returns the markdown for one section of the active article identified by its heading text. Use after get_article reports the body was truncated. Section boundaries: from the heading text (case-insensitive prefix match) to the next heading at the same-or-shallower level, or end of doc.',
    parameters: {
      type: 'object',
      properties: {
        headingText: {
          type: 'string',
          description: 'Heading text to anchor the section at (case-insensitive prefix match)',
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
      const { db, sessionContext } = getDeps()
      const articleId = findRef(sessionContext, 'article')?.id
      if (!articleId) {
        return {
          success: false,
          output: null,
          error: 'no active article',
        }
      }
      const headingText = (args.headingText as string).toLowerCase()
      const article = await db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, articleId),
          eq(schema.Article.organizationId, agentDeps.organizationId)
        ),
        with: { draftRevision: true },
      })
      if (!article || !article.draftRevision) {
        return { success: false, output: null, error: 'article not found' }
      }
      const content = (article.draftRevision.contentJson as ArticleNodeJSON[] | null) ?? []
      // Walk top-level looking for the matching heading.
      let startIdx = -1
      let startLevel = Number.POSITIVE_INFINITY
      for (let i = 0; i < content.length; i++) {
        const node = content[i]
        if (node.type !== 'block') continue
        if (node.attrs.blockType !== 'heading') continue
        const text = extractText(node).toLowerCase()
        if (text.startsWith(headingText)) {
          startIdx = i
          startLevel = (node.attrs.level as number | null) ?? 1
          break
        }
      }
      if (startIdx < 0) {
        return {
          success: false,
          output: null,
          error: `no heading matching "${args.headingText as string}"`,
        }
      }
      let endIdx = content.length
      for (let i = startIdx + 1; i < content.length; i++) {
        const node = content[i]
        if (node.type !== 'block') continue
        if (node.attrs.blockType !== 'heading') continue
        const lvl = (node.attrs.level as number | null) ?? 1
        if (lvl <= startLevel) {
          endIdx = i
          break
        }
      }
      const slice = content.slice(startIdx, endIdx)
      const sectionMarkdown = articleToMarkdown({ contentJson: slice })
      return {
        success: true,
        output: {
          headingText: args.headingText as string,
          startBlockId:
            content[startIdx]?.type === 'block' ? (content[startIdx] as BlockJSON).attrs.id : null,
          markdown: sectionMarkdown,
          blockCount: slice.length,
        },
      }
    },
  }
}

function extractText(block: BlockJSON): string {
  if (!block.content) return ''
  return block.content.map((n) => (n.type === 'text' ? (n.text ?? '') : '')).join('')
}
