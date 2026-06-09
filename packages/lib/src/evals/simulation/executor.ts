// packages/lib/src/evals/simulation/executor.ts
//
// `AgentSimExecutor` — drives the SAME agent loop production uses (selection →
// stepper → engine drain), but reconstructed from an immutable runtime snapshot,
// with tools mock-wrapped (fail-closed), a frozen framework clock, a startingFields
// field overlay, and a stepper observer that yields explicit terminal outcomes. A
// live LLM persona supplies each customer turn until the procedure reaches a
// terminal outcome, the persona is done, or the customer-turn cap trips.
//
// It performs NO writes to CRM data and NO real external tool calls (unless an
// idempotent tool is explicitly allowed through under passthrough_readonly). It
// returns terminal events, the recorded tool calls, the trace, usage, a final
// field/var resolver, and error metadata for the grader.
//
// See plans/evals/phase-1-agent-simulation.md §1.7.

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { EvalTraceEvent } from '@auxx/types/evals'
import { generateId } from '@auxx/utils/generateId'
import {
  type ClassifyDeps,
  type CompiledProcedure,
  type ConversationMessage,
  emptyStack,
  type ProcedureFrame,
  type ProcedureObserver,
  type ProcedureTransitionEvent,
  push,
  readProcedureRef,
  readProcedureSlice,
  runProcedureTurn,
  top,
  writeProcedureSlice,
} from '../../agents/procedures'
import { KopilotContextStore, readContextSlice } from '../../ai/agent-framework/context'
import { AgentEngine } from '../../ai/agent-framework/engine'
import { createCallModel } from '../../ai/agent-framework/llm-adapter'
import type { EvalFieldResolver, Subject, ToolContext } from '../../ai/agent-framework/tool-context'
import type { AgentEngineConfig, AgentEvent } from '../../ai/agent-framework/types'
import { getCachedAgentById } from '../../cache'
import type { CachedAgentProcedure } from '../../cache/org-cache-keys'
import {
  type AgentRuntimeSnapshotV1,
  buildEffectiveAgentRuntimeFromSnapshot,
  type SnapshotVerification,
} from '../runtime-snapshot'
import type { AgentDefinitionSnapshotV1 } from '../snapshots'
import type { EvalRunErrorCode } from '../types'
import { buildSimulationFieldResolver } from './field-resolver'
import { type ToolInvocationRecord, wrapToolsWithMocks } from './mock-tools'
import { LlmPersonaConversationSource } from './persona'

const logger = createScopedLogger('eval-executor')

export interface RunAgentSimulationInput {
  organizationId: string
  userId: string
  /** Synthetic session id for this run (never persisted as an AiAgentSession). */
  sessionId: string
  definitionSnapshot: AgentDefinitionSnapshotV1
  runtimeSnapshot: AgentRuntimeSnapshotV1
  signal?: AbortSignal
  /** Called for each trace event as it is produced (worker checkpoints + publishes). */
  onTrace?: (event: EvalTraceEvent) => void | Promise<void>
  /** Called between expensive boundaries so the worker can heartbeat / throw-if-cancelled. */
  onBoundary?: () => void | Promise<void>
}

export interface FinalResolver {
  resolveField: EvalFieldResolver
  resolveLocalVar: (name: string) => Promise<unknown>
}

export interface AgentSimulationResult {
  terminalOutcome: 'finished' | 'handoff' | 'switch' | null
  selectedProcedureId: string | null
  toolInvocations: ToolInvocationRecord[]
  transitions: ProcedureTransitionEvent[]
  trace: EvalTraceEvent[]
  /** Agent-visible prose turns, for `response_criteria` judging. */
  visibleAgentTurns: { eventId: string; text: string }[]
  customerTurns: number
  capExceeded: boolean
  /** True iff an idempotent tool ran for real under `passthrough_readonly`. */
  nonOffline: boolean
  usage: { totalTokens: number; llmCalls: number }
  verification: SnapshotVerification
  finalResolver: FinalResolver
  /** Present when the run could not complete cleanly (drives `error` status). */
  error?: { code: EvalRunErrorCode; message: string }
}

