// packages/lib/src/ai/kopilot/capabilities/kb/tools/delete-blocks.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { buildOpToolResult, runBlockCrudOp } from './write-helpers'

export function createDeleteBlocksTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'delete_blocks',
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
      return { ok: true, args }
    },
    execute: async (args, agentDeps) => {
      const toolDeps = getDeps()
      const blockIds = args.blockIds as string[]
      const result = await runBlockCrudOp({
        agentDeps,
        toolDeps,
        patch: { op: 'delete', blockIds },
        opIndex: 0,
      })
      return buildOpToolResult('delete', result)
    },
  }
}
