// packages/lib/src/ai/kopilot/capabilities/workflow/assign-variable.ts

import { z } from 'zod'
import type { AgentToolDefinition } from '../../../agent-framework/types'
import type { GetToolDeps } from '../types'
import { WORKFLOW_NATIVE_TOOLSET_SLUG } from './index'

/** Success output of `assign_variable` — the assigned name and its arbitrary value. */
const AssignVariableOutput = z.object({
  name: z.string(),
  value: z.unknown(),
})

/**
 * Native workflow tool — set a variable on the active workflow run's context
 * so downstream nodes (and later iterations of the same AI node) can read it.
 *
 * The tool is intentionally minimal: it forwards to `ctx.context.write` and
 * never touches the DB. `ctx.context` is always present (chat v9) — a workflow
 * AI node's ctx carries the run's `ExecutionContextManager`, so the value lands
 * on the workflow's variables for downstream nodes; chat / internal runs write
 * to their `var:*` scratch instead. Works the same everywhere.
 */
export function assignVariableTool(_deps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'assign_variable',
    permission: {
      target: 'none',
      note: 'Workflow plumbing: writes a variable into the active run’s execution context. Reach is bounded by the workflow the node already runs inside.',
    },
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
    outputSchema: AssignVariableOutput,
    toolsetSlug: WORKFLOW_NATIVE_TOOLSET_SLUG,
    buildDigest: (output) => {
      const out = (output ?? {}) as { name?: string }
      return { kind: 'assign-variable', name: out.name ?? '' }
    },
    execute: async (args, ctx) => {
      const { name, value } = args as { name: string; value: unknown }
      await ctx.context.write(`var:${name}`, value)
      return { success: true, output: { name, value } }
    },
  }
}
