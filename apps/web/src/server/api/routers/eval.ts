// apps/web/src/server/api/routers/eval.ts

import type { EvalCaseEntity } from '@auxx/database'
import {
  cancelEvalRun,
  createEvalCase,
  createQueuedEvalRun,
  createSuiteRunWithChildren,
  deleteEvalCase,
  failQueuedEvalRun,
  getEvalCaseById,
  getEvalRun,
  getEvalSuiteRun,
  listEvalCasesByAgent,
  listEvalRuns,
  type PreparedRunSnapshots,
  prepareRunSnapshots,
  updateEvalCase,
  validateEvalCase,
} from '@auxx/lib/evals'
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
      const cases = unwrap(
        await listEvalCasesByAgent({
          organizationId: ctx.session.organizationId,
          agentId: input.agentId,
          procedureId: input.procedureId,
        }),
        'list eval cases'
      )
      return cases
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const found = unwrap(
        await getEvalCaseById({ organizationId: ctx.session.organizationId, id: input.id }),
        'get eval case'
      )
      if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval case not found' })
      return found
    }),

  create: evalAdminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        target: agentEvalTargetSchema,
        config: simulationConfigSchema,
        assertions: agentEvalAssertionsSchema,
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

  // ── Execute ───────────────────────────────────────────────────────────────
  run: evalAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const found = unwrap(await getEvalCaseById({ organizationId, id: input.id }), 'get eval case')
      if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval case not found' })
      const parsed = parseCase(found)

      const prepared = await prepareRunSnapshots({ organizationId, userId, case: parsed })
      if (prepared.isErr()) {
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      // Resolve the selected cases (explicit ids, else every case under the scope).
      const all = unwrap(
        await listEvalCasesByAgent({
          organizationId,
          agentId: input.agentId,
          procedureId: input.procedureId,
        }),
        'list eval cases'
      )
      const selected = input.caseIds ? all.filter((c) => input.caseIds?.includes(c.id)) : all
      if (selected.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No eval cases selected' })
      }

      // Build snapshots for every case BEFORE the transaction.
      const children: { caseId: string; definitionSnapshot: unknown; runtimeSnapshot: unknown }[] =
        []
      for (const row of selected) {
        const prepared: PreparedRunSnapshots = unwrap(
          await prepareRunSnapshots({ organizationId, userId, case: parseCase(row) }),
          `prepare eval run for case ${row.id}`
        )
        children.push({
          caseId: row.id,
          definitionSnapshot: prepared.definitionSnapshot,
          runtimeSnapshot: prepared.runtimeSnapshot,
        })
      }

      const created = unwrap(
        await createSuiteRunWithChildren({
          organizationId,
          kind: 'agent_simulation',
          createdById: userId,
          selectionSnapshot: { caseIds: selected.map((c) => c.id) },
          children,
        }),
        'create eval suite run'
      )

      // Enqueue each child; a per-child enqueue failure fails that child only.
      for (const run of created.runs) {
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

      return { suiteRunId: created.suiteRun.id, runIds: created.runs.map((r) => r.id) }
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
})
