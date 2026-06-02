// packages/lib/src/ai/kopilot/capabilities/kb/tools/update-block-text.ts

import { mdToBlocks } from '../../../../../kb/markdown/md-to-blocks'
import type { InlineJSON } from '../../../../../kb/markdown/types'
import { parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { buildOpToolResult, EXPECTED_HASH_PARAM, runBlockCrudOp } from './write-helpers'

/**
 * Convenience write tool for prose blocks: pass markdown text, server
 * parses it, and inline-replaces the block's content while preserving
 * blockType + level + other attrs. The block id is preserved.
 */
export function createUpdateBlockTextTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'update_block_text',
    displayName: 'Update article text',
    toolsetSlug: 'auxx:kb:write',
    description:
      'Replace the inline content of a block by id while preserving its type/attrs. Pass markdown — the server parses it and uses just the inline portion. Best for typo fixes, rewrites, or changing the prose of a heading/paragraph/list-item without changing its kind. For richer rewrites use replace_block.',
    parameters: {
      type: 'object',
      properties: {
        blockId: { type: 'string', description: 'Id of the block to edit' },
        markdown: { type: 'string', description: 'New inline content (markdown)' },
        expectedHash: EXPECTED_HASH_PARAM,
      },
      required: ['blockId', 'markdown'],
      additionalProperties: false,
    },
    validateInputs: async (args) => {
      const id = parseStringArg(args.blockId, { name: 'blockId', required: true, max: 200 })
      if (!id.ok) return { ok: false, error: id.error }
      const md = parseStringArg(args.markdown, { name: 'markdown', required: true, max: 50_000 })
      if (!md.ok) return { ok: false, error: md.error }
      const expectedHash = parseStringArg(args.expectedHash, { name: 'expectedHash', max: 200 })
      if (!expectedHash.ok) return { ok: false, error: expectedHash.error }
      return {
        ok: true,
        args: { ...args, blockId: id.value, markdown: md.value, expectedHash: expectedHash.value },
      }
    },
    execute: async (args, agentDeps) => {
      const toolDeps = getDeps()
      const blockId = args.blockId as string
      const markdown = args.markdown as string
      const nodes = mdToBlocks(markdown)
      // This tool edits a SINGLE block's inline text. If the markdown parses
      // to more than one block (or to a structural/container node), bail with
      // guidance instead of silently dropping the extra content.
      const first = nodes[0]
      if (nodes.length !== 1 || !first || first.type !== 'block') {
        return {
          success: false,
          output: null,
          error:
            `update_block_text edits a single block's inline text, but the markdown parsed to ${nodes.length} ` +
            'block(s)/structural content. Use replace_block to rewrite this block, or insert_blocks to add new blocks.',
        }
      }
      const inline = first.content as InlineJSON[]
      const result = await runBlockCrudOp({
        agentDeps,
        toolDeps,
        patch: { op: 'updateText', blockId, content: inline },
        opIndex: 0,
        expectedHash: args.expectedHash as string | undefined,
      })
      return buildOpToolResult('updateText', result)
    },
  }
}
