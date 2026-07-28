// packages/lib/src/ai/kopilot/capabilities/kb/tools/insert-blocks.ts

import type { BlockAnchor } from '../../../../../kb/blocks/patch-types'
import { parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import {
  buildOpToolResult,
  EXPECTED_HASH_PARAM,
  expandMarkdown,
  runBlockCrudOp,
} from './write-helpers'

export function createInsertBlocksTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'insert_blocks',
    permission: {
      target: 'instance',
      keys: ['kb'],
      level: 'edit',
      enforcement: 'enforced',
      note: 'runBlockCrudOp → assertEditInstance("kb", …) — the single choke point for all four block-CRUD writes.',
    },
    displayName: 'Insert article blocks',
    toolsetSlug: 'auxx:kb:write',
    exampleOutput: {
      ok: true,
      op: 'insert',
      articleId: 'art_4Kp9wZ',
      preHash: 'a1b2c3d4e5f60718',
      postHash: 'c9d8e7f6a5b40312',
      affectedBlockIds: ['b14', 'b15'],
    },
    description:
      "Insert content at the given anchor in the active article. Pass the content as Auxx markdown — it expands to one or more blocks.\n\nAnchors:\n  { at: 'start' | 'end' } — top/bottom of doc\n  { at: 'before' | 'after', blockId } — relative to any block id (top-level or inside a panel/cell)\n  { at: 'startOf' | 'endOf', containerId } — inside a panel by panel id\n\nMarkdown supports rich blocks via fences: callouts (`:::info … :::`), tabs (`::::tabs` / `:::tab{label=\"…\"}`), accordions (`::::accordion` / `:::item{label=\"…\"}`), cards (`:::cards` / `::card{title=\"…\"}`), images (`![](url){width= align=}`), embeds (`::embed{url=\"…\"}`), and GFM tables. Containers (table/tabs/accordion) can ONLY be inserted at top-level anchors (start/end, or before/after a top-level block) — panels and table cells hold leaf blocks only. Block ids are stamped server-side.",
    parameters: {
      type: 'object',
      properties: {
        anchor: {
          type: 'object',
          description:
            "Where to insert: { at: 'start'|'end' } | { at: 'before'|'after', blockId } | { at: 'startOf'|'endOf', containerId }",
          additionalProperties: true,
        },
        markdown: {
          type: 'string',
          description: 'Content to insert as Auxx markdown (expands to one or more blocks)',
        },
        expectedHash: EXPECTED_HASH_PARAM,
      },
      required: ['anchor', 'markdown'],
      additionalProperties: false,
    },
    validateInputs: async (args) => {
      const md = parseStringArg(args.markdown, { name: 'markdown', required: true, max: 50_000 })
      if (!md.ok) return { ok: false, error: md.error }
      const anchor = args.anchor as BlockAnchor | undefined
      if (!anchor || typeof anchor !== 'object' || typeof anchor.at !== 'string') {
        return { ok: false, error: 'anchor must be { at, blockId? | containerId? }' }
      }
      const expectedHash = parseStringArg(args.expectedHash, { name: 'expectedHash', max: 200 })
      if (!expectedHash.ok) return { ok: false, error: expectedHash.error }
      return {
        ok: true,
        args: { ...args, markdown: md.value, expectedHash: expectedHash.value },
      }
    },
    execute: async (args, agentDeps) => {
      const toolDeps = getDeps()
      const blocks = expandMarkdown(args.markdown as string)
      if (blocks.length === 0) {
        return { success: false, output: null, error: 'markdown parsed to zero blocks' }
      }
      const anchor = args.anchor as BlockAnchor
      const result = await runBlockCrudOp({
        agentDeps,
        toolDeps,
        patch: { op: 'insert', anchor, blocks },
        opIndex: 0,
        expectedHash: args.expectedHash as string | undefined,
      })
      return buildOpToolResult('insert', result)
    },
  }
}
