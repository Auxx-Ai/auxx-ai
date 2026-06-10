// packages/lib/src/evals/prepare-run.ts
//
// Snapshot construction for a queued run — the one service operation `run` and
// `runAll` share. Resolves the effective agent runtime (the SAME builder
// production uses), pins the compiled procedure(s), and builds both immutable
// snapshots before the queued row is inserted. Enqueue happens afterward (in the
// router). See plans/evals/phase-1-agent-simulation.md §1.3/§1.10 and conventions.md §4.

import { database, schema } from '@auxx/database'
import type {
  AgentEvalAssertion,
  AgentEvalTarget,
  EvalRunMode,
  SimulationConfig,
} from '@auxx/types/evals'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { hashAgentConfig } from '../agents/agent-config-snapshot'
import { compileProcedure, getProcedureVersionById, readCompiled } from '../agents/procedures'
import { getAttachedProcedureDraft } from '../agents/procedures/authoring/queries'
import { buildEffectiveAgentRuntime } from '../ai/agent-framework/effective-runtime'
import { getCachedAgentById } from '../cache'
import {
  type AgentRuntimeSnapshotV1,
  createAgentRuntimeSnapshot,
  getCodeRevision,
} from './runtime-snapshot'
import { type AgentDefinitionSnapshotV1, buildDefinitionSnapshot } from './snapshots'
import type { EvalServiceError } from './types'

export interface PreparedRunSnapshots {
  definitionSnapshot: AgentDefinitionSnapshotV1
  runtimeSnapshot: AgentRuntimeSnapshotV1
}

export interface PrepareRunInput {
  organizationId: string
  userId: string
  case: {
    id: string
    name: string
    createdAt: string
    target: AgentEvalTarget
    config: SimulationConfig
    assertions: AgentEvalAssertion[]
  }
  /**
   * `'pinned'` (default) runs the case's pinned `procedureVersionId` — the
   * regression-gate semantics headless/CI callers rely on. `'draft'` (the
   * Simulations editor surface) compiles the attached draft in-memory and runs
   * that, stamping the snapshot so the run stays attributable. `scope: 'agent'`
   * is unaffected by the mode in v1.
   */
  mode?: EvalRunMode
}

/**
 * Resolve the runtime and build both immutable snapshots for one case. Pins the
 * pinned procedure version (`scope: 'procedure'`) or the agent's whole procedure
 * set at its run-time versions (`scope: 'agent'`). Returns a validation error if
 * the pinned version is missing/uncompilable.
 */
export async function prepareRunSnapshots(
  input: PrepareRunInput
): Promise<Result<PreparedRunSnapshots, EvalServiceError>> {
  const { organizationId, userId } = input
  const { id, name, createdAt, target, config, assertions } = input.case
  const agentId = target.agentId
  const mode = input.mode ?? 'pinned'

  // Pin the compiled procedure set (or the compiled draft, in draft mode).
  const procResult = await resolveProcedures(organizationId, target, mode)
  if (procResult.isErr()) return err(procResult.error)
  const { procedures, runMode, draftContentHash } = procResult.value

  // Agent config follows the run mode: a draft run resolves the live Agent row,
  // a pinned run the active version. See build-plan §5.
  const agentConfigSource: 'active' | 'draft' = mode === 'draft' ? 'draft' : 'active'

  // Resolve the effective runtime via the shared builder (no divergent copy).
  const runtime = await buildEffectiveAgentRuntime({
    organizationId,
    userId,
    sessionId: `eval-prepare-${id}`,
    agentId,
    domain: 'kopilot',
    hasProcedures: procedures.length > 0,
    agentConfigSource,
  })

  const cachedAgent = await getCachedAgentById(organizationId, agentId)
  const agentKind: 'internal' | 'chat' = cachedAgent?.kind === 'chat' ? 'chat' : 'internal'

  // Pin the agent version (pinned mode) or stamp the draft config hash (draft mode)
  // so the run stays attributable to the exact config it exercised.
  const agentVersionId =
    agentConfigSource === 'active' ? (cachedAgent?.activeVersionId ?? null) : null
  const agentVersionNumber =
    agentConfigSource === 'active' ? (cachedAgent?.activeVersionNumber ?? null) : null
  let agentConfigHash: string | undefined
  if (agentConfigSource === 'draft') {
    const [row] = await database
      .select({
        prompt: schema.Agent.prompt,
        toolsets: schema.Agent.toolsets,
        knowledge: schema.Agent.knowledge,
        appAccounts: schema.Agent.appAccounts,
        toolRestrictions: schema.Agent.toolRestrictions,
        modelId: schema.Agent.modelId,
      })
      .from(schema.Agent)
      .where(and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)))
      .limit(1)
    if (row) agentConfigHash = hashAgentConfig(row)
  }

  const runtimeSnapshot = createAgentRuntimeSnapshot({
    runtime,
    scope: target.scope,
    agentId,
    agentKind,
    procedures,
    appAccountRefs: runtime.agentConfig.appAccounts ?? {},
    // Persona = capable model (drives the customer); grader = cheap utility tier.
    personaModel: runtime.model,
    graderModel: runtime.utilityModel,
    mockPolicy: config.unmatchedToolPolicy,
    limits: { maxCustomerTurns: config.maxCustomerTurns, maxReinvokes: 8, maxIterations: 100 },
    time: { frozenAt: config.timeFrozenAt },
    codeRevision: getCodeRevision(),
    runMode,
    draftContentHash,
    agentVersionId,
    agentVersionNumber,
    agentConfigHash,
  })

  const definitionSnapshot = buildDefinitionSnapshot({
    id,
    name,
    target,
    config,
    assertions,
    createdAt,
  })

  return ok({ definitionSnapshot, runtimeSnapshot })
}

