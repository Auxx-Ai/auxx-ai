// packages/lib/src/evals/queries.ts
//
// Functional, org-scoped data access for evals (Drizzle + neverthrow), mirroring
// `agents/procedures/queries.ts`. JSONB blobs are parsed through the
// `@auxx/types/evals` Zod schemas at this boundary, then cast to the generic
// jsonb columns at the DB edge. See plans/evals/phase-1-agent-simulation.md §1.3
// and conventions.md §3.

import type { EvalCaseEntity, EvalRunEntity, EvalSuiteRunEntity } from '@auxx/database'
import { database, schema } from '@auxx/database'
import { fromDatabase } from '@auxx/services/shared/utils'
import type {
  AgentEvalAssertion,
  AgentEvalTarget,
  EvalKind,
  SimulationConfig,
} from '@auxx/types/evals'
import {
  agentEvalAssertionsSchema,
  agentEvalTargetSchema,
  simulationConfigSchema,
} from '@auxx/types/evals/schema'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { hashSnapshots } from './snapshots'
import type { EvalServiceError } from './types'

type Jsonb = Record<string, unknown>

/** Pull the denormalized listing keys out of a validated target. */
function denormalizeTarget(target: AgentEvalTarget): {
  agentId: string
  procedureId: string | null
} {
  return {
    agentId: target.agentId,
    procedureId: target.scope === 'procedure' ? target.procedureId : null,
  }
}

// ── EvalCase CRUD ───────────────────────────────────────────────────────

export interface CreateEvalCaseInput {
  organizationId: string
  name: string
  target: AgentEvalTarget
  config: SimulationConfig
  assertions: AgentEvalAssertion[]
  createdById?: string | null
  suggestionId?: string | null
}

/** Validate the case payload and insert it, deriving the denormalized listing keys. */
export async function createEvalCase(input: CreateEvalCaseInput) {
  const parsed = parseCasePayload(input)
  if (parsed.isErr()) return err(parsed.error)
  const { target, config, assertions } = parsed.value
  if (!target || !config || !assertions) {
    return err({ code: 'EVAL_VALIDATION' as const, message: 'Missing required case fields' })
  }
  const { agentId, procedureId } = denormalizeTarget(target)

  const result = await fromDatabase(
    database
      .insert(schema.EvalCase)
      .values({
        organizationId: input.organizationId,
        kind: 'agent_simulation',
        target: target as unknown as Jsonb,
        name: input.name,
        config: config as unknown as Jsonb,
        assertions: assertions as unknown as unknown[],
        agentId,
        procedureId,
        suggestionId: input.suggestionId ?? null,
        createdById: input.createdById ?? null,
        updatedAt: new Date(),
      })
      .returning(),
    'create-eval-case'
  )
  if (result.isErr()) return err(result.error)
  return ok(result.value[0] as EvalCaseEntity)
}

export interface UpdateEvalCaseInput {
  organizationId: string
  id: string
  patch: {
    name?: string
    target?: AgentEvalTarget
    config?: SimulationConfig
    assertions?: AgentEvalAssertion[]
  }
}

/** Patch a case; re-derives denormalized keys when `target` changes. */
export async function updateEvalCase(input: UpdateEvalCaseInput) {
  const { organizationId, id, patch } = input

  const validated = parseCasePayload({
    target: patch.target,
    config: patch.config,
    assertions: patch.assertions,
  })
  if (validated.isErr()) return err(validated.error)
  const v = validated.value

  const denorm = patch.target ? denormalizeTarget(patch.target) : null

  const result = await fromDatabase(
    database
      .update(schema.EvalCase)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(v.target ? { target: v.target as unknown as Jsonb } : {}),
        ...(v.config ? { config: v.config as unknown as Jsonb } : {}),
        ...(v.assertions ? { assertions: v.assertions as unknown as unknown[] } : {}),
        ...(denorm ? { agentId: denorm.agentId, procedureId: denorm.procedureId } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.EvalCase.id, id), eq(schema.EvalCase.organizationId, organizationId)))
      .returning(),
    'update-eval-case'
  )
  if (result.isErr()) return err(result.error)
  const row = result.value[0]
  if (!row)
    return err({ code: 'EVAL_CASE_NOT_FOUND' as const, message: `Eval case not found: ${id}` })
  return ok(row as EvalCaseEntity)
}

export async function deleteEvalCase(input: { organizationId: string; id: string }) {
  const result = await fromDatabase(
    database
      .delete(schema.EvalCase)
      .where(
        and(
          eq(schema.EvalCase.id, input.id),
          eq(schema.EvalCase.organizationId, input.organizationId)
        )
      ),
    'delete-eval-case'
  )
  if (result.isErr()) return err(result.error)
  return ok(undefined)
}

/**
 * Cases for an agent. Omit `procedureId` for the agent-root view (every case,
 * for grouping); pass it to scope to one procedure's procedure-scoped cases.
 */
