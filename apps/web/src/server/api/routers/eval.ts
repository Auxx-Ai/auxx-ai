// apps/web/src/server/api/routers/eval.ts

import type { EvalCaseEntity } from '@auxx/database'
import {
  cancelEvalRun,
  compareSuiteRuns,
  createEvalCase,
  createQueuedEvalRun,
  deleteEvalCase,
  deleteEvalRun,
  failQueuedEvalRun,
  getEvalCaseById,
  getEvalRun,
  getEvalRunCredits,
  getEvalSuiteRun,
  getLatestRunsByCaseIds,
  listAgentEffectiveTools,
  listEvalCasesByAgent,
  listEvalRuns,
  listEvalSuiteRuns,
  listSuiteChildRunSummaries,
  prepareRunSnapshots,
  suggestAgentSimulations,
  updateEvalCase,
  validateAgentToolMock,
  validateEvalCase,
} from '@auxx/lib/evals'
import { startAgentSuiteRun } from '@auxx/lib/evals/start-suite-run'
import { enqueueEvalRun } from '@auxx/lib/evals/worker'
import { FeaturePermissionService } from '@auxx/lib/permissions'
import { FeatureKey } from '@auxx/lib/permissions/client'
import {
  agentEvalAssertionsSchema,
  agentEvalTargetSchema,
  simulationConfigSchema,
} from '@auxx/types/evals/schema'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '../trpc'
import { unwrap } from '../unwrap'

/** adminProcedure + the `agentProcedures` feature gate (evals exercise procedures). */
const evalAdminProcedure = adminProcedure.use(async ({ ctx, next }) => {
  await new FeaturePermissionService().requireAccess(
    ctx.session.organizationId,
    FeatureKey.agentProcedures
  )
  return next()
})

/** Parse a persisted case row's JSONB into typed, validated fields. */
function parseCase(row: EvalCaseEntity) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    target: agentEvalTargetSchema.parse(row.target),
    config: simulationConfigSchema.parse(row.config),
    assertions: agentEvalAssertionsSchema.parse(row.assertions),
  }
}

