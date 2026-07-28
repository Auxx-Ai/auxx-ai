// apps/web/src/server/api/routers/eval.ts

import type { EvalCaseEntity, EvalRunEntity, EvalSuiteRunEntity } from '@auxx/database'
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
import { FeaturePermissionService, PermissionKey } from '@auxx/lib/permissions'
import { FeatureKey } from '@auxx/lib/permissions/client'
import {
  agentEvalAssertionsSchema,
  agentEvalTargetSchema,
  simulationConfigSchema,
} from '@auxx/types/evals/schema'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { assertAgentAccess } from '~/server/lib/agent-instance-access'
import { createTRPCRouter, permissionProcedure } from '../trpc'
import { unwrap } from '../unwrap'

/**
 * Per-agent instance access for evals (plan 25 §4.2, user decision 2026-07-28):
 * **reads need `view` on the owning agent, writes need `edit`** — an agent's
 * simulations, suites and run traces are part of the agent, so they are judged
 * by the same `ResourceAccess` row the agent itself is.
 *
 * Until this landed, 11 of these procedures were bare `protectedProcedure` and
 * read no capabilities at all: any org member could list, open and diff any
 * agent's eval suites and run history. That was the hole, not a re-tiering.
 *
 * Base procedure is `permissionProcedure(agentsView)` throughout — the same
 * choice `workflow.ts` made. A member composing `agents: None` who holds one
 * explicit instance grant genuinely HOLDS `agentsView` (the composer derives the
 * Read rung from their grants), so the coarse rung is a front door and the
 * per-instance assert below it does the real work. **Every procedure here
 * asserts on a specific agent** — there is no org-wide eval list to filter, both
 * `list` and `listSuiteRuns` are already scoped to one required `agentId`.
 *
 * `run` / `runAll` spend org credits at the `edit` tier. Deliberate (user,
 * 2026-07-28): an instance editor authoring simulations must be able to run
 * them, and every other spend on the agent (drafts, procedures) is already edit.
 */
const evalProcedure = permissionProcedure(PermissionKey.agentsView)