export async function listEvalCasesByAgent(input: {
  organizationId: string
  agentId: string
  procedureId?: string
}) {
  const where = input.procedureId
    ? and(
        eq(schema.EvalCase.organizationId, input.organizationId),
        eq(schema.EvalCase.agentId, input.agentId),
        eq(schema.EvalCase.procedureId, input.procedureId)
      )
    : and(
        eq(schema.EvalCase.organizationId, input.organizationId),
        eq(schema.EvalCase.agentId, input.agentId)
      )

  const result = await fromDatabase(
    database.select().from(schema.EvalCase).where(where).orderBy(desc(schema.EvalCase.updatedAt)),
    'list-eval-cases-by-agent'
  )
  if (result.isErr()) return err(result.error)
  return ok(result.value as EvalCaseEntity[])
}

export async function getEvalCaseById(input: { organizationId: string; id: string }) {
  const result = await fromDatabase(
    database.query.EvalCase.findFirst({
      where: and(
        eq(schema.EvalCase.id, input.id),
        eq(schema.EvalCase.organizationId, input.organizationId)
      ),
    }),
    'get-eval-case-by-id'
  )
  if (result.isErr()) return err(result.error)
  return ok((result.value ?? null) as EvalCaseEntity | null)
}

// ── Queued run / suite creation ─────────────────────────────────────────

export interface CreateQueuedEvalRunInput {
  organizationId: string
  caseId: string
  kind: EvalKind
  definitionSnapshot: unknown
  /** A typed `AgentRuntimeSnapshotV1` (kept `unknown` here to avoid a heavy import cycle). */
  runtimeSnapshot: unknown
  suiteRunId?: string | null
}

/**
 * Insert a `queued` run carrying both immutable snapshots and their canonical
 * hash. Snapshot construction happens BEFORE this call (it resolves the runtime);
 * persisting them is one atomic insert so a worker can claim `queued → running`
 * without a preparation race.
 */
export async function createQueuedEvalRun(input: CreateQueuedEvalRunInput) {
  const snapshotHash = hashSnapshots(input.definitionSnapshot, input.runtimeSnapshot)
  const result = await fromDatabase(
    database
      .insert(schema.EvalRun)
      .values({
        organizationId: input.organizationId,
        caseId: input.caseId,
        suiteRunId: input.suiteRunId ?? null,
        kind: input.kind,
        status: 'queued',
        definitionSnapshot: input.definitionSnapshot as Jsonb,
        runtimeSnapshot: input.runtimeSnapshot as Jsonb,
        snapshotHash,
      })
      .returning(),
    'create-queued-eval-run'
  )
  if (result.isErr()) return err(result.error)
  return ok(result.value[0] as EvalRunEntity)
}

export interface CreateSuiteRunWithChildrenInput {
  organizationId: string
  kind: EvalKind
  createdById?: string | null
  /** Ordered case ids selected for the batch (recorded into `selectionSnapshot`). */
  selectionSnapshot: Jsonb
  children: {
    caseId: string
    definitionSnapshot: unknown
    runtimeSnapshot: unknown
  }[]
}

/**
 * Transactionally create an `EvalSuiteRun` plus one queued child `EvalRun` per
 * selected case (conventions §9: runAll is atomic). Snapshots are built before
 * the transaction; this only persists them.
 */
export async function createSuiteRunWithChildren(input: CreateSuiteRunWithChildrenInput) {
  const result = await fromDatabase(
    database.transaction(async (tx) => {
      const [suite] = await tx
        .insert(schema.EvalSuiteRun)
        .values({
          organizationId: input.organizationId,
          kind: input.kind,
          status: 'running',
          requestedCount: input.children.length,
          selectionSnapshot: input.selectionSnapshot,
          createdById: input.createdById ?? null,
          startedAt: new Date(),
        })
        .returning()
      if (!suite) throw new Error('Failed to insert suite run')

      const runs: EvalRunEntity[] = []
      for (const child of input.children) {
        const [run] = await tx
          .insert(schema.EvalRun)
          .values({
            organizationId: input.organizationId,
            caseId: child.caseId,
            suiteRunId: suite.id,
            kind: input.kind,
            status: 'queued',
            definitionSnapshot: child.definitionSnapshot as Jsonb,
            runtimeSnapshot: child.runtimeSnapshot as Jsonb,
            snapshotHash: hashSnapshots(child.definitionSnapshot, child.runtimeSnapshot),
          })
          .returning()
        if (!run) throw new Error('Failed to insert child run')
        runs.push(run as EvalRunEntity)
      }
      return { suiteRun: suite as EvalSuiteRunEntity, runs }
    }),
    'create-suite-run-with-children'
  )
  if (result.isErr()) return err(result.error)
  return ok(result.value)
}

// ── Run / suite reads ───────────────────────────────────────────────────

