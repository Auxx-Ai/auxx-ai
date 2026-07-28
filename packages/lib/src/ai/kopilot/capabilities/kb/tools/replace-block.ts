// packages/lib/src/ai/kopilot/capabilities/kb/tools/replace-block.ts

import { parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { buildOpToolResult, EXPECTED_HASH_PARAM, runMarkdownReplace } from './write-helpers'

export function createReplaceBlockTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'replace_block',
    permission: {
      target: 'instance',
      keys: ['kb'],
      level: 'edit',
      enforcement: 'enforced',
      note: 'runBlockCrudOp → assertEditInstance("kb", …).',
    },
    displayName: 'Replace article block',
    toolsetSlug: 'auxx:kb:write',
    exampleOutput: {
      ok: true,
      op: 'replace',
      articleId: 'art_4Kp9wZ',
      preHash: 'a1b2c3d4e5f60718',
      postHash: 'd3e4f5061728a9bc',
      affectedBlockIds: ['b6'],
    },
    description:
      'Rewrite a block by id. Pass the new content as markdown — the block\'s id is preserved (the agent does not need to repeat it). The markdown may expand to several blocks: the first keeps the original id, the rest are inserted right after it. Use this for any rewrite — text, formatting, or changing the block\'s kind (e.g. paragraph → callout, or one paragraph → a list). Pass empty markdown ("") to remove the block entirely. Preserve any `@[…]` reference tokens verbatim.',
    parameters: {
      type: 'object',
      properties: {
        blockId: { type: 'string', description: 'Id of the block to replace' },
        markdown: {
          type: 'string',
          description:
            'New content as Auxx markdown (may expand to multiple blocks; the first inherits blockId). Empty string removes the block.',
        },
        expectedHash: EXPECTED_HASH_PARAM,
      },
      required: ['blockId', 'markdown'],
      additionalProperties: false,
    },
    validateInputs: async (args) => {
      const id = parseStringArg(args.blockId, { name: 'blockId', required: true, max: 200 })
      if (!id.ok) return { ok: false, error: id.error }
      // markdown is intentionally NOT required — empty markdown removes the block.
      const md = parseStringArg(args.markdown, { name: 'markdown', max: 50_000 })
      if (!md.ok) return { ok: false, error: md.error }
      const expectedHash = parseStringArg(args.expectedHash, { name: 'expectedHash', max: 200 })
      if (!expectedHash.ok) return { ok: false, error: expectedHash.error }
      return {
        ok: true,
        args: {
          ...args,
          blockId: id.value,
          markdown: md.value ?? '',
          expectedHash: expectedHash.value,
        },
      }
    },
    execute: async (args, agentDeps) => {
      const toolDeps = getDeps()
      const result = await runMarkdownReplace({
        agentDeps,
        toolDeps,
        blockId: args.blockId as string,
        markdown: (args.markdown as string | undefined) ?? '',
        expectedHash: args.expectedHash as string | undefined,
      })
      return buildOpToolResult('replace', result)
    },
  }
}
