// packages/lib/src/ai/kopilot/capabilities/kb/tools/insert-blocks.ts

import type { BlockAnchor } from '../../../../../kb/blocks/patch-types'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import {
  buildOpToolResult,
  expandBlockInputs,
  parseBlockInputs,
  runBlockCrudOp,
} from './write-helpers'

export function createInsertBlocksTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'insert_blocks',
    displayName: 'Insert article blocks',
    toolsetSlug: 'kb.write',
    description:
      "Insert one or more blocks at the given anchor in the active article.\n\nAnchors:\n  { at: 'start' | 'end' } — top/bottom of doc\n  { at: 'before' | 'after', blockId } — relative to any block id (top-level or inside a panel/cell)\n  { at: 'startOf' | 'endOf', containerId } — inside a panel by panel id\n\nBlock payloads are mixed: { kind: 'markdown', markdown } for prose / GFM (paragraphs, headings, lists, code, blockquotes, tables, etc.) — preferred when possible; { kind: 'block', block } for explicit node JSON. The `block` field accepts:\n  - { type: 'block', attrs:{ blockType }, content } — leaf blocks (text, heading, bulletListItem, numberedListItem, todoListItem, quote, callout, codeBlock, divider, image, embed, cards)\n  - { type: 'table', content: [{ type:'tableRow', content: [{ type:'tableCell'|'tableHeader', content: [BlockJSON,...] }, ...] }, ...] }\n  - { type: 'tabs', attrs:{ activeTab:null }, content: [{ type:'panel', attrs:{ id, label }, content:[BlockJSON,...] }, ...] }\n  - { type: 'accordion', attrs:{ allowMultiple:true }, content: [{ type:'panel', ... }, ...] }\n\nContainers (table/tabs/accordion) can ONLY be inserted at top-level anchors (start/end, or before/after a top-level block). Panels and table cells hold leaf blocks only. Block ids are stamped server-side — you may omit them.",
    parameters: {
      type: 'object',
      properties: {
        anchor: {
          type: 'object',
          description:
            "Where to insert: { at: 'start'|'end' } | { at: 'before'|'after', blockId } | { at: 'startOf'|'endOf', containerId }",
          additionalProperties: true,
        },
        blocks: {
          type: 'array',
          description:
            "Block payloads — { kind: 'markdown', markdown } or { kind: 'block', block: BlockJSON }",
          items: { type: 'object', additionalProperties: true },
        },
      },
      required: ['anchor', 'blocks'],
      additionalProperties: false,
    },
    validateInputs: async (args) => {
      const blocks = parseBlockInputs(args.blocks, 'blocks')
      if (!blocks.ok) return { ok: false, error: blocks.error }
      const anchor = args.anchor as BlockAnchor | undefined
      if (!anchor || typeof anchor !== 'object' || typeof anchor.at !== 'string') {
        return { ok: false, error: 'anchor must be { at, blockId? | containerId? }' }
      }
      return {
        ok: true,
        args: { ...args, blocks: blocks.value as unknown as Record<string, unknown>[] },
      }
    },
    execute: async (args, agentDeps) => {
      const toolDeps = getDeps()
      const inputs = args.blocks as unknown as Parameters<typeof expandBlockInputs>[0]
      const blocks = expandBlockInputs(inputs)
      if (blocks.length === 0) {
        return { success: false, output: null, error: 'no blocks to insert' }
      }
      const anchor = args.anchor as BlockAnchor
      const result = await runBlockCrudOp({
        agentDeps,
        toolDeps,
        patch: { op: 'insert', anchor, blocks },
        opIndex: 0,
      })
      return buildOpToolResult('insert', result)
    },
  }
}
