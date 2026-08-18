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
      'Update one node of the open workflow draft. TWO modes, pass exactly one: (1) `patches` — atomic deep set/unset that preserves nested siblings; this is the default choice. (2) `config` — a shallow merge of TOP-LEVEL fields only (title, simple scalars). `expectedConfigHash` is optional with either mode: pass the configHash from your last read and the edit is rejected if the node changed underneath you; omit it and the edit still applies. The result carries the node back with its new configHash — do not re-read it.',
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
          description:
            'Optional optimistic-concurrency token: the opaque configHash from the get_node ' +
            'or mutation result this edit was chosen against. Checked when given.',
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
      if (hasPatches && patches.length === 0) {
        return { success: false, output: null, error: 'patches must contain at least one edit.' }
      }
      const expectedConfigHash =
        typeof args.expectedConfigHash === 'string' ? args.expectedConfigHash.trim() : ''

      // Everything hash-shaped is enforced in lib, where the node — and so its
      // CURRENT hash — is in hand and can ride the error message. Checking it
      // up here could only ever say "no", never "here is the right value".
      const { db } = getDeps()
      // Lazy import — see get-workflow.ts.
      const { updateNode } = await import('../../../../../workflows/graph-edit')
      const result = await updateNode(db, {
        ...write.scope,
        ref,
        ...(hasPatches ? { patches } : { config: config as Record<string, unknown> }),
        ...(expectedConfigHash ? { expectedConfigHash } : {}),
      })
      return mutationToToolResult(result, (value) =>
        value.applied ? `Updated ${value.node?.title ?? ref}` : `Update ${ref} blocked`
      )
    },
  }
}
