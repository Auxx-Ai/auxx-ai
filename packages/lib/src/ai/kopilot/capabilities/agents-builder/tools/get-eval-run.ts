// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/get-eval-run.ts

import { z } from 'zod'
import { summarizeEvalRunForModel } from '../../../../../evals/model-summary'
import { getEvalRun } from '../../../../../evals/queries'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveProcedureAuthoring } from './procedure-authoring-guard'

const outputSchema = z.object({
  runId: z.string(),
  status: z.string(),
  runMode: z.string(),
  caseId: z.string().nullable(),
  caseName: z.string(),
  failedAssertions: z.array(
    z.object({
      assertionId: z.string(),
      type: z.string(),
      status: z.string(),
      definition: z.unknown(),
      actual: z.unknown().optional(),
      note: z.string().optional(),
    })
  ),
  transcript: z.string(),
  truncated: z.boolean(),
})

/**
 * Read one eval run as a model-facing condensation: chronological transcript
 * lines + failed assertions, never the raw trace envelope or any runtime
 * snapshot internals (phase 5C.2).
 */
export function createGetEvalRunTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_eval_run',
    displayName: 'Read simulation run',
    surfaces: ['builder'],
    idempotent: true,
    description: `Read a simulation run's condensed transcript and failed assertions. Use it to ground a proposed fix in the SPECIFIC failing turn or assertion — cite the case name and what failed. \`truncated: true\` means the middle of a long transcript was dropped. \`caseId\` is what you pass to \`run_eval_suite\`'s \`caseIds\` for a targeted re-run.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['runId'],
      properties: {
        runId: { type: 'string', minLength: 1, description: 'The eval run id to read.' },
      },
    },
    outputSchema,
    exampleOutput: {
      runId: 'run_example',
      status: 'failed',
      runMode: 'draft',
      caseId: 'case_example',
      caseName: 'Refund for damaged item',
      failedAssertions: [
        {
          assertionId: 'a1',
          type: 'response_criteria',
          status: 'failed',
          definition: { criteria: ['Confirms the refund timeline'] },
          note: 'The agent never stated when the refund lands.',
        },
      ],
      transcript:
        'Customer: My mug arrived broken, I want a refund.\nAgent: Sorry to hear that! Let me check the order.\ntool order_lookup({"orderId":"1001"}) → ok [mocked]\nAgent: I have issued the refund.\n[terminal] outcome=finished capExceeded=false customerTurns=1',
      truncated: false,
    },
    execute: async (args, agentDeps) => {
      const ctx = await resolveProcedureAuthoring(getDeps, agentDeps)
      if (!ctx.ok) return { success: false, output: null, error: ctx.error }

      const runId = typeof args.runId === 'string' ? args.runId : ''
      if (!runId) return { success: false, output: null, error: 'runId is required.' }

      const run = await getEvalRun({ organizationId: agentDeps.organizationId, runId })
      if (run.isErr() || !run.value) {
        return { success: false, output: null, error: `Eval run not found: ${runId}` }
      }

      return { success: true, output: summarizeEvalRunForModel(run.value) }
    },
  }
}
