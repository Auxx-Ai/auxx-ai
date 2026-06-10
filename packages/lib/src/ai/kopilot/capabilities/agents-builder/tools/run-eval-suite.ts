// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/run-eval-suite.ts

import { z } from 'zod'
import { startAgentSuiteRun } from '../../../../../evals/start-suite-run'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { EVAL_SUITE_TASK_KIND, type TaskNotificationRef } from '../../../task-notifications'
import type { GetToolDeps } from '../../types'
import { resolveProcedureAuthoring } from './procedure-authoring-guard'

const outputSchema = z.object({
  suiteRunId: z.string(),
  requestedCount: z.number(),
  status: z.literal('running'),
  taskNotification: z.object({ kind: z.string(), ref: z.string() }),
  note: z.string(),
})

/**
 * Fire a simulation suite for the session agent and return immediately with a
 * `taskNotification` ref — the async-task continuation contract
 * (plans/kopilot/task-notifications/plan.md §A). Results arrive as a
 * `<task-notification>` message in a later turn; the model must end its turn
 * after informing the user. `requiresApproval` is the human spend gate AND the
 * burn-loop cap: every edit→rerun cycle has a human click in it.
 */
export function createRunEvalSuiteTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'run_eval_suite',
    displayName: 'Run simulation suite',
    surfaces: ['builder'],
    requiresApproval: true,
    description: `Run this agent's simulation (eval) suite as a background batch. Returns immediately with a suite-run reference — the suite takes minutes.

The results arrive automatically as a \`<task-notification>\` message in a later turn. After calling this tool: tell the user what is running and END YOUR TURN. Never poll for results and never re-run the suite unprompted.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        procedureId: {
          type: 'string',
          description: "Restrict the suite to one procedure's cases. Omit to run every case.",
        },
        caseIds: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description: 'Explicit case ids to run. Omit to run every case under the scope.',
        },
        useDraft: {
          type: 'boolean',
          description:
            'Run against the attached procedure DRAFT instead of the pinned (published) version. Use after editing a procedure to verify the draft before the user publishes.',
        },
        baselineSuiteRunId: {
          type: 'string',
          description:
            'A prior suite run to diff against. Pass the suite that exposed the failures when re-running after an edit, then compare with `get_suite_diff` when the notification arrives.',
        },
      },
    },
    outputSchema,
    exampleOutput: {
      suiteRunId: 'esr_example',
      requestedCount: 5,
      status: 'running',
      taskNotification: { kind: EVAL_SUITE_TASK_KIND, ref: 'esr_example' },
      note: 'Suite is running; results arrive as a task notification.',
    },
    buildDigest: (output) => {
      const o = output as { suiteRunId?: string; requestedCount?: number } | null
      return { suiteRunId: o?.suiteRunId, requestedCount: o?.requestedCount }
    },
    execute: async (args, agentDeps) => {
      // Same contract as the eval tRPC router: agentProcedures feature + admin,
      // and the session agent verified org-scoped. One guard, shared with the
      // procedure-authoring tools.
      const ctx = await resolveProcedureAuthoring(getDeps, agentDeps)
      if (!ctx.ok) return { success: false, output: null, error: ctx.error }

      const procedureId = typeof args.procedureId === 'string' ? args.procedureId : undefined
      const caseIds = Array.isArray(args.caseIds)
        ? args.caseIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : undefined
      const useDraft = args.useDraft === true
      const baselineSuiteRunId =
        typeof args.baselineSuiteRunId === 'string' && args.baselineSuiteRunId.length > 0
          ? args.baselineSuiteRunId
          : undefined

      const started = await startAgentSuiteRun({
        organizationId: agentDeps.organizationId,
        userId: agentDeps.userId,
        agentId: ctx.agentId,
        procedureId,
        caseIds,
        useDraft,
        baselineSuiteRunId,
      })
      if (started.isErr()) {
        return {
          success: false,
          output: null,
          error: `Failed to start eval suite: ${started.error.message}`,
        }
      }

      const taskNotification: TaskNotificationRef = {
        kind: EVAL_SUITE_TASK_KIND,
        ref: started.value.suiteRun.id,
      }
      return {
        success: true,
        output: {
          suiteRunId: started.value.suiteRun.id,
          requestedCount: started.value.requestedCount,
          status: 'running' as const,
          taskNotification,
          note:
            `The suite is running (${started.value.requestedCount} case${started.value.requestedCount === 1 ? '' : 's'}). ` +
            'Results will arrive automatically as a task-notification message — summarize what is running for the user and end your turn.',
        },
      }
    },
  }
}