/**
 * Execute one agent Simulation from its immutable snapshots. Never throws for a
 * normal failure — execution errors are returned as `result.error` so the worker
 * can finalize the run as `error` while still grading what ran.
 */
export async function runAgentSimulation(
  input: RunAgentSimulationInput
): Promise<AgentSimulationResult> {
  const { organizationId, userId, sessionId, runtimeSnapshot, definitionSnapshot, signal } = input
  const config = definitionSnapshot.case.config
  const target = definitionSnapshot.case.target

  // Trace plumbing — monotonic sequence + stable ids.
  const trace: EvalTraceEvent[] = []
  let sequence = 0
  const emit = async (
    kind: EvalTraceEvent['kind'],
    type: string,
    data: Record<string, unknown>
  ): Promise<string> => {
    const event: EvalTraceEvent = {
      id: generateId('evt'),
      sequence: sequence++,
      timestamp: new Date().toISOString(),
      kind,
      type,
      data,
    }
    trace.push(event)
    await input.onTrace?.(event)
    return event.id
  }

  // Tool-mock collection.
  const toolInvocations: ToolInvocationRecord[] = []
  let unmatchedOccurred = false
  let nonOffline = false
  const wrapTools = (tools: Parameters<typeof wrapToolsWithMocks>[0]) =>
    wrapToolsWithMocks(tools, {
      mocks: config.connectorMocks,
      unmatchedPolicy: config.unmatchedToolPolicy,
      onInvocation: (rec) => {
        toolInvocations.push(rec)
        void emit('agent', 'tool_call', {
          toolName: rec.toolName,
          args: rec.args,
          mockId: rec.mockId,
          resolution: rec.resolution,
          captured: rec.captured,
          outputSummary: summarize(rec.output),
        })
      },
      onUnmatched: () => {
        unmatchedOccurred = true
      },
      onPassthrough: () => {
        nonOffline = true
      },
    })

  // 1–4. Reconstruct the runtime + verify against the snapshot.
  const { runtime, verification } = await buildEffectiveAgentRuntimeFromSnapshot({
    snapshot: runtimeSnapshot,
    organizationId,
    userId,
    sessionId,
    signal,
    wrapTools,
  })

  const baseResult = (over: Partial<AgentSimulationResult>): AgentSimulationResult => ({
    terminalOutcome: null,
    selectedProcedureId: null,
    toolInvocations,
    transitions,
    trace,
    visibleAgentTurns,
    customerTurns,
    capExceeded: false,
    nonOffline,
    usage: { totalTokens, llmCalls },
    verification,
    finalResolver,
    ...over,
  })

  // Shared mutable run state referenced by baseResult().
  const transitions: ProcedureTransitionEvent[] = []
  const visibleAgentTurns: { eventId: string; text: string }[] = []
  let customerTurns = 0
  let totalTokens = 0
  let llmCalls = 0

  // Hard-incompatible snapshot (tool missing or schema digest drifted) → reject
  // before any model/tool call. A code-revision-only difference is a soft warning.
  if (!verification.compatible) {
    await emit('system', 'snapshot_incompatible', {
      missingTools: verification.missingTools,
      digestMismatches: verification.digestMismatches,
    })
    const finalResolver: FinalResolver = {
      resolveField: async () => undefined,
      resolveLocalVar: async () => undefined,
    }
    return {
      terminalOutcome: null,
      selectedProcedureId: null,
      toolInvocations,
      transitions,
      trace,
      visibleAgentTurns,
      customerTurns: 0,
      capExceeded: false,
      nonOffline,
      usage: { totalTokens: 0, llmCalls: 0 },
      verification,
      finalResolver,
      error: {
        code: 'SNAPSHOT_INCOMPATIBLE',
        message: `Snapshot incompatible: missing [${verification.missingTools.join(', ')}], drifted [${verification.digestMismatches.join(', ')}]`,
      },
    }
  }
  if (verification.codeRevisionDrifted) {
    await emit('system', 'code_revision_drift', {
      snapshot: verification.snapshotCodeRevision,
      current: verification.currentCodeRevision,
    })
  }

  // 5. Build the field overlay (subject + startingFields). No CRM writes.
  const overlayResult = buildSimulationFieldResolver({
    organizationId,
    subject: config.subject,
    startingFields: config.startingFields,
  })
  if (overlayResult.isErr()) {
    await emit('system', 'config_invalid', { message: overlayResult.error.message })
    const finalResolver: FinalResolver = {
      resolveField: async () => undefined,
      resolveLocalVar: async () => undefined,
    }
    return {
      terminalOutcome: null,
      selectedProcedureId: null,
      toolInvocations,
      transitions,
      trace,
      visibleAgentTurns,
      customerTurns: 0,
      capExceeded: false,
      nonOffline,
      usage: { totalTokens: 0, llmCalls: 0 },
      verification,
      finalResolver,
      error: { code: 'EXECUTION_ERROR', message: overlayResult.error.message },
    }
  }
  const overlay = overlayResult.value
  const subject: Subject = overlay.subject

  // Frozen framework clock (epoch ms) — drives ctx.now + sys:now + classifiers.
  const nowMs = config.timeFrozenAt ? Date.parse(config.timeFrozenAt) : undefined
  const frozenNow = nowMs !== undefined && !Number.isNaN(nowMs) ? nowMs : undefined

  // A standalone ctx the overlay resolver delegates to for subject reads (it is
  // assigned as `ctx.evalFieldResolver` on every engine-built ctx, so it must be
  // self-contained — it can't depend on the engine's per-call ctx).
  const overlayCtx = buildToolCtx({
    organizationId,
    userId,
    sessionId,
    signal,
    subject,
    appAccounts: runtime.agentConfig.appAccounts,
    nowMs: frozenNow,
    domainState: {},
  })
  const overlayResolver: EvalFieldResolver = overlay.makeResolver(overlayCtx)

  // One callModel serves both the agent (engine) and the persona; provider/model
  // come from the call params, so the persona pins the persona model per call.
  const callModel = createCallModel({
    organizationId,
    userId,
    source: 'eval',
    sourceId: sessionId,
  })

  const engineConfig: AgentEngineConfig = {
    organizationId,
    userId,
    sessionId,
    db: database,
    domainConfig: runtime.domainConfig,
    callModel,
    signal,
    applyToolRestrictions: runtime.applyToolRestrictions,
    subject,
    appAccounts: runtime.agentConfig.appAccounts,
    approvalMode: 'auto', // autonomous — no human in the loop; writes are mock-bypassed
    nowMs: frozenNow,
    evalFieldResolver: overlayResolver,
    maxTotalIterations: runtimeSnapshot.limits.maxIterations,
  }
  const engine = new AgentEngine(engineConfig, { messages: [], domainState: {} })

  const liveDomainState = () => engine.getState().domainState as Record<string, unknown>

  // Resolve the procedure set the run executes against (pinned compiled graphs).
  const candidates = await resolveSnapshotProcedures(organizationId, runtimeSnapshot)
  const hasProcedures = candidates.length > 0

  // scope='procedure': seed the pinned frame directly so selection sticky-resumes
  // (no classifier call). scope='agent': leave the stack empty so production
  // selection routes over the pinned set.
  let selectedProcedureId: string | null = null
  if (target.scope === 'procedure' && candidates[0]) {
    const seeded = seedFrame(candidates[0])
    const stack = push(emptyStack(), seeded)
    writeProcedureSlice(liveDomainState(), stack)
    selectedProcedureId = seeded.procedureId
  }

  // Observer — records every transition; first procedureId seen is the selection.
  let sawProcedureFinished = false
  let sawSwitch = false
  let handedOff = false
  const observer: ProcedureObserver = (event) => {
    transitions.push(event)
    if (!selectedProcedureId) selectedProcedureId = event.procedureId
    if (event.type === 'procedure_finished') sawProcedureFinished = true
    if (event.type === 'routing' && event.outcome === 'switch') sawSwitch = true
    if (event.type === 'routing' && event.outcome === 'handoff') handedOff = true
  }

  const buildCtx = (): ToolContext => {
    const ctx = buildToolCtx({
      organizationId,
      userId,
      sessionId,
      signal,
      subject,
      appAccounts: runtime.agentConfig.appAccounts,
      nowMs: frozenNow,
      domainState: liveDomainState(),
    })
    ctx.evalFieldResolver = overlayResolver
    return ctx
  }

  const classifyDeps: ClassifyDeps = {
    db: database,
    organizationId,
    userId,
    model: runtime.utilityModel.model,
    provider: runtime.utilityModel.provider,
  }

  // Drain one engine pass: emit trace + accumulate usage, return the reply text.
  const drain = async (gen: AsyncGenerator<AgentEvent>): Promise<string> => {
    let text = ''
    for await (const event of gen) {
      if (signal?.aborted) {
        engine.interrupt()
        break
      }
      if (event.type === 'assistant-message-finished') {
        const t = event.parts
          .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
          .map((p) => p.text)
          .join('')
        if (t.trim()) text = t
        if (event.usage) {
          totalTokens += event.usage.total_tokens ?? 0
          llmCalls += 1
        }
      }
    }
    return text
  }

  const persona = new LlmPersonaConversationSource({
    openingMessage: config.openingMessage,
    customerContext: config.customerContext,
    channel: config.channel,
    model: runtimeSnapshot.personaModel,
    callModel,
    signal,
  })

  // Build the final resolver up-front (it reads the LIVE domain state at call time).
  const pinnedVersionId =
    target.scope === 'procedure'
      ? runtimeSnapshot.procedures[0]?.versionId
      : runtimeSnapshot.procedures.find((p) => p.id === selectedProcedureId)?.versionId
  const finalResolver: FinalResolver = {
    resolveField: overlayResolver,
    resolveLocalVar: async (name) => {
      const versionId =
        pinnedVersionId ??
        (selectedProcedureId
          ? runtimeSnapshot.procedures.find((p) => p.id === selectedProcedureId)?.versionId
          : undefined)
      if (!versionId) return undefined
      // Read the version-scoped local attribute (`var:__la:<versionId>:<name>`) off
      // the final context store via the sanctioned ref API (gates by absence).
      const frame = { procedureVersionId: versionId } as ProcedureFrame
      return readProcedureRef(buildCtx(), frame, `var:${name}`)
    },
  }

  // 9–11. The customer-turn loop.
  let capExceeded = false
  let executionError: { code: EvalRunErrorCode; message: string } | undefined
  try {
    const visible: ConversationMessage[] = []
    const maxTurns = config.maxCustomerTurns
    while (customerTurns < maxTurns) {
      await input.onBoundary?.()
      if (signal?.aborted) break

      const turn = await persona.nextTurn(visible)
      if (turn.done) break
      if (turn.usage) {
        totalTokens += turn.usage.totalTokens
        llmCalls += 1
      }
      customerTurns += 1
      await emit('system', 'customer_message', { text: turn.text, turn: customerTurns })

      const conversation: ConversationMessage[] = [...visible, { role: 'user', content: turn.text }]

      let reply = ''
      if (hasProcedures) {
        reply = await runProcedureTurn({
          engine,
          inboundText: turn.text,
          procedures: candidates,
          subject,
          conversation,
          classifyDeps,
          buildCtx,
          drain,
          observer,
          onHandoff: () => {
            handedOff = true
          },
        })
      } else {
        reply = await drain(engine.submitMessage(turn.text, {}))
      }

      visible.push({ role: 'user', content: turn.text })
      visible.push({ role: 'assistant', content: reply })
      const eventId = await emit('agent', 'agent_message', { text: reply, turn: customerTurns })
      if (reply.trim()) visibleAgentTurns.push({ eventId, text: reply })

      // Terminal outcome derivation (explicit, from observer + handoff signal).
      if (handedOff) break
      const finalStack = readProcedureSlice(liveDomainState()) ?? emptyStack()
      if (hasProcedures && sawProcedureFinished && top(finalStack) === undefined) break
    }
    capExceeded = customerTurns >= maxTurns && !handedOff && !terminalReached(liveDomainState())
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Simulation execution failed', { sessionId, error: message })
    executionError = { code: 'EXECUTION_ERROR', message }
    await emit('system', 'execution_error', { message })
  }

  // Derive the terminal outcome from explicit signals only.
  const finalStack = readProcedureSlice(liveDomainState()) ?? emptyStack()
  const terminalOutcome: AgentSimulationResult['terminalOutcome'] = handedOff
    ? 'handoff'
    : hasProcedures && sawProcedureFinished && top(finalStack) === undefined
      ? 'finished'
      : sawSwitch && !capExceeded
        ? 'switch'
        : null

  await emit('system', 'terminal', {
    terminalOutcome,
    capExceeded,
    customerTurns,
  })

  // Error precedence: hard execution error > unmatched mock (fail closed) > cap.
  const error =
    executionError ??
    (unmatchedOccurred
      ? {
          code: 'UNMATCHED_MOCK' as const,
          message: 'A tool call had no matching mock (fail closed)',
        }
      : capExceeded
        ? {
            code: 'TURN_CAP_EXCEEDED' as const,
            message: 'Customer-turn cap reached before a terminal outcome',
          }
        : undefined)

  return baseResult({
    terminalOutcome,
    selectedProcedureId,
    capExceeded,
    nonOffline,
    usage: { totalTokens, llmCalls },
    ...(error ? { error } : {}),
  })
}

