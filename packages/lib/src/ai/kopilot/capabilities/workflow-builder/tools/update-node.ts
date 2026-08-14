// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/update-node.ts

import type { ConfigPatch } from '../../../../../workflows/graph-edit'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildWorkflowEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  digestLabelFromOutput,
  mutationToToolResult,
  workflowToolPermission,
} from './graph-tool-helpers'
import { optionalRecord, resolveWorkflowWrite } from './write-tool-helpers'

/** Shallow-merge top-level fields or apply stale-safe deep config patches. */
export function createUpdateNodeTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'update_node',
    permission: workflowToolPermission('edit'),
    displayName: 'Update workflow node',
    surfaces: ['builder'],
    description:
      'Update one node of the open workflow draft. Use `config` for a legacy top-level shallow merge, or `patches` plus the configHash from get_node for atomic deep set/unset edits that preserve nested siblings. Pass exactly one mode. Patch paths are arrays of field names and numeric array indexes.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Node title (or ref) to update.' },
        config: {
          type: 'object',
          description:
            'Top-level friendly config fields to shallow-merge; {{Title.path}} refs welcome.',
        },
        expectedConfigHash: {
          type: 'string',
          description: 'Opaque configHash from get_node; required with patches.',
        },
        patches: {
          type: 'array',
          minItems: 1,
          description:
            'Atomic deep edits to the complete friendly config returned by get_node. Every parent must exist; set may create the final object field.',
          items: {
            oneOf: [
              {
                type: 'object',
                properties: {
                  op: { const: 'set' },
                  path: {
                    type: 'array',
                    minItems: 1,
                    items: { oneOf: [{ type: 'string' }, { type: 'integer', minimum: 0 }] },
                  },
                  value: {},
                },
                required: ['op', 'path', 'value'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  op: { const: 'unset' },
                  path: {
                    type: 'array',
                    minItems: 1,
                    items: { oneOf: [{ type: 'string' }, { type: 'integer', minimum: 0 }] },
                  },
                },
                required: ['op', 'path'],
                additionalProperties: false,
              },
            ],
          },
        },
      },
      required: ['ref'],
      additionalProperties: false,
    },
    summary: (args) => `Update node: ${typeof args.ref === 'string' ? args.ref : ''}`,
    buildDigest: (output) =>
      buildWorkflowEditDigest(digestLabelFromOutput(output, 'Updated node'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveWorkflowWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const ref = typeof args.ref === 'string' ? args.ref.trim() : ''
      if (!ref) return { success: false, output: null, error: 'ref is required.' }

      const hasConfig = args.config !== undefined
      const hasPatches = args.patches !== undefined
      if (hasConfig === hasPatches) {
        return {
          success: false,
          output: null,
          error: 'Pass exactly one of config or patches.',
        }
      }
      const config = hasConfig ? optionalRecord(args.config) : undefined
      if (hasConfig && !config) {
        return { success: false, output: null, error: 'config must be an object.' }
      }
      const patches =
        hasPatches && Array.isArray(args.patches) ? (args.patches as ConfigPatch[]) : []
      const expectedConfigHash =
        typeof args.expectedConfigHash === 'string' ? args.expectedConfigHash.trim() : ''
      if (hasPatches && (patches.length === 0 || !expectedConfigHash)) {
        return {
          success: false,
          output: null,
          error: 'patches must be non-empty and expectedConfigHash is required.',
        }
      }
      if (hasConfig && args.expectedConfigHash !== undefined) {
        return {
          success: false,
          output: null,
          error: 'expectedConfigHash is only used with patches.',
        }
      }

      const { db } = getDeps()
      // Lazy import — see get-workflow.ts.
      const { updateNode } = await import('../../../../../workflows/graph-edit')
      const result = hasPatches
        ? await updateNode(db, {
            ...write.scope,
            ref,
            patches,
            expectedConfigHash,
          })
        : await updateNode(db, {
            ...write.scope,
            ref,
            config: config!,
          })
      return mutationToToolResult(result, (value) =>
        value.applied ? `Updated ${value.node?.title ?? ref}` : `Update ${ref} blocked`
      )
    },
  }
}
