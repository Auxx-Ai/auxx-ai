// packages/types/evals/index.ts
//
// Client-safe PERSISTED contracts for the Evals feature, shared by web and lib.
// These are versioned wire/storage shapes — changing them is a migration-class
// change. Runtime-only types (executor seams, snapshot internals) live under
// `packages/lib/src/evals/`, not here.
//
// See plans/evals/phase-1-agent-simulation.md §1.1 and conventions.md §1.

import type { FieldReference } from '../field'
import type { RecordId } from '../resource'

// ---- Kinds & lifecycle (mirror the DB enums in `_shared.ts`) ----

export type EvalKind = 'agent_simulation' | 'workflow' | 'recorded_ticket'

export type EvalRunStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'error'
  | 'cancelled'
  | 'timed_out'

export type EvalSuiteRunStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'error'

/**
 * Which procedure source a run executed: the case's pinned `procedureVersionId`
 * (regression-gate semantics) or the attached draft compiled in-memory at
 * prepare time. Denormalized onto `EvalRun.runMode` / `EvalSuiteRun.runMode`
 * from the runtime snapshot.
 */
export type EvalRunMode = 'pinned' | 'draft'

/** Whether a simulation unit-tests one pinned procedure or runs the whole agent. */
export type AgentEvalScope = 'procedure' | 'agent'

// ---- Targets ----
//
// Targets are explicit and validated, never a generic `targetId`.

export type AgentEvalTarget =
  | {
      kind: 'agent_simulation'
      scope: 'procedure'
      agentId: string
      procedureId: string
      procedureVersionId: string
    }
  | {
      // Whole agent: persona + procedure selection over the pinned set. No procedureId.
      kind: 'agent_simulation'
      scope: 'agent'
      agentId: string
    }

// ---- Comparators ----

export type Comparator =
  | { op: 'equals' }
  | { op: 'not_equals' }
  | { op: 'exists' }
  | { op: 'not_exists' }
  | { op: 'contains' }
  | { op: 'gt' | 'gte' | 'lt' | 'lte'; tolerance?: number }

/** Numeric-only comparator subset (used by workflow `execution_count`). */
export type NumericComparator = { op: 'gt' | 'gte' | 'lt' | 'lte' | 'equals'; tolerance?: number }

/** Argument matcher shared by tool mocks and tool-call assertions. */
export type ArgMatch = {
  mode: 'exact' | 'subset'
  value: Record<string, unknown>
}

// ---- Assertions (agent) ----
//
// Assertion DEFINITIONS are kind-specific; only `AssertionResult` is shared.

export type AgentEvalAssertion =
  | {
      id: string
      type: 'terminal_outcome'
      data: { outcome: 'finished' | 'handoff' | 'switch' }
    }
  | {
      // Agent-scope only: which procedure the agent routed to.
      id: string
      type: 'procedure_selected'
      data: { procedureId: string }
    }
  | {
      id: string
      type: 'response_criteria'
      data: { criteria: string[] }
    }
  | {
      id: string
      type: 'crm_field'
      data: { ref: FieldReference; comparator: Comparator; expected?: unknown }
    }
  | {
      id: string
      type: 'local_variable'
      data: { name: string; comparator: Comparator; expected?: unknown }
    }
  | {
      id: string
      type: 'tool_called' | 'tool_not_called'
      data: { toolName: string; args?: ArgMatch }
    }

// ---- Simulation config ----

export type SimulationToolMock = {
  id: string
  toolName: string
  args?: ArgMatch
  output: unknown
  usage: 'once' | 'repeat'
}

export type SimulationConfig = {
  openingMessage: string
  customerContext: string | null
  channel: 'chat' | 'email'
  timeFrozenAt: string | null
  maxCustomerTurns: number
  subject: {
    recordIds: RecordId[]
    identityVerified: boolean
    claimed?: { name?: string; email?: string }
    /**
     * Per-field override of the auto-from-contact resolution. A field is auto
     * (resolved from the subject contact into `claimed`) unless flagged manual
     * here. Only meaningful when a contact is selected; without one every field
     * is plain manual.
     */
    claimedManual?: { name?: boolean; email?: boolean }
  }
  startingFields: { ref: FieldReference; value: unknown }[]
  /** `passthrough_readonly` is opt-in and makes the run non-offline. Default `error`. */
  unmatchedToolPolicy: 'error' | 'passthrough_readonly'
  connectorMocks: SimulationToolMock[]
}

// ---- Trace & results (shared envelopes) ----

export type EvalTraceEvent = {
  id: string
  sequence: number
  timestamp: string
  kind: 'agent' | 'workflow' | 'system'
  type: string
  data: Record<string, unknown>
}

export type AssertionResult = {
  assertionId: string
  type: string
  definition: unknown
  status: 'passed' | 'failed' | 'error'
  actual?: unknown
  note?: string
}

// ---- Suite verdict diff (phase 5B) ----
//
// Read-side comparison of two terminal suite runs over the same case set.
// Computed on read — nothing here is persisted.

export type SuiteDiffBucket =
  | 'fixed' // baseline failed → candidate passed
  | 'regressed' // baseline passed → candidate failed
  | 'still_failing'
  | 'still_passing'
  | 'incomparable' // error | cancelled | timed_out on either side
  | 'uncompared' // caseId present in only one suite

/**
 * What drove a fixed/regressed flip: `'judge'` when only LLM-graded
 * `response_criteria` assertions changed (single flips can be noise),
 * `'deterministic'` when none did (signal), `'mixed'` otherwise.
 */
export type SuiteDiffFlipDriver = 'deterministic' | 'judge' | 'mixed'

export type SuiteDiffEntry = {
  caseId: string
  /** From the run's `definitionSnapshot` — survives case deletion. */
  caseName: string
  bucket: SuiteDiffBucket
  baseline?: { runId: string; status: EvalRunStatus }
  candidate?: { runId: string; status: EvalRunStatus }
  /** Present for fixed/regressed: which assertions changed status. */
  assertionFlips?: {
    assertionId: string
    type: string
    from: AssertionResult['status']
    to: AssertionResult['status']
  }[]
  flipDriver?: SuiteDiffFlipDriver
}

export type SuiteDiffSummary = {
  baselineSuiteRunId: string
  candidateSuiteRunId: string
  baselineRunMode: EvalRunMode
  candidateRunMode: EvalRunMode
  counts: Record<SuiteDiffBucket, number>
  /** Candidate − baseline pass-rate over comparable cases only; null when none. */
  passRateDelta: number | null
  /** Fixed/regressed entries whose flips were judge-graded only (noise caveat). */
  judgeOnlyFlips: number
  entries: SuiteDiffEntry[]
}
