// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/run-node.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { workflowToolPermission } from './graph-tool-helpers'
import { resolveWorkflowAuthoring } from './workflow-authoring-guard'

/**
 * The message the model must relay: since #1555 single-node runs are
 * UNCONDITIONALLY debug/dry runs — side-effecting nodes simulate.
 */
export const SIMULATED_RUN_NOTE =
  'This was a SIMULATED debug run — side-effecting nodes (email, webhooks, record writes) did not perform real actions. Tell the user the result is from a simulation.'

/**
 * Run ONE draft node in isolation (D8) — approval-gated so the user sees a
 * run coming, even though the execution is unconditionally simulated. There
 * is NO full-workflow execution tool at all, deliberately.
 *
 * Guard tier mirrors the tRPC `runSingleNode` procedure exactly: workflowsView
 * area + per-workflow EDIT instance + not-system-owned + the demo-org block.
 */
export function createRunNodeTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'run_node',
    permission: workflowToolPermission('edit'),
    displayName: 'Run workflow node',
    toolsetSlug: 'workflow.builder',
    surfaces: ['builder'],
    requiresApproval: true,
    description:
      'Run ONE node of the open workflow draft as a SIMULATED debug run (side-effecting nodes do not send email, call webhooks, or write records). Upstream nodes are NOT executed — supply every input value the node consumes via `input`, keyed by the `{{…}}` reference it reads. Always tell the user the run was simulated.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Node title (or ref) to run.' },
        input: {
          type: 'object',
          description:
            'Test values for the node’s input references, keyed by reference (e.g. { "Find Contact.record.email": "a@b.co" }). Omitted inputs are undefined at run time.',
        },
      },
      required: ['ref'],
      additionalProperties: false,
    },
    summary: (args) => `Run node: ${typeof args.ref === 'string' ? args.ref : ''} (simulated)`,
    buildDigest: (output) => {
      const out = (output ?? {}) as { status?: string; error?: string | null }
      return {
        label: `Simulated run ${out.status === 'succeeded' ? 'succeeded' : 'failed'}`,
        simulated: true,
        ...(out.error ? { error: String(out.error).slice(0, 200) } : {}),
      }
    },
    execute: async (args, agentDeps) => {
      const auth = await resolveWorkflowAuthoring(getDeps, agentDeps, 'edit')
      if (!auth.ok) return { success: false, output: null, error: auth.error }
      const ref = typeof args.ref === 'string' ? args.ref.trim() : ''
      if (!ref) return { success: false, output: null, error: 'ref is required.' }

      // Demo-org block — parity with the tRPC procedure's `notDemo` middleware.
      // Lazy: DemoGuard rides the permissions/billing module graph.
      const { DemoGuard } = await import('../../../../../demo')
      await DemoGuard.requireNotDemo(agentDeps.organizationId, 'run workflow nodes', false)

      const input =
        args.input && typeof args.input === 'object' && !Array.isArray(args.input)
          ? (args.input as Record<string, unknown>)
          : undefined

      const { db } = getDeps()
      // Lazy import — run-node pulls the execution service's engine module
      // graph; it must never load at import time (see graph-edit/run-node.ts).
      const { runNode } = await import('../../../../../workflows/graph-edit/run-node')
      const result = await runNode(db, {
        workflowAppId: auth.workflowAppId,
        organizationId: agentDeps.organizationId,
        nodeId: ref,
        ...(input ? { input } : {}),
        userId: agentDeps.userId,
      })
      if (result.isErr()) {
        return { success: false, output: null, error: result.error.message }
      }
      const summary = result.value
      return {
        success: true,
        output: {
          simulated: true,
          note: SIMULATED_RUN_NOTE,
          status: summary.status,
          outputs: summary.outputs,
          error: summary.error,
          elapsedTime: summary.elapsedTime,
          ...(summary.validationErrors ? { validationErrors: summary.validationErrors } : {}),
        },
      }
    },
  }
}