export async function listEvalRuns(input: {
  organizationId: string
  caseId: string
  limit?: number
  before?: Date
}) {
  const limit = Math.min(input.limit ?? 20, 100)
  const where = input.before
    ? and(
        eq(schema.EvalRun.organizationId, input.organizationId),
        eq(schema.EvalRun.caseId, input.caseId),
        lt(schema.EvalRun.createdAt, input.before)
      )
    : and(
        eq(schema.EvalRun.organizationId, input.organizationId),
        eq(schema.EvalRun.caseId, input.caseId)
      )

  const result = await fromDatabase(
    database
      .select()
      .from(schema.EvalRun)
      .where(where)
      .orderBy(desc(schema.EvalRun.createdAt))
      .limit(limit),
    'list-eval-runs'
  )
  if (result.isErr()) return err(result.error)
  return ok(result.value as EvalRunEntity[])
}

/** A compact latest-run summary for the suite-list rows (status pill + last-run time). */
export interface LatestRunSummary {
  caseId: string
  runId: string
  status: EvalRunEntity['status']
  createdAt: Date
  completedAt: Date | null
}

/**
 * The most recent run per case for a set of case ids, in ONE query
 * (`DISTINCT ON (caseId) … ORDER BY caseId, createdAt DESC`). Powers the suite
 * list's status pills without an N+1 over `listEvalRuns`. Cases with no runs are
 * simply absent from the result.
 */
export async function getLatestRunsByCaseIds(input: { organizationId: string; caseIds: string[] }) {
  if (input.caseIds.length === 0) return ok([] as LatestRunSummary[])

  const result = await fromDatabase(
    database
      .selectDistinctOn([schema.EvalRun.caseId], {
        caseId: schema.EvalRun.caseId,
        runId: schema.EvalRun.id,
        status: schema.EvalRun.status,
        createdAt: schema.EvalRun.createdAt,
        completedAt: schema.EvalRun.completedAt,
      })
      .from(schema.EvalRun)
      .where(
        and(
          eq(schema.EvalRun.organizationId, input.organizationId),
          inArray(schema.EvalRun.caseId, input.caseIds)
        )
      )
      .orderBy(schema.EvalRun.caseId, desc(schema.EvalRun.createdAt)),
    'latest-runs-by-case-ids'
  )
  if (result.isErr()) return err(result.error)
  // `caseId` is nullable on the column type but never null here (we filter by ids).
  return ok(
    result.value.filter((r): r is LatestRunSummary => r.caseId != null) as LatestRunSummary[]
  )
}

export async function getEvalRun(input: { organizationId: string; runId: string }) {
  const result = await fromDatabase(
    database.query.EvalRun.findFirst({
      where: and(
        eq(schema.EvalRun.id, input.runId),
        eq(schema.EvalRun.organizationId, input.organizationId)
      ),
    }),
    'get-eval-run'
  )
  if (result.isErr()) return err(result.error)
  return ok((result.value ?? null) as EvalRunEntity | null)
}

export async function getEvalSuiteRun(input: { organizationId: string; suiteRunId: string }) {
  const result = await fromDatabase(
    database.query.EvalSuiteRun.findFirst({
      where: and(
        eq(schema.EvalSuiteRun.id, input.suiteRunId),
        eq(schema.EvalSuiteRun.organizationId, input.organizationId)
      ),
    }),
    'get-eval-suite-run'
  )
  if (result.isErr()) return err(result.error)
  return ok((result.value ?? null) as EvalSuiteRunEntity | null)
}

// ── helpers ─────────────────────────────────────────────────────────────

/** Parse whichever of target/config/assertions are present; EVAL_VALIDATION on failure. */
function parseCasePayload<
  T extends {
    target?: AgentEvalTarget
    config?: SimulationConfig
    assertions?: AgentEvalAssertion[]
  },
>(input: T) {
  const out: {
    target?: AgentEvalTarget
    config?: SimulationConfig
    assertions?: AgentEvalAssertion[]
  } = {}

  if (input.target !== undefined) {
    const r = agentEvalTargetSchema.safeParse(input.target)
    if (!r.success) return err(validationError('target', r.error))
    out.target = r.data
  }
  if (input.config !== undefined) {
    const r = simulationConfigSchema.safeParse(input.config)
    if (!r.success) return err(validationError('config', r.error))
    out.config = r.data
  }
  if (input.assertions !== undefined) {
    const r = agentEvalAssertionsSchema.safeParse(input.assertions)
    if (!r.success) return err(validationError('assertions', r.error))
    out.assertions = r.data
  }
  return ok(out)
}

function validationError(field: string, cause: unknown): EvalServiceError {
  return { code: 'EVAL_VALIDATION', message: `Invalid eval case ${field}`, cause }
}

export type { EvalCaseEntity, EvalRunEntity, EvalSuiteRunEntity }
