// packages/lib/src/ai/kopilot/capabilities/kb/tools/update-block-text.ts

import { mdToBlocks } from '../../../../../kb/markdown/md-to-blocks'
import type { InlineJSON } from '../../../../../kb/markdown/types'
import { parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { buildOpToolResult, runBlockCrudOp } from './write-helpers'

/**
 * Convenience write tool for prose blocks: pass markdown text, server
 * parses it, and inline-replaces the block's content while preserving
 * blockType + level + other attrs. The block id is preserved.
 */
export function createUpdateBlockTextTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'update_block_text',
    displayName: 'Update article text',
    toolsetSlug: 'kb.write',
    description:
      'Replace the inline content of a block by id while preserving its type/attrs. Pass markdown — the server parses it and uses just the inline portion. Best for typo fixes, rewrites, or changing the prose of a heading/paragraph/list-item without changing its kind. For richer rewrites use replace_block.',
    parameters: {
      type: 'object',
      properties: {
        blockId: { type: 'string', description: 'Id of the block to edit' },
        markdown: { type: 'string', description: 'New inline content (markdown)' },
      },
      required: ['blockId', 'markdown'],
      additionalProperties: false,
    },
    validateInputs: async (args) => {
      const id = parseStringArg(args.blockId, { name: 'blockId', required: true, max: 200 })
      if (!id.ok) return { ok: false, error: id.error }
      const md = parseStringArg(args.markdown, { name: 'markdown', required: true, max: 50_000 })
      if (!md.ok) return { ok: false, error: md.error }
      return { ok: true, args: { ...args, blockId: id.value, markdown: md.value } }
    },
    execute: async (args, agentDeps) => {
      const toolDeps = getDeps()
      const blockId = args.blockId as string
      const markdown = args.markdown as string
      const nodes = mdToBlocks(markdown)
      // Take inline content from the first block of the parsed nodes; if
      // the markdown produces multiple blocks, the agent should use
      // replace_block / insert_blocks instead.
      const first = nodes.find((n) => n.type === 'block')
      const inline = (first && first.type === 'block' ? first.content : []) as InlineJSON[]
      const result = await runBlockCrudOp({
        agentDeps,
        toolDeps,
        patch: { op: 'updateText', blockId, content: inline },
        opIndex: 0,
      })
      return buildOpToolResult('updateText', result)
    },
  }
}
