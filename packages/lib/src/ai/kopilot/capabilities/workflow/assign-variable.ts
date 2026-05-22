// packages/lib/src/ai/kopilot/capabilities/workflow/assign-variable.ts

import type { AgentToolDefinition } from '../../../agent-framework/types'
import type { GetToolDeps } from '../types'
import { WORKFLOW_NATIVE_TOOLSET_SLUG } from './index'

/**
 * Native workflow tool — set a variable on the active workflow run's context
 * so downstream nodes (and later iterations of the same AI node) can read it.
 *
 * The tool is intentionally minimal: it forwards to
 * `ctx.workflow.contextManager.assignVariable(name, value)` and never touches
 * the DB. The workflow engine threads `ctx.workflow` through at call time —
 * outside a workflow run, the tool returns a clean `success: false` payload
 * instead of throwing so the model gets an actionable signal.
 */
export function assignVariableTool(_deps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'assign_variable',
    displayName: 'Assign variable',
    description:
      'Set a workflow variable so downstream nodes can read it. ' +
      'Use this when the user asks to remember a value for later steps.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Variable name; alphanumeric + underscore.',
        },
        value: {
          description: 'Any JSON-serializable value.',
        },
      },
      required: ['name', 'value'],
      additionalProperties: false,
    },
    idempotent: false,
    toolsetSlug: WORKFLOW_NATIVE_TOOLSET_SLUG,
    buildDigest: (output) => {
      const out = (output ?? {}) as { name?: string }
      return { kind: 'assign-variable', name: out.name ?? '' }
    },
    execute: async (args, ctx) => {
      const { name, value } = args as { name: string; value: unknown }
      if (!ctx.workflow) {
        return {
          success: false,
          output: { error: 'assign_variable called outside a workflow context' },
        }
      }
      ctx.workflow.contextManager.assignVariable(name, value)
      return { success: true, output: { name, value } }
    },
  }
}
