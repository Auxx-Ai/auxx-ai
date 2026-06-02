// packages/lib/src/ai/kopilot/capabilities/kb/tools/replace-block.ts

import { parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import {
  buildOpToolResult,
  EXPECTED_HASH_PARAM,
  parseSingleBlock,
  runBlockCrudOp,
} from './write-helpers'

export function createReplaceBlockTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'replace_block',
    displayName: 'Replace article block',
    toolsetSlug: 'auxx:kb:write',
    description:
      'Replace a single block by id. The id is preserved on the new block (the agent does not need to repeat it). Use this when fully rewriting a block — for text-only edits, prefer update_block_text; for attribute changes, prefer update_block_attrs.',
    parameters: {
      type: 'object',
      properties: {
        blockId: { type: 'string', description: 'Id of the block to replace' },
        block: {
          type: 'object',
          description: 'BlockJSON replacement (id is overwritten with blockId on the server)',
          additionalProperties: true,
        },
        expectedHash: EXPECTED_HASH_PARAM,
      },
      required: ['blockId', 'block'],
      additionalProperties: false,
    },
    validateInputs: async (args) => {
      const id = parseStringArg(args.blockId, { name: 'blockId', required: true, max: 200 })
      if (!id.ok) return { ok: false, error: id.error }
      const block = parseSingleBlock(args.block, 'block')
      if (!block.ok) return { ok: false, error: block.error }
      const expectedHash = parseStringArg(args.expectedHash, { name: 'expectedHash', max: 200 })
      if (!expectedHash.ok) return { ok: false, error: expectedHash.error }
      return {
        ok: true,
        args: {
          ...args,
          blockId: id.value,
          block: block.value as unknown as Record<string, unknown>,
          expectedHash: expectedHash.value,
        },
      }
    },
    execute: async (args, agentDeps) => {
      const toolDeps = getDeps()
      const blockId = args.blockId as string
      const block = args.block as unknown as Parameters<typeof parseSingleBlock>[0]
      const parsed = parseSingleBlock(block, 'block')
      if (!parsed.ok) return { success: false, output: null, error: parsed.error }
      const result = await runBlockCrudOp({
        agentDeps,
        toolDeps,
        patch: { op: 'replace', blockId, block: parsed.value },
        opIndex: 0,
        expectedHash: args.expectedHash as string | undefined,
      })
      return buildOpToolResult('replace', result)
    },
  }
}
