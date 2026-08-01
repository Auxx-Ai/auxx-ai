// packages/lib/src/ai/kopilot/capabilities/kb/index.ts

import { createScopedLogger } from '@auxx/logger'
import { readKopilotSnapshot } from '../../../../kb/kopilot-snapshot'
import { findRef } from '../../context-refs'
import type { GetToolDeps, PageCapability, SystemPromptAdditionContext } from '../types'
import { createDeleteBlocksTool } from './tools/delete-blocks'
import { createGetArticleTool } from './tools/get-article'
import { createGetArticleSectionTool } from './tools/get-article-section'
import { createInsertBlocksTool } from './tools/insert-blocks'
import { createListArticlesTool } from './tools/list-articles'
import { createMoveBlocksTool } from './tools/move-blocks'
import { createReplaceBlockTool } from './tools/replace-block'
import { createResolveBlockByHeadingTool } from './tools/resolve-block-by-heading'
import { finalizeKopilotKbTurn, revertKopilotKbTurn } from './tools/write-helpers'

export const KB_PAGE = 'kb'
const GLOBAL_PAGE = '__global__'

/**
 * The block-CRUD write tools. The "rewrite and restructure" bullet is only
 * honest while at least one of these survived runtime filtering — the KB reads
 * alone can't edit anything.
 */
const KB_WRITE_TOOL_NAMES = ['insert_blocks', 'replace_block', 'delete_blocks', 'move_blocks']

const logger = createScopedLogger('kb-capability-lifecycle')

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
      createDeleteBlocksTool(getDeps),
      createMoveBlocksTool(getDeps),
    ],
    systemPromptAddition: [
      'You can read and edit the active KB article. Reads (get_article, list_articles, get_article_section, resolve_block_by_heading) are free; writes commit straight to the draft and the user gets a per-turn Undo button.',
      'You edit with **markdown only**. There are exactly four write tools, all addressed by block id:\n  - `insert_blocks(anchor, markdown)` — insert content at an anchor\n  - `replace_block(blockId, markdown)` — rewrite a block (its id is preserved; markdown may expand to several blocks — the first keeps the id, the rest are inserted after). Pass empty markdown (`""`) to remove the block — same as `delete_blocks([blockId])`.\n  - `delete_blocks(blockIds)` — remove blocks (or top-level containers) by id\n  - `move_blocks(blockIds, anchor)` — reorder blocks',
      "Address blocks by their id (returned in every tool output and the get_article outline). Block ids are stable across edits. Anchors: { at: 'start' | 'end' } (top/bottom of doc), { at: 'before' | 'after', blockId } (relative to a known block, top-level OR inside a panel/cell), { at: 'startOf' | 'endOf', containerId } (inside a panel by panel id).",
      'Markdown supports rich blocks via fences:\n  - callout: `:::info … :::` (variants: `info`, `warn`, `error`, `tip`, `success`)\n  - tabs: `::::tabs` then `:::tab{label="Setup"} … :::` for each tab … `::::`\n  - accordion: `::::accordion` then `:::item{label="Question?"} … :::` for each item … `::::`\n  - cards: `:::cards` then `::card{title="…" href="…" icon="…"}` per card … `:::`\n  - image: `![](https://…){width=600 align=left}`\n  - embed: `::embed{url="https://youtu.be/…"}` (or paste the URL on its own line)\n  - table: a GFM pipe table\nPreserve any `@[…]` reference chips verbatim when rewriting a block (e.g. `@[field:ticket:status]`, `@[user:u_1]`) — copy the token exactly, never reformat the id.',
      'Worked examples:\n  - replace_block("blk_42", ":::warn\\nBack up your data before upgrading.\\n:::")\n  - insert_blocks({ at: "after", blockId: "blk_7" }, "## Troubleshooting\\n\\n- Restart the app\\n- Clear the cache")',
      'Top-level containers (table, tabs, accordion) are addressable by id like any block — the outline shows a row for each. delete_blocks(containerId) removes one; move_blocks reorders it at the top level. Containers cannot move into a panel or table cell. To swap a container, delete it and insert the replacement.',
      'Never invent block ids — use the ones from get_article. Never invent slugs — look them up via list_articles. Edits go to the draft; the user publishes manually.',
    ].join('\n\n'),
    capabilities: ({ toolNames }) =>
      KB_WRITE_TOOL_NAMES.some((name) => toolNames.has(name))
        ? ['Read, rewrite, and restructure the active knowledge-base article']
        : [],
    lifecycle: {
      // A KB turn runs a turn-scoped transaction against the active article: the
      // first write captures a pre-turn snapshot in Redis and locks the article;
      // turn end must finalize (release lock, keep snapshot for Undo) or revert
      // (restore snapshot, unlock). Every block-CRUD write resolves its target
      // from `findRef(sessionContext, 'article')`, so a turn touches exactly one
      // article — the active one. The snapshot keyed by `(articleId, turnId)` is
      // already the "did THIS turn write it" record: `readKopilotSnapshot` with
      // the turn id returns null unless this turn wrote the article, which also
      // stops a prior turn's still-pending review snapshot (24h TTL) from being
      // finalized/reverted here.
      async onTurnEnd(outcome, { turnId }) {
        const { db, organizationId, userId, sessionContext } = getDeps()
        const articleId = findRef(sessionContext, 'article')?.id
        if (!articleId) return
        const snapshot = await readKopilotSnapshot(articleId, turnId)
        if (!snapshot) return
        try {
          if (outcome === 'completed') {
            await finalizeKopilotKbTurn({ articleId })
          } else {
            // `expectedTurnId` is load-bearing now that we derive `articleId`
            // from `sessionContext` rather than a per-turn touched list: it
            // rejects a stale (prior-turn) snapshot so a later failed turn can't
            // roll back an article it never wrote.
            await revertKopilotKbTurn({
              db,
              organizationId,
              userId,
              articleId,
              expectedTurnId: turnId,
            })
          }
        } catch (err) {
          logger.error('Kopilot turn-end KB lifecycle failed', {
            articleId,
            turnId,
            outcome,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
    },
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
