// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/get-suite-diff.ts

import { z } from 'zod'
import { compareSuiteRuns } from '../../../../../evals/diff'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveProcedureAuthoring } from './procedure-authoring-guard'

const outputSchema = z.object({
  baselineSuiteRunId: z.string(),
  candidateSuiteRunId: z.string(),
  baselineRunMode: z.string(),
  candidateRunMode: z.string(),
  counts: z.record(z.string(), z.number()),
  passRateDelta: z.number().nullable(),
  /** Fixed/regressed flips driven ONLY by judge-graded criteria — possible noise. */
  judgeOnlyFlips: z.number(),
  entries: z.array(
    z.object({
      caseName: z.string(),
      bucket: z.string(),
      flipDriver: z.string().optional(),
      /** `"<type>: <from>→<to>"` per changed assertion. */
      assertionFlips: z.array(z.string()).optional(),
    })
  ),
})

/**
 * Verdict diff between two terminal suite runs (phase 5B primitive, condensed
 * for the model). The fixed/regressed buckets are the proof a build edit
 * worked; judge-only flips can be noise.
 */
export function createGetSuiteDiffTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_suite_diff',
    permission: {
      target: 'area',
      area: 'agents',
      level: 'full',
      enforcement: 'enforced',
      note: 'resolveAgentAuthoring — PermissionKey.agentsManage (the agents area’s only rung) on the caller’s own CapabilitySet, plus an org-scope check on the session agent ref. Enforcement is proven behaviourally by agents-builder/tools/__tests__/agent-authoring-guard.test.ts.',
    },
    displayName: 'Compare suite runs',
    surfaces: ['builder'],
    idempotent: true,
    description: `Compare two finished simulation suite runs: which cases were fixed, which regressed, and which assertions flipped. Use it after a re-run to report the outcome — never claim a fix worked without it. Flips with \`flipDriver: "judge"\` involve only LLM-judged criteria and may be noise; deterministic flips are signal. Both suites must be finished (a running suite is rejected).`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['baselineSuiteRunId', 'candidateSuiteRunId'],
      properties: {
        baselineSuiteRunId: {
          type: 'string',
          minLength: 1,
          description: 'The earlier suite run (usually the one that exposed the failures).',
        },
        candidateSuiteRunId: {
          type: 'string',
          minLength: 1,
          description: 'The newer suite run (usually the post-edit draft re-run).',
        },
      },
    },
    outputSchema,
    exampleOutput: {
      baselineSuiteRunId: 'esr_baseline',
      candidateSuiteRunId: 'esr_candidate',
      baselineRunMode: 'pinned',
      candidateRunMode: 'draft',
      counts: {
        fixed: 2,
        regressed: 0,
        still_failing: 1,
        still_passing: 2,
        incomparable: 0,
        uncompared: 0,
      },
      passRateDelta: 0.4,
      judgeOnlyFlips: 1,
      entries: [
        {
          caseName: 'Refund for damaged item',
          bucket: 'fixed',
          flipDriver: 'deterministic',
          assertionFlips: ['tool_called: failed→passed'],
        },
      ],
    },
    execute: async (args, agentDeps) => {
      const ctx = await resolveProcedureAuthoring(getDeps, agentDeps)
      if (!ctx.ok) return { success: false, output: null, error: ctx.error }

      const baselineSuiteRunId =
        typeof args.baselineSuiteRunId === 'string' ? args.baselineSuiteRunId : ''
      const candidateSuiteRunId =
        typeof args.candidateSuiteRunId === 'string' ? args.candidateSuiteRunId : ''
      if (!baselineSuiteRunId || !candidateSuiteRunId) {
        return {
          success: false,
          output: null,
          error: 'baselineSuiteRunId and candidateSuiteRunId are required.',
        }
      }

      const result = await compareSuiteRuns({
        organizationId: agentDeps.organizationId,
        baselineSuiteRunId,
        candidateSuiteRunId,
      })
      if (result.isErr()) {
        return { success: false, output: null, error: result.error.message }
      }

      const summary = result.value
      return {
        success: true,
        output: {
          baselineSuiteRunId: summary.baselineSuiteRunId,
          candidateSuiteRunId: summary.candidateSuiteRunId,
          baselineRunMode: summary.baselineRunMode,
          candidateRunMode: summary.candidateRunMode,
          counts: summary.counts,
          passRateDelta: summary.passRateDelta,
          judgeOnlyFlips: summary.judgeOnlyFlips,
          entries: summary.entries.map((entry) => ({
            caseName: entry.caseName,
            bucket: entry.bucket,
            ...(entry.flipDriver ? { flipDriver: entry.flipDriver } : {}),
            ...(entry.assertionFlips
              ? {
                  assertionFlips: entry.assertionFlips.map(
                    (flip) => `${flip.type}: ${flip.from}→${flip.to}`
                  ),
                }
              : {}),
          })),
        },
      }
    },
  }
}