/** {@link evalProcedure} + the `agentProcedures` feature gate (evals exercise procedures). */
const evalWriteProcedure = evalProcedure.use(async ({ ctx, next }) => {
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

/**
 * The agent a persisted CASE belongs to. `EvalCase.agentId` is the denormalized
 * copy the service keeps in sync on every write; `target` is the source of truth
 * and covers any row the column is null on.
 *
 * A case that resolves to no agent cannot be judged by instance access, so it is
 * a 404 rather than an ungated read — the same "unjudgeable ⇒ invisible" rule
 * `assertAgentAccess` applies to an unresolvable agent id.
 */
function caseAgentId(row: EvalCaseEntity): string {
  if (row.agentId) return row.agentId
  const target = agentEvalTargetSchema.safeParse(row.target)
  if (!target.success) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval case not found' })
  return target.data.agentId
}

/**
 * The agent a persisted RUN belongs to — read off the immutable
 * `definitionSnapshot`, NOT the case.
 *
 * `EvalRun.caseId` is `ON DELETE SET NULL` (runs outlive their case by policy),
 * so joining back to `EvalCase` would leave every orphaned run ungatable.
 * Snapshot truth is also the more correct answer: a case later re-targeted to
 * another agent must not retroactively move the runs it already produced.
 */
function runAgentId(run: EvalRunEntity): string {
  const snapshot = run.definitionSnapshot as { case?: { target?: unknown } } | null
  const target = agentEvalTargetSchema.safeParse(snapshot?.case?.target)
  if (!target.success) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval run not found' })
  return target.data.agentId
}

/**
 * The agent a SUITE run belongs to (`EvalSuiteRun.agentId`, denormalized from
 * the `runAll` selection). Nullable and FK-less — suite history outlives deleted
 * agents — so a null is an unjudgeable suite and therefore a 404.
 */
function suiteAgentId(suite: EvalSuiteRunEntity): string {
  if (!suite.agentId)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval suite run not found' })
  return suite.agentId
}

export const evalRouter = createTRPCRouter({
  // ── Case CRUD ───────────────────────────────────────────────────────────
  list: evalProcedure
    .input(z.object({ agentId: z.string().min(1), procedureId: z.string().min(1).optional() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      // Scoped to ONE agent, so this asserts rather than filters. The resolved id
      // also goes downstream — `EvalCase.agentId` stores `Agent.id`, so a slug
      // would have silently listed nothing.
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: input.agentId,
        tier: 'view',
      })
      const cases = unwrap(
        await listEvalCasesByAgent({
          organizationId,
          agentId,
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

  getById: evalProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const found = unwrap(
        await getEvalCaseById({ organizationId: ctx.session.organizationId, id: input.id }),
        'get eval case'
      )
      if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval case not found' })
      // The row we already loaded carries the agent — no second lookup.
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        idOrSlug: caseAgentId(found),
        tier: 'view',
      })
      return parseCase(found)
    }),

  create: evalWriteProcedure
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
      // The new case's OWNER is `target.agentId` — authoring an eval onto an
      // agent is editing that agent.
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        idOrSlug: input.target.agentId,
        tier: 'edit',
      })
      const created = unwrap(
        await createEvalCase({
          organizationId: ctx.session.organizationId,
          createdById: ctx.session.userId,
          name: input.name,
          // Persist the RESOLVED id: `target.agentId` is what every later
          // instance assert keys on, and it must never hold a slug.
          target: { ...input.target, agentId },
          config: input.config,
          assertions: input.assertions,
          suggestionId: input.suggestionId,
          // The drawer self-invalidates on save — exclude this tab from the
          // realtime echo so only OTHER open tabs refetch.
          excludeSocketId: ctx.headers.get('x-realtime-socket-id') ?? undefined,
        }),
        'create eval case'
      )
      return { id: created.id }
    }),

  update: evalWriteProcedure
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
      const { organizationId } = ctx.session
      const found = unwrap(await getEvalCaseById({ organizationId, id: input.id }), 'get eval case')
      if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval case not found' })
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: caseAgentId(found),
        tier: 'edit',
      })

      // A `target` patch can RE-TARGET the case onto another agent, which is a
      // write to that agent too — assert it, and persist the resolved id.
      let patch = input.patch
      if (patch.target) {
        const agentId = await assertAgentAccess({
          capabilities: ctx.capabilities,
          organizationId,
          idOrSlug: patch.target.agentId,
          tier: 'edit',
        })
        patch = { ...patch, target: { ...patch.target, agentId } }
      }

      const updated = unwrap(
        await updateEvalCase({
          organizationId,
          id: input.id,
          patch,
          excludeSocketId: ctx.headers.get('x-realtime-socket-id') ?? undefined,
        }),
        'update eval case'
      )
      return { id: updated.id }
    }),

  delete: evalWriteProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const found = unwrap(await getEvalCaseById({ organizationId, id: input.id }), 'get eval case')
      if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval case not found' })
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: caseAgentId(found),
        tier: 'edit',
      })
      unwrap(
        await deleteEvalCase({
          organizationId,
          id: input.id,
          excludeSocketId: ctx.headers.get('x-realtime-socket-id') ?? undefined,
        }),
        'delete eval case'
      )
      return { ok: true as const }
    }),

  // ── Editor support (tool responses) ───────────────────────────────────────
  // The displayed tool list is derived client-side from the unified catalog
  // (`useToolGroups`); only mock validation needs the server's Zod schemas.
  validateMock: evalProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        toolName: z.string().min(1),
        output: z.unknown(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Reads the agent's tool schemas — `view` on the agent, not just on evals.
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        idOrSlug: input.agentId,
        tier: 'view',
      })
      return validateAgentToolMock({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        agentId,
        toolName: input.toolName,
        output: input.output,
      })
    }),

  // ── Validation ──────────────────────────────────────────────────────────
  validate: evalProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const found = unwrap(
        await getEvalCaseById({ organizationId: ctx.session.organizationId, id: input.id }),
        'get eval case'
      )
      if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval case not found' })
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        idOrSlug: caseAgentId(found),
        tier: 'view',
      })
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
  listRuns: evalProcedure
    .input(z.object({ caseId: z.string().min(1), cursor: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      // Only a case id arrives, so the owning agent costs one lookup. The runs
      // themselves carry it in their snapshots, but we must gate BEFORE loading
      // them, and a page of runs can span no more than the one case anyway.
      const found = unwrap(
        await getEvalCaseById({ organizationId: ctx.session.organizationId, id: input.caseId }),
        'get eval case'
      )
      if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval case not found' })
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        idOrSlug: caseAgentId(found),
        tier: 'view',
      })
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

  getRun: evalProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const run = unwrap(
        await getEvalRun({ organizationId: ctx.session.organizationId, runId: input.runId }),
        'get eval run'
      )
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval run not found' })
      // The trace is the agent's transcript — gate it on the agent that ran.
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        idOrSlug: runAgentId(run),
        tier: 'view',
      })
      return run
    }),

  /** AI credits + tokens a single eval run consumed (rolled up from AiUsage). */
  getRunCredits: evalProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      // Spend is org data keyed on a run; the run's agent decides who may see it.
      const run = unwrap(
        await getEvalRun({ organizationId: ctx.session.organizationId, runId: input.runId }),
        'get eval run'
      )
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval run not found' })
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        idOrSlug: runAgentId(run),
        tier: 'view',
      })
      return unwrap(
        await getEvalRunCredits({
          organizationId: ctx.session.organizationId,
          runId: input.runId,
        }),
        'get eval run credits'
      )
    }),

  getSuiteRun: evalProcedure
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
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        idOrSlug: suiteAgentId(suite),
        tier: 'view',
      })
      return suite
    }),

  /** Iteration-history feed: suite runs for an agent (optionally one procedure), newest first. */
  listSuiteRuns: evalProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        procedureId: z.string().min(1).optional(),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        idOrSlug: input.agentId,
        tier: 'view',
      })
      const limit = 20
      const suiteRuns = unwrap(
        await listEvalSuiteRuns({
          organizationId: ctx.session.organizationId,
          agentId,
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
  listSuiteChildRuns: evalProcedure
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
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        idOrSlug: suiteAgentId(suite),
        tier: 'view',
      })
      return unwrap(
        await listSuiteChildRunSummaries({
          organizationId: ctx.session.organizationId,
          suiteRunId: input.suiteRunId,
        }),
        'list suite child runs'
      )
    }),

  /** Verdict diff of two terminal suites (5B). Read-only; computed on request. */
  compareSuiteRuns: evalProcedure
    .input(
      z.object({
        baselineSuiteRunId: z.string().min(1),
        candidateSuiteRunId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      // BOTH sides are read, so both must be viewable — `compareSuiteRuns`
      // accepts any two suite ids, including ones from different agents, so
      // asserting only the candidate would leak the baseline's verdicts.
      const [baseline, candidate] = await Promise.all([
        getEvalSuiteRun({
          organizationId: ctx.session.organizationId,
          suiteRunId: input.baselineSuiteRunId,
        }),
        getEvalSuiteRun({
          organizationId: ctx.session.organizationId,
          suiteRunId: input.candidateSuiteRunId,
        }),
      ])
      for (const loaded of [baseline, candidate]) {
        const suite = unwrap(loaded, 'get eval suite run')
        if (!suite) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval suite run not found' })
        await assertAgentAccess({
          capabilities: ctx.capabilities,
          organizationId: ctx.session.organizationId,
          idOrSlug: suiteAgentId(suite),
          tier: 'view',
        })
      }

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
  run: evalWriteProcedure
    // `useDraft`: run the current draft (the Simulations editor surface always
    // passes true); headless/CI default to the pinned version (regression gate).
    .input(z.object({ id: z.string().min(1), useDraft: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const found = unwrap(await getEvalCaseById({ organizationId, id: input.id }), 'get eval case')
      if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval case not found' })
      // `edit`, not `view` — this spends org credits (accepted, see the header).
      // The case row is already loaded, so the tier costs no extra query.
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: caseAgentId(found),
        tier: 'edit',
      })
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

  runAll: evalWriteProcedure
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
      // `edit` — a suite is the expensive spend on this router (N runs).
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: input.agentId,
        tier: 'edit',
      })

      // Shared with the Kopilot `run_eval_suite` tool — selection, snapshots,
      // atomic suite creation, and per-child enqueue all live in the lib recipe.
      const result = await startAgentSuiteRun({
        organizationId,
        userId,
        agentId,
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

  cancelRun: evalWriteProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const run = unwrap(await getEvalRun({ organizationId, runId: input.runId }), 'get eval run')
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval run not found' })
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: runAgentId(run),
        tier: 'edit',
      })
      const cancelled = unwrap(
        await cancelEvalRun({ organizationId, runId: input.runId }),
        'cancel eval run'
      )
      if (!cancelled) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval run not found' })
      return { status: cancelled.status }
    }),

  deleteRun: evalWriteProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const run = unwrap(await getEvalRun({ organizationId, runId: input.runId }), 'get eval run')
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval run not found' })
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: runAgentId(run),
        tier: 'edit',
      })
      unwrap(await deleteEvalRun({ organizationId, runId: input.runId }), 'delete eval run')
      return { ok: true as const }
    }),

  // ── Suggestions ───────────────────────────────────────────────────────────
  // Mutation, not query: it spends tokens and is non-idempotent. The client holds
  // the result keyed by the returned `draftHash` rather than auto-refetching.
  // Instance `edit` on the agent gates the spend; org/agent scoping is enforced
  // inside the service by `getAttachedProcedureDraft`.
  suggest: evalWriteProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        procedureId: z.string().min(1),
        /** Bypass the draft-hash cache and regenerate (Refresh). */
        force: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        idOrSlug: input.agentId,
        tier: 'edit',
      })
      return unwrap(
        await suggestAgentSimulations({
          organizationId: ctx.session.organizationId,
          userId: ctx.session.userId,
          agentId,
          procedureId: input.procedureId,
          force: input.force,
        }),
        'suggest simulations'
      )
    }),
})
