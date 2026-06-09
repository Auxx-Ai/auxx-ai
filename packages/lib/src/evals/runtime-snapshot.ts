// packages/lib/src/evals/runtime-snapshot.ts
//
// Snapshot adapters around the shared effective-agent runtime builder (§1.4 tail).
// `createAgentRuntimeSnapshot` strips executable functions and secrets out of a
// live `EffectiveAgentRuntime` into the persisted manifest. The executor's
// `buildEffectiveAgentRuntimeFromSnapshot` rebuilds the LIVE runtime (so it gets
// real tool implementations + the current code registry) and verifies it against
// the snapshot's tool names + schema digests before any model/tool call. Only eval
// runs reconstruct from a snapshot; production always calls the live resolver.
//
// See plans/evals/phase-1-agent-simulation.md §1.4 and conventions.md §4/§5.

import type { CompiledProcedure } from '../agents/procedures'
import {
  buildEffectiveAgentRuntime,
  type EffectiveAgentRuntime,
} from '../ai/agent-framework/effective-runtime'
import type { AgentToolDefinition } from '../ai/agent-framework/types'
import { canonicalize, stableHash, stripSecrets } from './snapshots'

export interface ProviderModel {
  provider: string
  model: string
}

/** One tool's stable contract digest — used to detect drift at reconstruction. */
export interface ToolManifestEntry {
  name: string
  /** Stable hash of the tool's input JSON schema + output-schema presence + idempotency. */
  schemaDigest: string
}

/**
 * The persisted, secret-free runtime snapshot. Pins the compiled procedure(s) the
 * run executes against, the provider/model ids for every model role, the effective
 * tool manifest (names + digests), and the non-secret app-account references. See
 * plans/evals/phase-1-agent-simulation.md §1.3.
 */
export interface AgentRuntimeSnapshotV1 {
  version: 1
  codeRevision: string
  scope: 'procedure' | 'agent'
  /**
   * scope='procedure': exactly one entry, the pinned target procedure.
   * scope='agent': every procedure the agent can select, each at its run-time version.
   */
  procedures: { id: string; versionId: string; compiled: CompiledProcedure }[]
  agent: {
    id: string
    kind: 'internal' | 'chat'
    model: ProviderModel
    utilityModel: ProviderModel
    toolManifest: ToolManifestEntry[]
    /** Effective binding overrides (author defaults ⊕ admin overrides), secret-free. */
    toolBindings: unknown
    appAccountRefs: Record<string, { credId: string }>
    /** Full resolved effective agent config, redacted — historical display only. */
    config: unknown
  }
  personaModel: ProviderModel
  graderModel: ProviderModel
  mockPolicy: 'error' | 'passthrough_readonly'
  limits: { maxCustomerTurns: number; maxReinvokes: number; maxIterations: number }
  time: { frozenAt: string | null; scope: 'framework_visible' }
  /**
   * Which procedure source the run executed. `'pinned'` (default) runs the case's
   * pinned `procedureVersionId`; `'draft'` runs the attached draft compiled
   * in-memory at prepare time. Stamped so historical runs stay attributable
   * (like `test_version_id`); the run detail shows a Draft badge from this.
   */
  runMode: 'pinned' | 'draft'
  /** The compiler's stable `contentHash` of the draft, present only for `runMode: 'draft'`. */
  draftContentHash?: string
}

/** Deployed code revision, read from the standard platform env vars (best-effort). */
export function getCodeRevision(): string {
  return (
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.SOURCE_VERSION ??
    'unknown'
  )
}

/** Stable digest of a tool's executable contract — input schema, output-schema presence, idempotency. */
export function toolSchemaDigest(tool: AgentToolDefinition): string {
  return stableHash({
    name: tool.name,
    parameters: tool.parameters,
    hasOutputSchema: Boolean(tool.outputSchema),
    idempotent: tool.idempotent === true,
  })
}

export function buildToolManifest(tools: AgentToolDefinition[]): ToolManifestEntry[] {
  return tools.map((tool) => ({ name: tool.name, schemaDigest: toolSchemaDigest(tool) }))
}

export interface CreateAgentRuntimeSnapshotInput {
  runtime: EffectiveAgentRuntime
  scope: 'procedure' | 'agent'
  agentId: string
  agentKind: 'internal' | 'chat'
  /** Pinned compiled procedure(s): one for procedure-scope, the full set for agent-scope. */
  procedures: { id: string; versionId: string; compiled: CompiledProcedure }[]
  appAccountRefs: Record<string, { credId: string }>
  personaModel: ProviderModel
  graderModel: ProviderModel
  mockPolicy: 'error' | 'passthrough_readonly'
  limits: { maxCustomerTurns: number; maxReinvokes: number; maxIterations: number }
  time: { frozenAt: string | null }
  codeRevision?: string
  /** Defaults to `'pinned'`. */
  runMode?: 'pinned' | 'draft'
  /** The compiler's stable `contentHash` of the draft (draft mode only). */
  draftContentHash?: string
}

