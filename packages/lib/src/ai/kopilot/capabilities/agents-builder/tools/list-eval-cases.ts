// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/list-eval-cases.ts

import { z } from 'zod'
import { getLatestRunsByCaseIds, listEvalCasesByAgent } from '../../../../../evals/queries'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveProcedureAuthoring } from './procedure-authoring-guard'

const outputSchema = z.object({
  cases: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      scope: z.string(),
      procedureId: z.string().nullable(),
      /** Assertion count per assertion type. */
      assertionCounts: z.record(z.string(), z.number()),
      latestRun: z
        .object({ runId: z.string(), status: z.string(), runMode: z.string() })
        .optional(),
      /** Present when the latest run is a draft run — the authoritative pinned verdict. */
      latestPinnedRun: z.object({ runId: z.string(), status: z.string() }).optional(),
    })
  ),
  total: z.number(),
})

/**
 * Read-only listing of the session agent's eval cases with last-run status —
 * the entry point of the eval-driven improvement loop (phase 5C). Draft runs
 * never displace the pinned verdict: when the latest run is a draft, the
 * latest pinned run rides along (5A.5 last-verified semantics).
 */
export function createListEvalCasesTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_eval_cases',
    permission: {
      target: 'area',
      area: 'agents',
      level: 'admin',
      enforcement: 'enforced',
      note: 'resolveAgentAuthoring — PermissionKey.agentsManage (the agents area’s only rung) on the caller’s own CapabilitySet, plus an org-scope check on the session agent ref. Enforcement is proven behaviourally by agents-builder/tools/__tests__/agent-authoring-guard.test.ts.',
    },
    displayName: 'List simulation cases',
    surfaces: ['builder'],
    idempotent: true,
    description: `List this agent's simulation (eval) cases with their latest run status. Use it to find failing cases before proposing fixes; pull a failing run's detail with \`get_eval_run\`. When the latest run is a draft run, \`latestPinnedRun\` carries the authoritative published-version verdict.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        procedureId: {
          type: 'string',
          description: "Restrict to one procedure's cases. Omit for every case on the agent.",
        },
      },
    },
    outputSchema,
    exampleOutput: {
      cases: [
        {
          id: 'case_example',
          name: 'Refund for damaged item',
          scope: 'procedure',
          procedureId: 'proc_example',
          assertionCounts: { terminal_outcome: 1, response_criteria: 2 },
          latestRun: { runId: 'run_example', status: 'failed', runMode: 'draft' },
          latestPinnedRun: { runId: 'run_example_pinned', status: 'passed' },
        },
      ],
      total: 1,
    },
    execute: async (args, agentDeps) => {
      const ctx = await resolveProcedureAuthoring(getDeps, agentDeps, 'view')
      if (!ctx.ok) return { success: false, output: null, error: ctx.error }

      const procedureId = typeof args.procedureId === 'string' ? args.procedureId : undefined
      const listed = await listEvalCasesByAgent({
        organizationId: agentDeps.organizationId,
        agentId: ctx.agentId,
        procedureId,
      })
      if (listed.isErr()) {
        return { success: false, output: null, error: 'Failed to list eval cases.' }
      }

      const latest = await getLatestRunsByCaseIds({
        organizationId: agentDeps.organizationId,
        caseIds: listed.value.map((c) => c.id),
      })
      const latestByCase = new Map((latest.isOk() ? latest.value : []).map((r) => [r.caseId, r]))

      const cases = listed.value.map((row) => {
        const target = row.target as { scope?: string } | null
        const assertionCounts: Record<string, number> = {}
        for (const assertion of row.assertions as { type?: string }[]) {
          if (typeof assertion?.type !== 'string') continue
          assertionCounts[assertion.type] = (assertionCounts[assertion.type] ?? 0) + 1
        }
        const latestRun = latestByCase.get(row.id)
        return {
          id: row.id,
          name: row.name,
          scope: target?.scope ?? 'procedure',
          procedureId: row.procedureId,
          assertionCounts,
          ...(latestRun
            ? {
                latestRun: {
                  runId: latestRun.runId,
                  status: latestRun.status,
                  runMode: latestRun.runMode,
                },
              }
            : {}),
          ...(latestRun?.latestPinned
            ? {
                latestPinnedRun: {
                  runId: latestRun.latestPinned.runId,
                  status: latestRun.latestPinned.status,
                },
              }
            : {}),
        }
      })

      return { success: true, output: { cases, total: cases.length } }
    },
  }
}