interface ResolvedProcedures {
  procedures: AgentRuntimeSnapshotV1['procedures']
  runMode: EvalRunMode
  /** Present only when a draft was actually compiled and pinned. */
  draftContentHash?: string
}

/** Resolve the compiled procedure(s) the run executes against, honoring `mode`. */
async function resolveProcedures(
  organizationId: string,
  target: AgentEvalTarget,
  mode: EvalRunMode
): Promise<Result<ResolvedProcedures, EvalServiceError>> {
  if (target.scope === 'procedure') {
    // Draft mode: compile the attached draft in-memory and pin THAT, leaving the
    // case's pinned `procedureVersionId` untouched as the record-keeping anchor.
    if (mode === 'draft') {
      const drafted = await resolveDraftProcedure(organizationId, target)
      // No draft / not attached → fall back to pinned (preserves regression-gate).
      if (drafted) return drafted
    }

    const version = await getProcedureVersionById({
      organizationId,
      procedureVersionId: target.procedureVersionId,
    })
    if (version.isErr()) return err(version.error)
    if (!version.value) {
      return err({
        code: 'EVAL_VALIDATION',
        message: `Pinned procedure version not found: ${target.procedureVersionId}`,
      })
    }
    const compiled = readCompiled(version.value)
    if (!compiled) {
      return err({
        code: 'EVAL_VALIDATION',
        message: `Pinned procedure version is not compiled: ${target.procedureVersionId}`,
      })
    }
    return ok({
      procedures: [{ id: target.procedureId, versionId: target.procedureVersionId, compiled }],
      runMode: 'pinned',
    })
  }

  // Agent scope: pin every procedure the agent can select, each at its run-time
  // (currently active) compiled version — read from the org cache projection.
  // Unchanged by the run mode in v1.
  const agent = await getCachedAgentById(organizationId, target.agentId)
  const procedures = (agent?.procedures ?? []).map((p) => ({
    id: p.procedureId,
    versionId: p.activeVersionId,
    compiled: p.compiled,
  }))
  return ok({ procedures, runMode: 'pinned' })
}

/**
 * Compile the attached draft for a procedure-scope target and pin it. Returns
 * `null` when no usable draft exists (the caller then falls back to the pinned
 * version); a draft that fails to compile is a hard `EVAL_VALIDATION` so the run
 * doesn't silently execute a different graph.
 */
async function resolveDraftProcedure(
  organizationId: string,
  target: Extract<AgentEvalTarget, { scope: 'procedure' }>
): Promise<Result<ResolvedProcedures, EvalServiceError> | null> {
  const draftResult = await getAttachedProcedureDraft({
    organizationId,
    agentId: target.agentId,
    procedureId: target.procedureId,
  })
  if (draftResult.isErr()) return null
  const { compiled, contentHash, errors } = compileProcedure(draftResult.value.draftDoc)
  if (errors && errors.length > 0) {
    return err({
      code: 'DRAFT_COMPILE_FAILED',
      message: `Draft does not compile: ${errors.map((e) => e.message).join('; ')}`,
      errors,
    })
  }
  return ok({
    procedures: [{ id: target.procedureId, versionId: target.procedureVersionId, compiled }],
    runMode: 'draft',
    draftContentHash: contentHash,
  })
}