/**
 * Strip a live runtime into the persisted manifest: tool implementations become
 * name+digest entries, the resolved config is redacted, and the pinned compiled
 * procedures are carried verbatim so the worker executes the exact graph. No
 * decrypted credentials are stored (conventions §4).
 */
export function createAgentRuntimeSnapshot(
  input: CreateAgentRuntimeSnapshotInput
): AgentRuntimeSnapshotV1 {
  const { runtime } = input
  return {
    version: 1,
    codeRevision: input.codeRevision ?? getCodeRevision(),
    scope: input.scope,
    procedures: input.procedures,
    agent: {
      id: input.agentId,
      kind: input.agentKind,
      model: runtime.model,
      utilityModel: runtime.utilityModel,
      toolManifest: buildToolManifest(runtime.tools),
      toolBindings: stripSecrets(canonicalize(runtime.agentConfig.toolRestrictions ?? null)),
      appAccountRefs: input.appAccountRefs,
      config: stripSecrets(canonicalize(runtime.agentConfig)),
    },
    personaModel: input.personaModel,
    graderModel: input.graderModel,
    mockPolicy: input.mockPolicy,
    limits: input.limits,
    time: { frozenAt: input.time.frozenAt, scope: 'framework_visible' },
    runMode: input.runMode ?? 'pinned',
    ...(input.draftContentHash ? { draftContentHash: input.draftContentHash } : {}),
  }
}

// ── Reconstruction + verification ────────────────────────────────────────

export interface SnapshotVerification {
  /** Hard-incompatible: a snapshotted tool is missing or its schema digest drifted. */
  compatible: boolean
  /** Tools present in the snapshot manifest but absent from the live registry. */
  missingTools: string[]
  /** Tools whose live schema digest no longer matches the snapshot. */
  digestMismatches: string[]
  /** Soft warning: the deployed code revision differs from the snapshot's. */
  codeRevisionDrifted: boolean
  snapshotCodeRevision: string
  currentCodeRevision: string
}

export interface ReconstructedRuntime {
  runtime: EffectiveAgentRuntime
  verification: SnapshotVerification
}

/**
 * Rebuild the live effective runtime for an eval run and verify it against the
 * stored snapshot. The model is pinned to the snapshot's recorded agent model so
 * reconstruction is faithful. Tool names + schema digests are checked: a missing
 * tool or drifted digest makes the run hard-incompatible (the executor rejects
 * before any model/tool call); a code-revision difference is a soft trace warning.
 */
export async function buildEffectiveAgentRuntimeFromSnapshot(args: {
  snapshot: AgentRuntimeSnapshotV1
  organizationId: string
  userId: string
  sessionId: string
  signal?: AbortSignal
  /** Wrap the reconstructed toolset with mock execution (the Simulation always does). */
  wrapTools?: (tools: AgentToolDefinition[]) => AgentToolDefinition[]
}): Promise<ReconstructedRuntime> {
  const { snapshot } = args
  const runtime = await buildEffectiveAgentRuntime({
    organizationId: args.organizationId,
    userId: args.userId,
    sessionId: args.sessionId,
    agentId: snapshot.agent.id,
    domain: 'kopilot',
    signal: args.signal,
    modelId: `${snapshot.agent.model.provider}:${snapshot.agent.model.model}`,
    hasProcedures: snapshot.procedures.length > 0,
    wrapTools: args.wrapTools,
  })

  const verification = verifyRuntimeAgainstSnapshot(runtime, snapshot)
  return { runtime, verification }
}

export function verifyRuntimeAgainstSnapshot(
  runtime: EffectiveAgentRuntime,
  snapshot: AgentRuntimeSnapshotV1
): SnapshotVerification {
  const live = new Map(runtime.tools.map((t) => [t.name, toolSchemaDigest(t)]))
  const missingTools: string[] = []
  const digestMismatches: string[] = []

  for (const entry of snapshot.agent.toolManifest) {
    const liveDigest = live.get(entry.name)
    if (liveDigest === undefined) {
      missingTools.push(entry.name)
    } else if (liveDigest !== entry.schemaDigest) {
      digestMismatches.push(entry.name)
    }
  }

  const currentCodeRevision = getCodeRevision()
  return {
    compatible: missingTools.length === 0 && digestMismatches.length === 0,
    missingTools,
    digestMismatches,
    codeRevisionDrifted: currentCodeRevision !== snapshot.codeRevision,
    snapshotCodeRevision: snapshot.codeRevision,
    currentCodeRevision,
  }
}
