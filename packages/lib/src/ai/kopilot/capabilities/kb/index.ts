// packages/lib/src/ai/kopilot/capabilities/kb/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import { createDeleteBlocksTool } from './tools/delete-blocks'
import { createGetActiveArticleTool } from './tools/get-active-article'
import { createGetArticleBySlugTool } from './tools/get-article-by-slug'
import { createGetArticleSectionTool } from './tools/get-article-section'
import { createInsertBlocksTool } from './tools/insert-blocks'
import { createListKbArticlesTool } from './tools/list-kb-articles'
import { createMoveBlocksTool } from './tools/move-blocks'
import { createReplaceBlockTool } from './tools/replace-block'
import { createResolveBlockByHeadingTool } from './tools/resolve-block-by-heading'
import { createUpdateBlockAttrsTool } from './tools/update-block-attrs'
import { createUpdateBlockTextTool } from './tools/update-block-text'

export const KB_PAGE = 'kb'

export function createKbCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: KB_PAGE,
    tools: [
      // Reads
      createGetActiveArticleTool(getDeps),
      createListKbArticlesTool(getDeps),
      createGetArticleBySlugTool(getDeps),
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
      'You can read and edit the active KB article. Reads (get_active_article, list_kb_articles, get_article_by_slug, get_article_section, resolve_block_by_heading) are free; writes (insert_blocks, replace_block, update_block_text, update_block_attrs, delete_blocks, move_blocks) commit straight to the draft and the user gets a per-turn Undo button.',
      "Address blocks by their id (returned in every tool output). Block ids are stable across edits — preserve them on replace/update. Anchors for insert/move: { at: 'start' | 'end' } (top of doc / bottom of doc), { at: 'before' | 'after', blockId } (relative to a known block, top-level OR inside a panel/cell), { at: 'startOf' | 'endOf', containerId } (inside a panel by panel id).",
      "Block payload format is mixed: pass `{ kind: 'markdown', markdown: string }` for plain prose (text, headings, lists, blockquotes, code blocks) — the server expands it into one or more BlockJSON nodes. Pass `{ kind: 'block', block: BlockJSON }` for rich blocks (callout, embed, image, cards, tabs, accordion, table) where you need to set specific attrs.",
      'Top-level containers (table, tabs, accordion) are addressable by id like any block — the outline shows a row for each container with its id. Call delete_blocks with the container id to remove it, or move_blocks to reorder it at the top level. Containers cannot move into a panel or table cell, and replace_block does not accept them — to swap a container, delete it and insert the replacement.',
      'Never invent block ids — use the ones from get_active_article. Never invent slugs — look them up via list_kb_articles. Edits go to the draft; the user publishes manually.',
      'Article tool results include a `recordId` (format `<entityDefinitionId>:<articleId>`). To reference an article by name in your reply, emit `auxx:entity-card` with that recordId for a single article, or `auxx:entity-list` for two or more. Copy the recordId verbatim — never construct it.',
    ].join('\n\n'),
    capabilities: [
      'Read, rewrite, and restructure the active knowledge-base article',
      'Browse and cross-link articles in the active knowledge base',
    ],
  }
}
