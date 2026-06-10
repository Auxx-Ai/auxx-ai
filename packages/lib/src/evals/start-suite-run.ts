// packages/lib/src/evals/start-suite-run.ts
//
// The suite-start recipe shared by the `eval.runAll` tRPC mutation and the
// Kopilot `run_eval_suite` tool: resolve the selected cases, build snapshots,
// atomically create the suite + queued children, then enqueue each child.
// Permission/feature gating stays in the callers. Deliberately NOT exported
// from ./index — it pulls the BullMQ enqueue path (same split as ./worker).

import type { EvalSuiteRunEntity } from '@auxx/database'
import type { EvalRunMode } from '@auxx/types/evals'
import {
  agentEvalAssertionsSchema,
  agentEvalTargetSchema,
  simulationConfigSchema,
} from '@auxx/types/evals/schema'
import { err, ok, type Result } from 'neverthrow'
import { failQueuedEvalRun } from './lifecycle'
import { prepareRunSnapshots } from './prepare-run'
import { createSuiteRunWithChildren, getEvalSuiteRun, listEvalCasesByAgent } from './queries'
import type { EvalServiceError } from './types'
import { enqueueEvalRun } from './worker/enqueue-eval-run'

export interface StartAgentSuiteRunInput {
  organizationId: string
  userId: string
  agentId: string
  /** Restrict the selection to one procedure's cases. */
  procedureId?: string
  /** Explicit case ids; omit to run every case under the scope. */
  caseIds?: string[]
  /** Run the attached draft instead of the pinned version (regression gate). */
  useDraft?: boolean
  /** Prior suite to diff against (verdict diff, phase-5b). Validated org-scoped here. */
  baselineSuiteRunId?: string
}

export interface StartAgentSuiteRunResult {
  suiteRun: EvalSuiteRunEntity
  runIds: string[]
  requestedCount: number
}

/**
 * Start a suite run for an agent. Mirrors the original `eval.runAll` body:
 * a per-child enqueue failure fails that child only (`failQueuedEvalRun`
 * drives it terminal so suite counters still converge).
 */
export async function startAgentSuiteRun(
  input: StartAgentSuiteRunInput
): Promise<Result<StartAgentSuiteRunResult, EvalServiceError>> {
  const { organizationId, userId } = input

  if (input.baselineSuiteRunId) {
    const baseline = await getEvalSuiteRun({
      organizationId,
      suiteRunId: input.baselineSuiteRunId,
    })
    if (baseline.isErr()) return err(baseline.error)
    if (!baseline.value) {
      return err({
        code: 'EVAL_VALIDATION',
        message: `Baseline suite run not found: ${input.baselineSuiteRunId}`,
      })
    }
  }

  const listed = await listEvalCasesByAgent({
    organizationId,
    agentId: input.agentId,
    procedureId: input.procedureId,
  })
  if (listed.isErr()) return err(listed.error)

  const selected = input.caseIds
    ? listed.value.filter((c) => input.caseIds?.includes(c.id))
    : listed.value
  if (selected.length === 0) {
    return err({ code: 'EVAL_VALIDATION', message: 'No eval cases selected' })
  }

  // Build snapshots for every case BEFORE the transaction.
  const children: {
    caseId: string
    definitionSnapshot: unknown
    runtimeSnapshot: unknown
    runMode: EvalRunMode
  }[] = []
  let draftContentHash: string | null = null
  for (const row of selected) {
    let parsedCase: Parameters<typeof prepareRunSnapshots>[0]['case']
    try {
      parsedCase = {
        id: row.id,
        name: row.name,
        createdAt: row.createdAt.toISOString(),
        target: agentEvalTargetSchema.parse(row.target),
        config: simulationConfigSchema.parse(row.config),
        assertions: agentEvalAssertionsSchema.parse(row.assertions),
      }
    } catch (cause) {
      return err({
        code: 'EVAL_VALIDATION',
        message: `Eval case ${row.id} has an invalid payload`,
        cause,
      })
    }

    const prepared = await prepareRunSnapshots({
      organizationId,
      userId,
      case: parsedCase,
      mode: input.useDraft ? 'draft' : 'pinned',
    })
    if (prepared.isErr()) return err(prepared.error)
    // The snapshot's runMode is the truth: a draft REQUEST still runs pinned
    // when no draft is attached (resolveDraftProcedure fallback) or for
    // agent-scope cases (v1 punt) — the denormalized column must match.
    children.push({
      caseId: row.id,
      definitionSnapshot: prepared.value.definitionSnapshot,
      runtimeSnapshot: prepared.value.runtimeSnapshot,
      runMode: prepared.value.runtimeSnapshot.runMode,
    })
    draftContentHash ??= prepared.value.runtimeSnapshot.draftContentHash ?? null
  }

  const ranAnyDraft = children.some((c) => c.runMode === 'draft')

  const created = await createSuiteRunWithChildren({
    organizationId,
    kind: 'agent_simulation',
    createdById: userId,
    selectionSnapshot: { caseIds: selected.map((c) => c.id) },
    runMode: ranAnyDraft ? 'draft' : 'pinned',
    draftContentHash: ranAnyDraft ? draftContentHash : null,
    agentId: input.agentId,
    procedureId: input.procedureId ?? null,
    baselineSuiteRunId: input.baselineSuiteRunId ?? null,
    children,
  })
  if (created.isErr()) return err(created.error)

  // Enqueue each child; a per-child enqueue failure fails that child only.
  for (const run of created.value.runs) {
    try {
      await enqueueEvalRun({ organizationId, userId, runId: run.id })
    } catch (error) {
      await failQueuedEvalRun({
        runId: run.id,
        errorCode: 'ENQUEUE_FAILED',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return ok({
    suiteRun: created.value.suiteRun,
    runIds: created.value.runs.map((r) => r.id),
    requestedCount: created.value.runs.length,
  })
}