// ── helpers ───────────────────────────────────────────────────────────────

/** Whether the live stack has reached a terminal (empty) state for a procedure run. */
function terminalReached(domainState: Record<string, unknown>): boolean {
  const stack = readProcedureSlice(domainState) ?? emptyStack()
  return top(stack) === undefined
}

interface BuildCtxArgs {
  organizationId: string
  userId: string
  sessionId: string
  signal?: AbortSignal
  subject: Subject
  appAccounts?: Record<string, { credId: string }>
  nowMs?: number
  domainState: Record<string, unknown>
}

function buildToolCtx(args: BuildCtxArgs): ToolContext {
  const base = {
    db: database,
    organizationId: args.organizationId,
    userId: args.userId,
    sessionId: args.sessionId,
    signal: args.signal,
    subject: args.subject,
    appAccounts: args.appAccounts,
    now: args.nowMs,
  }
  return {
    ...base,
    context: new KopilotContextStore({
      ctx: base as ToolContext,
      initial: readContextSlice(args.domainState),
    }),
  }
}

/** A fresh running frame seeded at a pinned procedure's entry step (scope='procedure'). */
function seedFrame(candidate: CachedAgentProcedure): ProcedureFrame {
  const compiled = candidate.compiled as CompiledProcedure
  return {
    procedureId: candidate.procedureId,
    procedureVersionId: candidate.activeVersionId,
    cursor: compiled.entryStepId,
    status: 'running',
    history: [],
    pushedBy: 'selection',
  }
}

