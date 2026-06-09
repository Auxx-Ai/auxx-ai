// packages/lib/src/evals/prepare-run.ts
//
// Snapshot construction for a queued run — the one service operation `run` and
// `runAll` share. Resolves the effective agent runtime (the SAME builder
// production uses), pins the compiled procedure(s), and builds both immutable
// snapshots before the queued row is inserted. Enqueue happens afterward (in the
// router). See plans/evals/phase-1-agent-simulation.md §1.3/§1.10 and conventions.md §4.

import type { AgentEvalAssertion, AgentEvalTarget, SimulationConfig } from '@auxx/types/evals'
import { err, ok, type Result } from 'neverthrow'
import { getProcedureVersionById, readCompiled } from '../agents/procedures'
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

  // Pin the compiled procedure set.
  const procResult = await resolvePinnedProcedures(organizationId, target)
  if (procResult.isErr()) return err(procResult.error)
  const procedures = procResult.value

  // Resolve the effective runtime via the shared builder (no divergent copy).
  const runtime = await buildEffectiveAgentRuntime({
    organizationId,
    userId,
    sessionId: `eval-prepare-${id}`,
    agentId,
    domain: 'kopilot',
    hasProcedures: procedures.length > 0,
  })

  const cachedAgent = await getCachedAgentById(organizationId, agentId)
  const agentKind: 'internal' | 'chat' = cachedAgent?.kind === 'chat' ? 'chat' : 'internal'

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

/** Pin the compiled procedure(s) the run executes against. */
async function resolvePinnedProcedures(
  organizationId: string,
  target: AgentEvalTarget
): Promise<Result<AgentRuntimeSnapshotV1['procedures'], EvalServiceError>> {
  if (target.scope === 'procedure') {
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
    return ok([{ id: target.procedureId, versionId: target.procedureVersionId, compiled }])
  }

  // Agent scope: pin every procedure the agent can select, each at its run-time
  // (currently active) compiled version — read from the org cache projection.
  const agent = await getCachedAgentById(organizationId, target.agentId)
  const procedures = (agent?.procedures ?? []).map((p) => ({
    id: p.procedureId,
    versionId: p.activeVersionId,
    compiled: p.compiled,
  }))
  return ok(procedures)
}
