// packages/lib/src/ai/kopilot/capabilities/kb/tools/delete-blocks.ts

import { parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { buildOpToolResult, EXPECTED_HASH_PARAM, runBlockCrudOp } from './write-helpers'

export function createDeleteBlocksTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'delete_blocks',
    displayName: 'Delete article blocks',
    toolsetSlug: 'auxx:kb:write',
    exampleOutput: {
      ok: true,
      op: 'delete',
      articleId: 'art_4Kp9wZ',
      preHash: 'a1b2c3d4e5f60718',
      postHash: 'f0e1d2c3b4a59687',
      affectedBlockIds: ['b7', 'b8'],
    },
    description:
      'Delete one or more blocks by id. Operates wherever each block lives (top-level, inside a panel, or inside a table cell). Throws if any id is missing — partial deletes never happen.',
    parameters: {
      type: 'object',
      properties: {
        blockIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Block ids to delete',
        },
        expectedHash: EXPECTED_HASH_PARAM,
      },
      required: ['blockIds'],
      additionalProperties: false,
    },
    validateInputs: async (args) => {
      const ids = args.blockIds
      if (!Array.isArray(ids) || ids.length === 0) {
        return { ok: false, error: 'blockIds must be a non-empty array' }
      }
      for (let i = 0; i < ids.length; i++) {
        if (typeof ids[i] !== 'string' || (ids[i] as string).length === 0) {
          return { ok: false, error: `blockIds[${i}] must be a non-empty string` }
        }
      }
      const expectedHash = parseStringArg(args.expectedHash, { name: 'expectedHash', max: 200 })
      if (!expectedHash.ok) return { ok: false, error: expectedHash.error }
      return { ok: true, args: { ...args, expectedHash: expectedHash.value } }
    },
    execute: async (args, agentDeps) => {
      const toolDeps = getDeps()
      const blockIds = args.blockIds as string[]
      const result = await runBlockCrudOp({
        agentDeps,
        toolDeps,
        patch: { op: 'delete', blockIds },
        opIndex: 0,
        expectedHash: args.expectedHash as string | undefined,
      })
      return buildOpToolResult('delete', result)
    },
  }
}
