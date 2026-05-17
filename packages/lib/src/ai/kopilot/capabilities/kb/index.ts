// packages/lib/src/ai/kopilot/capabilities/kb/index.ts

import type { GetToolDeps, PageCapability, SystemPromptAdditionContext } from '../types'
import { createDeleteBlocksTool } from './tools/delete-blocks'
import { createGetArticleTool } from './tools/get-article'
import { createGetArticleSectionTool } from './tools/get-article-section'
import { createInsertBlocksTool } from './tools/insert-blocks'
import { createListArticlesTool } from './tools/list-articles'
import { createMoveBlocksTool } from './tools/move-blocks'
import { createReplaceBlockTool } from './tools/replace-block'
import { createResolveBlockByHeadingTool } from './tools/resolve-block-by-heading'
import { createUpdateBlockAttrsTool } from './tools/update-block-attrs'
import { createUpdateBlockTextTool } from './tools/update-block-text'

export const KB_PAGE = 'kb'
const GLOBAL_PAGE = '__global__'

export function createKbCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: KB_PAGE,
    tools: [
      // KB-page reads (require an active article — write surfaces depend on these)
      createGetArticleSectionTool(getDeps),
      createResolveBlockByHeadingTool(getDeps),
      // Writes (block-CRUD)
      createInsertBlocksTool(getDeps),
      createReplaceBlockTool(getDeps),
      createUpdateBlockTextTool(getDeps),
      createUpdateBlockAttrsTool(getDeps),
      createDeleteBlocksTool(getDeps),
      createMoveBlocksTool(getDeps),
    ],
    systemPromptAddition: [
      'You can read and edit the active KB article. Reads (get_article, list_articles, get_article_section, resolve_block_by_heading) are free; writes (insert_blocks, replace_block, update_block_text, update_block_attrs, delete_blocks, move_blocks) commit straight to the draft and the user gets a per-turn Undo button.',
      "Address blocks by their id (returned in every tool output). Block ids are stable across edits — preserve them on replace/update. Anchors for insert/move: { at: 'start' | 'end' } (top of doc / bottom of doc), { at: 'before' | 'after', blockId } (relative to a known block, top-level OR inside a panel/cell), { at: 'startOf' | 'endOf', containerId } (inside a panel by panel id).",
      "Block payload format is mixed: pass `{ kind: 'markdown', markdown: string }` for plain prose (text, headings, lists, blockquotes, code blocks) — the server expands it into one or more BlockJSON nodes. Pass `{ kind: 'block', block: BlockJSON }` for rich blocks (callout, embed, image, cards, tabs, accordion, table) where you need to set specific attrs.",
      'Top-level containers (table, tabs, accordion) are addressable by id like any block — the outline shows a row for each container with its id. Call delete_blocks with the container id to remove it, or move_blocks to reorder it at the top level. Containers cannot move into a panel or table cell, and replace_block does not accept them — to swap a container, delete it and insert the replacement.',
      'Never invent block ids — use the ones from get_article. Never invent slugs — look them up via list_articles. Edits go to the draft; the user publishes manually.',
    ].join('\n\n'),
    capabilities: ['Read, rewrite, and restructure the active knowledge-base article'],
  }
}

/**
 * Global KB read capability — available on every page. Lets agents resolve
 * an `@`-mentioned article's body / list articles without being on the KB
 * surface. Write tools and editor-coupled reads (section, block resolve)
 * stay scoped to the KB page via {@link createKbCapabilities}.
 */
export function createKbReadCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: GLOBAL_PAGE,
    tools: [createGetArticleTool(getDeps), createListArticlesTool(getDeps)],
    systemPromptAddition: (ctx) => buildKbReadPrompt(ctx),
    capabilities: ({ toolNames }) =>
      toolNames.has('get_article') || toolNames.has('list_articles')
        ? ['Browse and read knowledge-base articles']
        : [],
  }
}

function buildKbReadPrompt({ toolNames }: SystemPromptAdditionContext): string {
  const hasGet = toolNames.has('get_article')
  const hasList = toolNames.has('list_articles')
  if (!hasGet && !hasList) return ''
  const sections: string[] = []
  if (hasGet || hasList) {
    sections.push(
      'Article tool results include a `recordId` (format `<entityDefinitionId>:<articleId>`). To reference an article by name in your reply, emit `auxx:entity-card` with that recordId for a single article, or `auxx:entity-list` for two or more. Copy the recordId verbatim — never construct it.'
    )
  }
  if (hasGet) {
    sections.push(
      'For articles, follow `search_entities` with `get_article` to read body content; `get_entity` only returns metadata for articles. When the user `@`-mentions an article or refers to "this article", call `get_article` first to load its body.'
    )
  }
  return sections.join('\n\n')
}
