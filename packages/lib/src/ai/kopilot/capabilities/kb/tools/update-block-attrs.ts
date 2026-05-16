// packages/lib/src/ai/kopilot/capabilities/kb/tools/update-block-attrs.ts

import { parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { buildOpToolResult, runBlockCrudOp } from './write-helpers'

export function createUpdateBlockAttrsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'update_block_attrs',
    displayName: 'Update article attrs',
    toolsetSlug: 'kb.write',
    description:
      "Merge a partial attrs object into a block by id. Use to flip calloutVariant ('info'/'warn'/'error'/'tip'/'success'), set heading level, change codeLanguage, swap embed url, etc. The block's id is never overwritten.",
    parameters: {
      type: 'object',
      properties: {
        blockId: { type: 'string', description: 'Id of the block to update' },
        attrs: {
          type: 'object',
          description: 'Partial attrs to merge (id is silently dropped)',
          additionalProperties: true,
        },
      },
      required: ['blockId', 'attrs'],
      additionalProperties: false,
    },
    validateInputs: async (args) => {
      const id = parseStringArg(args.blockId, { name: 'blockId', required: true, max: 200 })
      if (!id.ok) return { ok: false, error: id.error }
      if (!args.attrs || typeof args.attrs !== 'object') {
        return { ok: false, error: 'attrs must be an object' }
      }
      return { ok: true, args: { ...args, blockId: id.value } }
    },
    execute: async (args, agentDeps) => {
      const toolDeps = getDeps()
      const blockId = args.blockId as string
      const attrs = args.attrs as Record<string, unknown>
      const result = await runBlockCrudOp({
        agentDeps,
        toolDeps,
        patch: { op: 'updateAttrs', blockId, attrs },
        opIndex: 0,
      })
      return buildOpToolResult('updateAttrs', result)
    },
  }
}
