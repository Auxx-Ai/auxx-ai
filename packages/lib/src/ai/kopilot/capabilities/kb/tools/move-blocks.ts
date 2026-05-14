// packages/lib/src/ai/kopilot/capabilities/kb/tools/move-blocks.ts

import type { BlockAnchor } from '../../../../../kb/blocks/patch-types'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { buildOpToolResult, runBlockCrudOp } from './write-helpers'

export function createMoveBlocksTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'move_blocks',
    toolsetSlug: 'kb.editor',
    description:
      'Move one or more blocks (by id) to a new anchor. Plucks the blocks from wherever they are (top-level, panels, or cells) and inserts them at the anchor in the requested order. Anchor shape matches insert_blocks.',
    parameters: {
      type: 'object',
      properties: {
        blockIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Block ids to move (output order is preserved)',
        },
        anchor: {
          type: 'object',
          description:
            "Where to drop them: { at: 'start'|'end' } | { at: 'before'|'after', blockId } | { at: 'startOf'|'endOf', containerId }",
          additionalProperties: true,
        },
      },
      required: ['blockIds', 'anchor'],
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
      const anchor = args.anchor as BlockAnchor | undefined
      if (!anchor || typeof anchor !== 'object' || typeof anchor.at !== 'string') {
        return { ok: false, error: 'anchor must be { at, blockId? | containerId? }' }
      }
      return { ok: true, args }
    },
    execute: async (args, agentDeps) => {
      const toolDeps = getDeps()
      const blockIds = args.blockIds as string[]
      const anchor = args.anchor as BlockAnchor
      const result = await runBlockCrudOp({
        agentDeps,
        toolDeps,
        patch: { op: 'move', blockIds, anchor },
        opIndex: 0,
      })
      return buildOpToolResult('move', result)
    },
  }
}