/**
 * Build the `CachedAgentProcedure[]` the run executes against. The compiled graph
 * + version are PINNED from the snapshot; selection metadata (whenToUse / ruleset /
 * triggerExamples) is read live from the org cache (it only affects agent-scope
 * routing, which v1 does not freeze). Procedures absent from the live cache still
 * run with empty selection metadata (fine for procedure-scope, which skips selection).
 */
async function resolveSnapshotProcedures(
  organizationId: string,
  snapshot: AgentRuntimeSnapshotV1
): Promise<CachedAgentProcedure[]> {
  const agent = await getCachedAgentById(organizationId, snapshot.agent.id)
  const live = new Map((agent?.procedures ?? []).map((p) => [p.procedureId, p]))
  return snapshot.procedures.map((proc) => {
    const base = live.get(proc.id)
    return {
      ...(base ?? {
        linkId: `eval-${proc.id}`,
        procedureId: proc.id,
        enabled: true,
        priority: 0,
        whenToUse: '',
        triggerExamples: [],
        ruleset: [],
      }),
      procedureId: proc.id,
      activeVersionId: proc.versionId,
      compiled: proc.compiled,
    } as unknown as CachedAgentProcedure
  })
}

/** Small, redaction-safe summary of a tool output for the trace. */
function summarize(output: unknown): unknown {
  if (output === null || typeof output !== 'object') return output
  const json = JSON.stringify(output)
  if (json.length <= 500) return output
  return { _truncated: true, length: json.length, preview: json.slice(0, 500) }
}