export const evalRouter = createTRPCRouter({
  // ── Case CRUD ───────────────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({ agentId: z.string().min(1), procedureId: z.string().min(1).optional() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const cases = unwrap(
        await listEvalCasesByAgent({
          organizationId,
          agentId: input.agentId,
          procedureId: input.procedureId,
        }),
        'list eval cases'
      )

      // One extra query attaches each case's most recent run (status pill + last-run time).
      const latest = unwrap(
        await getLatestRunsByCaseIds({ organizationId, caseIds: cases.map((c) => c.id) }),
        'list latest eval runs'
      )
      const byCase = new Map(latest.map((r) => [r.caseId, r]))

      return cases.map((row) => {
        const target = agentEvalTargetSchema.parse(row.target)
        const run = byCase.get(row.id)
        return {
          id: row.id,
          name: row.name,
          scope: target.scope,
          procedureId: target.scope === 'procedure' ? target.procedureId : null,
          // Provenance for client-side dedup of already-accepted suggestions.
          suggestionId: row.suggestionId ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          latestRun: run
            ? {
                runId: run.runId,
                status: run.status,
                runMode: run.runMode,
                at: (run.completedAt ?? run.createdAt).toISOString(),
              }
            : null,
          // Last-verified: when the latest run is a draft run, the most recent
          // PINNED run stays the authoritative status (5A.5).
          latestPinnedRun: run?.latestPinned
            ? {
                runId: run.latestPinned.runId,
                status: run.latestPinned.status,
                at: (run.latestPinned.completedAt ?? run.latestPinned.createdAt).toISOString(),
              }
            : null,
        }
      })
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const found = unwrap(
        await getEvalCaseById({ organizationId: ctx.session.organizationId, id: input.id }),
        'get eval case'
      )
      if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval case not found' })
      return parseCase(found)
    }),

  create: evalAdminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        target: agentEvalTargetSchema,
        config: simulationConfigSchema,
        assertions: agentEvalAssertionsSchema,
        /** Provenance when the case was accepted from a suggestion. */
        suggestionId: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const created = unwrap(
        await createEvalCase({
          organizationId: ctx.session.organizationId,
          createdById: ctx.session.userId,
          name: input.name,
          target: input.target,
          config: input.config,
          assertions: input.assertions,
          suggestionId: input.suggestionId,
        }),
        'create eval case'
      )
      return { id: created.id }
    }),

  update: evalAdminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        patch: z.object({
          name: z.string().min(1).optional(),
          target: agentEvalTargetSchema.optional(),
          config: simulationConfigSchema.optional(),
          assertions: agentEvalAssertionsSchema.optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updated = unwrap(
        await updateEvalCase({
          organizationId: ctx.session.organizationId,
          id: input.id,
          patch: input.patch,
        }),
        'update eval case'
      )
      return { id: updated.id }
    }),

  delete: evalAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      unwrap(
        await deleteEvalCase({ organizationId: ctx.session.organizationId, id: input.id }),
        'delete eval case'
      )
      return { ok: true as const }
    }),

  // ── Editor support (tool responses) ───────────────────────────────────────
  agentToolset: protectedProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const tools = await listAgentEffectiveTools({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        agentId: input.agentId,
      })
      return { tools }
    }),

  validateMock: protectedProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        toolName: z.string().min(1),
        output: z.unknown(),
      })
    )
    .query(async ({ ctx, input }) =>
      validateAgentToolMock({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        agentId: input.agentId,
        toolName: input.toolName,
        output: input.output,
      })
    ),

  // ── Validation ──────────────────────────────────────────────────────────
  validate: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const found = unwrap(
        await getEvalCaseById({ organizationId: ctx.session.organizationId, id: input.id }),
        'get eval case'
      )
      if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval case not found' })
      const parsed = parseCase(found)
      return validateEvalCase({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        target: parsed.target,
        config: parsed.config,
        assertions: parsed.assertions,
      })
    }),

  // ── Runs ──────────────────────────────────────────────────────────────────
  listRuns: protectedProcedure
    .input(z.object({ caseId: z.string().min(1), cursor: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const limit = 20
      const runs = unwrap(
        await listEvalRuns({
          organizationId: ctx.session.organizationId,
          caseId: input.caseId,
          limit: limit + 1,
          before: input.cursor ? new Date(input.cursor) : undefined,
        }),
        'list eval runs'
      )
      const hasMore = runs.length > limit
      const page = hasMore ? runs.slice(0, limit) : runs
      const nextCursor = hasMore ? page[page.length - 1]?.createdAt.toISOString() : undefined
      return { runs: page, nextCursor }
    }),

  getRun: protectedProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const run = unwrap(
        await getEvalRun({ organizationId: ctx.session.organizationId, runId: input.runId }),
        'get eval run'
      )
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval run not found' })
      return run
    }),

  /** AI credits + tokens a single eval run consumed (rolled up from AiUsage). */
  getRunCredits: protectedProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return unwrap(
        await getEvalRunCredits({
          organizationId: ctx.session.organizationId,
          runId: input.runId,
        }),
        'get eval run credits'
      )
    }),

  getSuiteRun: protectedProcedure
    .input(z.object({ suiteRunId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const suite = unwrap(
        await getEvalSuiteRun({
          organizationId: ctx.session.organizationId,
          suiteRunId: input.suiteRunId,
        }),
        'get eval suite run'
      )
      if (!suite) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval suite run not found' })
      return suite
    }),

  /** Iteration-history feed: suite runs for an agent (optionally one procedure), newest first. */
  listSuiteRuns: protectedProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        procedureId: z.string().min(1).optional(),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const limit = 20
      const suiteRuns = unwrap(
        await listEvalSuiteRuns({
          organizationId: ctx.session.organizationId,
          agentId: input.agentId,
          procedureId: input.procedureId,
          limit: limit + 1,
          before: input.cursor ? new Date(input.cursor) : undefined,
        }),
        'list eval suite runs'
      )
      const hasMore = suiteRuns.length > limit
      const page = hasMore ? suiteRuns.slice(0, limit) : suiteRuns
      const nextCursor = hasMore ? page[page.length - 1]?.createdAt.toISOString() : undefined
      return { suiteRuns: page, nextCursor }
    }),

  /** Child runs of a suite without trace/snapshot payloads (suite detail view). */
  listSuiteChildRuns: protectedProcedure
    .input(z.object({ suiteRunId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return unwrap(
        await listSuiteChildRunSummaries({
          organizationId: ctx.session.organizationId,
          suiteRunId: input.suiteRunId,
        }),
        'list suite child runs'
      )
    }),

  /** Verdict diff of two terminal suites (5B). Read-only; computed on request. */
  compareSuiteRuns: protectedProcedure
    .input(
      z.object({
        baselineSuiteRunId: z.string().min(1),
        candidateSuiteRunId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await compareSuiteRuns({
        organizationId: ctx.session.organizationId,
        baselineSuiteRunId: input.baselineSuiteRunId,
        candidateSuiteRunId: input.candidateSuiteRunId,
      })
      if (result.isErr()) {
        const code =
          result.error.code === 'EVAL_SUITE_RUN_NOT_FOUND'
            ? 'NOT_FOUND'
            : result.error.code === 'SUITE_NOT_TERMINAL'
              ? 'PRECONDITION_FAILED'
              : 'INTERNAL_SERVER_ERROR'
        throw new TRPCError({ code, message: result.error.message })
      }
      return result.value
    }),

  // ── Execute ───────────────────────────────────────────────────────────────
  run: evalAdminProcedure
    // `useDraft`: run the current draft (the Simulations editor surface always
    // passes true); headless/CI default to the pinned version (regression gate).
    .input(z.object({ id: z.string().min(1), useDraft: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const found = unwrap(await getEvalCaseById({ organizationId, id: input.id }), 'get eval case')
      if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval case not found' })
      const parsed = parseCase(found)

      const prepared = await prepareRunSnapshots({
        organizationId,
        userId,
        case: parsed,
        mode: input.useDraft ? 'draft' : 'pinned',
      })
      if (prepared.isErr()) {
        // A non-compiling draft is user-correctable — 422 with the structured
        // CompileError[] (the formatter forwards them as `data.compileErrors`).
        if (prepared.error.code === 'DRAFT_COMPILE_FAILED') {
          throw new TRPCError({
            code: 'UNPROCESSABLE_CONTENT',
            message: prepared.error.message,
            cause: prepared.error,
          })
        }
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot run eval case: ${prepared.error.message}`,
        })
      }

      const run = unwrap(
        await createQueuedEvalRun({
          organizationId,
          caseId: found.id,
          kind: 'agent_simulation',
          definitionSnapshot: prepared.value.definitionSnapshot,
          runtimeSnapshot: prepared.value.runtimeSnapshot,
          // Snapshot truth, not the request: a draft request with no attached
          // draft falls back to pinned, and the column must match the snapshot.
          runMode: prepared.value.runtimeSnapshot.runMode,
        }),
        'create queued eval run'
      )

      try {
        await enqueueEvalRun({ organizationId, userId, runId: run.id })
      } catch (error) {
        await failQueuedEvalRun({
          runId: run.id,
          errorCode: 'ENQUEUE_FAILED',
          error: error instanceof Error ? error.message : String(error),
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to enqueue eval run',
        })
      }

      return { runId: run.id }
    }),

  runAll: evalAdminProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        procedureId: z.string().min(1).optional(),
        caseIds: z.array(z.string().min(1)).optional(),
        useDraft: z.boolean().optional(),
        baselineSuiteRunId: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      // Shared with the Kopilot `run_eval_suite` tool — selection, snapshots,
      // atomic suite creation, and per-child enqueue all live in the lib recipe.
      const result = await startAgentSuiteRun({
        organizationId,
        userId,
        agentId: input.agentId,
        procedureId: input.procedureId,
        caseIds: input.caseIds,
        useDraft: input.useDraft,
        baselineSuiteRunId: input.baselineSuiteRunId,
      })
      if (result.isErr()) {
        if (result.error.code === 'DRAFT_COMPILE_FAILED') {
          throw new TRPCError({
            code: 'UNPROCESSABLE_CONTENT',
            message: result.error.message,
            cause: result.error,
          })
        }
        throw new TRPCError({
          code: result.error.code === 'EVAL_VALIDATION' ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
        })
      }
      return { suiteRunId: result.value.suiteRun.id, runIds: result.value.runIds }
    }),

  cancelRun: evalAdminProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const cancelled = unwrap(
        await cancelEvalRun({ organizationId: ctx.session.organizationId, runId: input.runId }),
        'cancel eval run'
      )
      if (!cancelled) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval run not found' })
      return { status: cancelled.status }
    }),

  deleteRun: evalAdminProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      unwrap(
        await deleteEvalRun({ organizationId: ctx.session.organizationId, runId: input.runId }),
        'delete eval run'
      )
      return { ok: true as const }
    }),

  // ── Suggestions ───────────────────────────────────────────────────────────
  // Mutation, not query: it spends tokens and is non-idempotent. The client holds
  // the result keyed by the returned `draftHash` rather than auto-refetching.
  // `evalAdminProcedure` gates the spend; org/agent scoping is enforced inside the
  // service by `getAttachedProcedureDraft`.
  suggest: evalAdminProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        procedureId: z.string().min(1),
        /** Bypass the draft-hash cache and regenerate (Refresh). */
        force: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) =>
      unwrap(
        await suggestAgentSimulations({
          organizationId: ctx.session.organizationId,
          userId: ctx.session.userId,
          agentId: input.agentId,
          procedureId: input.procedureId,
          force: input.force,
        }),
        'suggest simulations'
      )
    ),
})
