// packages/lib/src/ai/agent-framework/engine.ts

import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils/generateId'
import type { UsageMetrics } from '../clients/base/types'
import { KopilotContextStore, readContextSlice, syncContextSlice } from './context'
import { manageContext } from './context-manager'
import { type AgentQueryResumeHint, agentQueryLoop } from './query-loop'
import type { ToolContext } from './tool-context'
import {
  type AgentDefinition,
  type AgentEngineConfig,
  type AgentEvent,
  type AgentState,
  type AssistantSessionMessage,
  type ContentPart,
  createEmptyTurnSnapshots,
  type IterationUsage,
  type ResumeOptions,
  type Route,
  type SessionMessage,
  type SystemSessionMessage,
  type ToolCallPart,
  type TurnBudget,
  type TurnErrorReason,
  type TurnOutcome,
  type TurnUsageSummary,
} from './types'
import { meterRollupTokens, normalizeCallUsage } from './usage-metering'
import { buildToolDigest, executeToolWithProgress } from './utils'

const logger = createScopedLogger('agent-engine')
const DEFAULT_MAX_TOTAL_ITERATIONS = 50
const DEFAULT_MAX_TOKENS_PER_TURN = 200_000
const DEFAULT_MAX_APPROVALS_PER_TURN = 5

/**
 * The `turn-error` reasons that mean "ran out of room", not "went wrong".
 * A turn that trips one of these has already done N complete, individually
 * valid pieces of work — nothing is broken, so `onTurnEnd` hears `'exhausted'`
 * rather than `'error'`. Membership is what keeps the mapping off the
 * human-readable `error` string.
 */
const EXHAUSTION_REASONS: ReadonlySet<TurnErrorReason> = new Set([
  'token-budget',
  'max-iterations',
  'max-approvals',
  'tool-failure-streak',
])

/**
 * AgentEngine — session owner and turn orchestrator.
 *
 * One assistant message per turn; the engine owns the runtime state for a
 * single session and drives the per-turn query loop, resume, and budget
 * enforcement.
 */
export class AgentEngine {
  private config: AgentEngineConfig
  private state: AgentState
  private abortController: AbortController | null = null
  private turnId: string | null = null
  private turnTokensUsed = 0
  /**
   * What `maxTokensPerTurn` is actually compared against — see
   * {@link AgentEngine.accumulateUsage}. Deliberately separate from
   * `turnTokensUsed`, which stays the provider-reported grand total so
   * `TurnUsageSummary` keeps reporting what the turn really consumed.
   */
  private turnMeteredTokens = 0
  private turnPromptTokens = 0
  private turnCompletionTokens = 0
  private turnLlmCalls = 0

  constructor(config: AgentEngineConfig, initialState?: AgentState) {
    this.config = config
    this.state = initialState ?? {
      messages: [],
      domainState: config.domainConfig.createInitialState({}),
    }
  }

  /** Current session state (read-only snapshot) */
  getState(): AgentState {
    return { ...this.state }
  }

  /**
   * Submit a user message and run the turn.
   * Yields AgentEvents for every phase of execution.
   */
  async *submitMessage(
    userMessage: string,
    context?: Record<string, unknown>,
    opts?: {
      /** Stamped onto the user message record (e.g. task-notification origin markers). */
      metadata?: Record<string, unknown>
    }
  ): AsyncGenerator<AgentEvent> {
    this.turnId = generateId('turn')
    this.resetTurnUsage()

    if (context && this.config.domainConfig.applyContext) {
      this.state = {
        ...this.state,
        domainState: this.config.domainConfig.applyContext(this.state.domainState, context),
      }
    }

    const userMsg: SessionMessage = {
      id: generateId('msg'),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      ...(opts?.metadata ? { metadata: opts.metadata } : {}),
    }
    // A fresh user message means the user is abandoning whatever was paused.
    // Drop pendingToolCall (the paused message already lives in state.messages
    // with a tool_call part at 'awaiting-approval'; the LLM will see it on
    // the next call. Frontend treats abandonment as the user moving on).
    this.state = {
      ...this.state,
      messages: [...this.state.messages, userMsg],
      waitingForApproval: false,
      pendingToolCall: undefined,
      approvalsThisTurn: 0,
      turnSnapshots: createEmptyTurnSnapshots(),
      capturedActions: [],
      // Clear per-turn domain state (e.g. KB articles touched this turn). Only
      // on a fresh user turn — resume() continues the same turn and must keep it.
      domainState:
        this.config.domainConfig.resetTurnDomainState?.(
          this.state.domainState as Record<string, unknown>
        ) ?? this.state.domainState,
    }

    logger.info('Turn submitted', {
      turnId: this.turnId,
      sessionId: this.config.sessionId,
      messageLength: userMessage.length,
      totalMessages: this.state.messages.length,
      contextKeys: context ? Object.keys(context) : [],
      contextSummary: this.config.domainConfig.summarizeContext?.(context),
    })

    const configWithAbort = this.startTurnAbort()

    try {
      yield* this.withTurnEnd(this.tagTurnId(this.runPipeline(configWithAbort)))
    } finally {
      this.abortController = null
    }
  }

  /**
   * Resume a paused session after the user approves or rejects a tool call.
   *
   * On **approve**: executes the pending tool, mutates the tool_call part in
   * place (status: 'completed' / 'error' + output / digest), then re-enters
   * the same agent's query loop so it can append more parts (text, more
   * tool_calls) to the SAME assistant message.
   *
   * On **reject**: mutates the part to `status: 'rejected'` with a synthetic
   * `{ rejected: true, reason }` output and re-enters the loop.
   */
  async *resume(opts: ResumeOptions): AsyncGenerator<AgentEvent> {
    if (opts.resumeState) {
      this.state = opts.resumeState
    }

    this.turnId = generateId('turn')
    this.resetTurnUsage()

    if (opts.context && this.config.domainConfig.applyContext) {
      this.state = {
        ...this.state,
        domainState: this.config.domainConfig.applyContext(this.state.domainState, opts.context),
      }
    }

    const pending = this.state.pendingToolCall
    if (!pending) {
      yield this.tagEvent({
        type: 'turn-error',
        error: 'No pending tool call to resume',
        reason: 'internal',
      })
      return
    }

    const route = this.state.currentRoute ?? 'default'

    const configWithAbort = this.startTurnAbort()

    try {
      yield* this.withTurnEnd(this.tagTurnId(this.runResume(opts, route, configWithAbort)))
    } finally {
      this.abortController = null
    }
  }

  /**
   * Re-run the query loop in the SAME customer turn WITHOUT appending a user
   * message or resetting turn-scoped state.
   *
   * The v9 procedure stepper calls this for a same-turn `reinvoke`
   * (advance/digress/end): the caller has already mutated `domainState` (advanced
   * the procedure stack + the active step the prompt reads), and wants the model
   * to generate again against the NEW system prompt with no phantom customer
   * message. Unlike {@link submitMessage} it does NOT append a `user` message,
   * does NOT call `resetTurnDomainState`, and does NOT reset turn usage/snapshots/
   * captures — they ACCUMULATE across continuations so the turn budget bounds a
   * runaway reinvoke loop. The current `turnId` is reused (it's one logical turn).
   *
   * Pre-launch invariant: the caller is responsible for ensuring the stack
   * genuinely changed before re-invoking (the stepper's `reinvoke` flag), or the
   * model would regenerate against an unchanged prompt.
   */
  async *continueTurn(): AsyncGenerator<AgentEvent> {
    if (!this.turnId) this.turnId = generateId('turn')

    const configWithAbort = this.startTurnAbort()

    logger.info('Turn continued (no new user message)', {
      turnId: this.turnId,
      sessionId: this.config.sessionId,
      totalMessages: this.state.messages.length,
    })

    try {
      yield* this.withTurnEnd(this.tagTurnId(this.runPipeline(configWithAbort)))
    } finally {
      this.abortController = null
    }
  }

  /** Abort the current turn execution. */
  interrupt(): void {
    this.abortController?.abort()
  }

  // ===== TURN PIPELINE =====

  private async *runPipeline(config: AgentEngineConfig): AsyncGenerator<AgentEvent> {
    const { domainConfig } = config
    const budget = this.buildTurnBudget(config)

    this.state = {
      ...this.state,
      messages: await manageContext(this.state.messages, config),
    }

    logger.debug('Context managed', {
      turnId: this.turnId,
      messageCount: this.state.messages.length,
    })

    let route: Route | undefined
    if (domainConfig.supervisorAgent) {
      const supervisor = domainConfig.agents[domainConfig.supervisorAgent]
      if (!supervisor) {
        yield this.tagEvent({
          type: 'turn-error',
          error: `Supervisor agent "${domainConfig.supervisorAgent}" not found`,
          reason: 'internal',
        })
        return
      }
      yield* this.runAgentAndUpdateState(supervisor, config)
      if (config.signal?.aborted) return
      const routeName = this.state.currentRoute
      logger.info('Route selected', { turnId: this.turnId, route: routeName })
      route = domainConfig.routes.find((r) => r.name === routeName) ?? domainConfig.routes[0]
    } else {
      route = domainConfig.routes[0]
      this.state = { ...this.state, currentRoute: route?.name }
    }

    if (!route) {
      yield this.tagEvent({
        type: 'turn-error',
        error: `No routes configured in domain "${domainConfig.type}"`,
        reason: 'internal',
      })
      return
    }

    yield* this.executeRoute(route, config, budget)
  }

  private async *executeRoute(
    route: Route,
    config: AgentEngineConfig,
    budget: TurnBudget
  ): AsyncGenerator<AgentEvent> {
    yield this.tagEvent({ type: 'turn-started', route: route.name, agents: route.agents, budget })
    logger.info('Turn started', {
      turnId: this.turnId,
      route: route.name,
      agents: route.agents,
      budget,
    })

    let totalIterations = 0

    for (const agentName of route.agents) {
      if (config.signal?.aborted) break
      if (totalIterations >= budget.maxIterations) {
        logger.warn('Max total iterations exceeded — closing the turn', {
          turnId: this.turnId,
          sessionId: this.config.sessionId,
          reason: 'max-iterations',
          totalIterations,
          maxIterations: budget.maxIterations,
          turnTokensUsed: this.turnTokensUsed,
          turnMeteredTokens: this.turnMeteredTokens,
          llmCalls: this.turnLlmCalls,
        })
        yield this.tagEvent({
          type: 'turn-error',
          error: 'Max total iterations exceeded',
          reason: 'max-iterations',
        })
        return
      }
      if (this.turnMeteredTokens >= budget.maxTokensPerTurn) {
        yield this.tokenBudgetExit(budget)
        return
      }

      if (agentName === config.domainConfig.supervisorAgent) continue

      const agent = config.domainConfig.agents[agentName]
      if (!agent) {
        yield this.tagEvent({
          type: 'turn-error',
          error: `Agent "${agentName}" not found in domain config`,
          reason: 'internal',
        })
        return
      }

      for await (const event of this.runAgentAndUpdateState(agent, config)) {
        yield event
        if (event.type === 'turn-error') return
        // Roll up usage from each assistant message finish for budget enforcement.
        if (event.type === 'assistant-message-finished' && event.usage) {
          // `assistant-message-finished` fires ONCE PER AGENT RUN, not once per
          // LLM iteration — so `totalIterations++` made `maxTotalIterations`
          // count agents in the route, which is structurally unreachable on a
          // single-agent route (1 vs a cap of 100). The event's `iterations`
          // array is the per-LLM-call billing breakdown for this segment, so it
          // is the real iteration count. Caveat: query-loop skips zero-usage
          // calls when building it, so this slightly UNDERCOUNTS — still vastly
          // closer to the knob's documented meaning than a flat 1.
          totalIterations += event.iterations?.length ?? 1
          this.accumulateUsage(event)
          if (this.turnMeteredTokens >= budget.maxTokensPerTurn) {
            yield this.tokenBudgetExit(budget)
            return
          }
        }
      }

      if (this.state.waitingForApproval) {
        logger.info('Turn paused for approval', { turnId: this.turnId })
        return
      }
    }

    // Defensive sweep: flip any tool_call parts left in 'running' state.
    // Normal completion paths in query-loop already do this; this catches
    // abnormal exits where the engine returns control without query-loop
    // settling.
    this.sweepRunningToolParts('Turn ended before tool completed')

    yield this.tagEvent({
      type: 'turn-completed',
      route: route.name,
      usage: this.snapshotTurnUsage(),
    })
    logger.info('Turn completed', {
      turnId: this.turnId,
      route: route.name,
      totalIterations,
      ...this.snapshotTurnUsage(),
    })
  }

  // ===== RESUME =====

  private async *runResume(
    opts: ResumeOptions,
    route: string,
    config: AgentEngineConfig
  ): AsyncGenerator<AgentEvent> {
    const pending = this.state.pendingToolCall!
    const budget = this.buildTurnBudget(config)

    yield this.tagEvent({ type: 'turn-started', route, agents: [pending.agentName], budget })

    // Locate the paused tool_call part. The assistant message is already in
    // state.messages (it was persisted when the part flipped to
    // 'awaiting-approval'); we mutate the part in place.
    const lookup = this.findPendingPart(pending.messageId, pending.partIndex, pending.toolCallId)
    if (!lookup) {
      yield this.tagEvent({
        type: 'turn-error',
        error: `Paused tool_call part not found (messageId=${pending.messageId}, partIndex=${pending.partIndex})`,
        reason: 'internal',
      })
      return
    }

    if (opts.action === 'reject') {
      const rejectionOutput = { rejected: true, reason: 'User declined the action' }
      this.mutatePart(pending.messageId, pending.partIndex, (p) => {
        const tc = p as ToolCallPart
        tc.status = 'rejected'
        tc.output = rejectionOutput
      })
      this.updateApprovalMessageStatus(pending.toolCallId, 'rejected')
      yield this.tagEvent({
        type: 'tool-call-status',
        messageId: pending.messageId,
        partIndex: pending.partIndex,
        toolCallId: pending.toolCallId,
        agent: pending.agentName,
        status: 'rejected',
      })
      this.state = {
        ...this.state,
        waitingForApproval: false,
        pendingToolCall: undefined,
      }
    } else {
      const agent = config.domainConfig.agents[pending.agentName]
      const tool = agent?.tools.find((t) => t.name === pending.toolName)
      if (!tool) {
        // The resumed turn was rebuilt with a toolset that no longer contains
        // the paused tool (e.g. a continuation that lost its page surface).
        // Settle the part as an error WITH an output so it projects a valid
        // `tool_result` — leaving it 'awaiting-approval' dangles the
        // `tool_use` and the next turn 400s on the provider. Mirrors the
        // restriction-error path below.
        const notFoundError = `Tool "${pending.toolName}" not found on agent "${pending.agentName}"`
        this.mutatePart(pending.messageId, pending.partIndex, (p) => {
          const tc = p as ToolCallPart
          tc.status = 'error'
          tc.error = notFoundError
        })
        yield this.tagEvent({
          type: 'tool-call-failed',
          messageId: pending.messageId,
          partIndex: pending.partIndex,
          toolCallId: pending.toolCallId,
          agent: pending.agentName,
          error: notFoundError,
        })
        this.state = {
          ...this.state,
          waitingForApproval: false,
          pendingToolCall: undefined,
        }
        return
      }

      // Validate input amendment.
      if (opts.inputAmendment && tool.inputAmendmentSchema) {
        const parsed = tool.inputAmendmentSchema.safeParse(opts.inputAmendment)
        if (!parsed.success) {
          const issues = parsed.error.issues
            .slice(0, 3)
            .map((i) => i.message)
            .join('; ')
          yield this.tagEvent({
            type: 'turn-error',
            error: `Invalid input amendment for "${pending.toolName}": ${issues}`,
            reason: 'internal',
          })
          return
        }
      }

      let finalArgs = opts.inputAmendment
        ? { ...pending.args, ...opts.inputAmendment }
        : pending.args
      const baseCtx = {
        db: config.db,
        organizationId: config.organizationId,
        userId: config.userId,
        sessionId: config.sessionId,
        agentId: config.agentId,
        signal: config.signal,
        turnId: this.turnId ?? undefined,
        traceId: this.turnId ?? undefined,
        workflow: config.workflow,
        subject: config.subject,
        appAccounts: config.appAccounts,
        agentName: pending.agentName,
        now: config.nowMs ?? Date.now(),
        evalFieldResolver: config.evalFieldResolver,
      }
      // Fresh ctx on resume — rehydrate the context store from the persisted
      // slice so captures made before the approval pause survive the resume.
      const ctx: ToolContext = {
        ...baseCtx,
        context:
          config.context ??
          new KopilotContextStore({
            ctx: baseCtx as ToolContext,
            initial: readContextSlice(this.state.domainState as Record<string, unknown>),
          }),
      }

      // Per-agent restriction clamp (approval-resume) — pins / overrides args
      // before validateInputs / execute, so a pinned arg can't be smuggled in
      // via an amended approval.
      if (config.applyToolRestrictions) {
        const r = await config.applyToolRestrictions(pending.toolName, finalArgs, ctx)
        if (!r.ok) {
          logger.info('applyToolRestrictions refused approved tool', {
            turnId: this.turnId,
            tool: pending.toolName,
            error: r.error,
          })
          this.mutatePart(pending.messageId, pending.partIndex, (p) => {
            const tc = p as ToolCallPart
            tc.status = 'error'
            tc.error = r.error
            tc.args = finalArgs
            if (opts.inputAmendment) tc.inputAmendment = opts.inputAmendment
          })
          yield this.tagEvent({
            type: 'tool-call-failed',
            messageId: pending.messageId,
            partIndex: pending.partIndex,
            toolCallId: pending.toolCallId,
            agent: pending.agentName,
            error: r.error,
          })
          this.state = {
            ...this.state,
            waitingForApproval: false,
            pendingToolCall: undefined,
          }
          return
        }
        finalArgs = r.args
      }

      // Re-run input validation on merged args.
      if (tool.validateInputs) {
        const v = await tool.validateInputs(finalArgs, ctx)
        if (!v.ok) {
          logger.info('Approved tool validateInputs failed', {
            turnId: this.turnId,
            tool: pending.toolName,
            error: v.error,
          })
          this.mutatePart(pending.messageId, pending.partIndex, (p) => {
            const tc = p as ToolCallPart
            tc.status = 'error'
            tc.error = v.error
            tc.args = finalArgs
            if (opts.inputAmendment) tc.inputAmendment = opts.inputAmendment
          })
          yield this.tagEvent({
            type: 'tool-call-failed',
            messageId: pending.messageId,
            partIndex: pending.partIndex,
            toolCallId: pending.toolCallId,
            agent: pending.agentName,
            error: v.error,
          })
          this.state = {
            ...this.state,
            waitingForApproval: false,
            pendingToolCall: undefined,
          }
          return
        }
        if (v.warnings?.length) {
          logger.info('validateInputs warnings (resume)', {
            tool: pending.toolName,
            warnings: v.warnings,
          })
        }
        finalArgs = v.args
      }

      // Switch the part to running so the UI can morph the approval card.
      this.mutatePart(pending.messageId, pending.partIndex, (p) => {
        const tc = p as ToolCallPart
        tc.status = 'running'
        tc.args = finalArgs
        if (opts.inputAmendment) tc.inputAmendment = opts.inputAmendment
      })
      this.updateApprovalMessageStatus(pending.toolCallId, 'approved')
      yield this.tagEvent({
        type: 'tool-call-status',
        messageId: pending.messageId,
        partIndex: pending.partIndex,
        toolCallId: pending.toolCallId,
        agent: pending.agentName,
        status: 'running',
      })

      try {
        const result = await executeToolWithProgress(tool, finalArgs, ctx)
        const digest = result.success ? buildToolDigest(tool, result.output, logger) : undefined

        // Capture the approved tool's result into the context store before
        // domain hooks. Persisted below so the re-entered query loop — which
        // rehydrates its own store from `domainState` — sees this capture.
        if (result.success) {
          ctx.context.captureToolResult(pending.toolCallId, pending.toolName, result.output)
        }

        // Domain state mining + transform.
        let postHookState = this.state
        if (result.success && config.domainConfig.onToolResult) {
          postHookState = config.domainConfig.onToolResult(pending.toolName, result, this.state)
        }
        let llmFacingResult = result
        if (result.success && config.domainConfig.transformToolResult) {
          const transformed = config.domainConfig.transformToolResult(
            pending.toolName,
            result,
            postHookState
          )
          if (transformed) llmFacingResult = transformed
        }

        this.state = postHookState

        // Persist the context slice (incl. the capture above) so the re-entered
        // query loop rehydrates it from `domainState`. No-op for the workflow ECM.
        if (ctx.context instanceof KopilotContextStore) {
          const domainState = { ...(this.state.domainState as Record<string, unknown>) }
          syncContextSlice(domainState, ctx.context)
          this.state = { ...this.state, domainState }
        }

        // Mutate the part in place.
        this.mutatePart(pending.messageId, pending.partIndex, (p) => {
          const tc = p as ToolCallPart
          if (llmFacingResult.success) {
            tc.status = 'completed'
            tc.output = llmFacingResult.output
            if (digest !== undefined) tc.digest = digest
          } else {
            tc.status = 'error'
            tc.error = llmFacingResult.error ?? 'Unknown error'
            tc.output = llmFacingResult.output
          }
        })

        if (llmFacingResult.success) {
          yield this.tagEvent({
            type: 'tool-call-completed',
            messageId: pending.messageId,
            partIndex: pending.partIndex,
            toolCallId: pending.toolCallId,
            agent: pending.agentName,
            output: llmFacingResult.output,
            ...(digest !== undefined ? { digest } : {}),
          })
        } else {
          yield this.tagEvent({
            type: 'tool-call-failed',
            messageId: pending.messageId,
            partIndex: pending.partIndex,
            toolCallId: pending.toolCallId,
            agent: pending.agentName,
            error: llmFacingResult.error ?? 'Unknown error',
          })
        }

        this.state = {
          ...this.state,
          waitingForApproval: false,
          pendingToolCall: undefined,
          approvalsThisTurn: (this.state.approvalsThisTurn ?? 0) + 1,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error('Approved tool execution failed', {
          turnId: this.turnId,
          tool: pending.toolName,
          error: errorMessage,
        })
        this.mutatePart(pending.messageId, pending.partIndex, (p) => {
          const tc = p as ToolCallPart
          tc.status = 'error'
          tc.error = errorMessage
        })
        yield this.tagEvent({
          type: 'tool-call-failed',
          messageId: pending.messageId,
          partIndex: pending.partIndex,
          toolCallId: pending.toolCallId,
          agent: pending.agentName,
          error: errorMessage,
        })
        this.state = {
          ...this.state,
          waitingForApproval: false,
          pendingToolCall: undefined,
        }
      }
    }

    // Enforce max-approvals cap. This fires BETWEEN approvals — the one that
    // tripped it already executed and settled — so it is exhaustion, not
    // corruption. A long authoring turn that chains approvals is exactly the
    // shape that reaches it.
    if ((this.state.approvalsThisTurn ?? 0) > budget.maxApprovalsPerTurn) {
      logger.warn('Max approvals per turn exceeded — closing the turn', {
        turnId: this.turnId,
        sessionId: this.config.sessionId,
        reason: 'max-approvals',
        approvalsThisTurn: this.state.approvalsThisTurn,
        maxApprovalsPerTurn: budget.maxApprovalsPerTurn,
        turnTokensUsed: this.turnTokensUsed,
        turnMeteredTokens: this.turnMeteredTokens,
        llmCalls: this.turnLlmCalls,
      })
      yield this.tagEvent({
        type: 'turn-error',
        error: `Exceeded max approvals per turn (${budget.maxApprovalsPerTurn})`,
        reason: 'max-approvals',
      })
      return
    }

    // Re-enter the SAME agent's query loop, telling it to continue appending
    // parts to the paused message (same `messageId`, parts carried). The
    // resumed loop emits `assistant-message-resumed` instead of `-started`,
    // so the frontend keeps its existing bubble open.
    const agent = config.domainConfig.agents[pending.agentName]
    if (!agent) {
      yield this.tagEvent({
        type: 'turn-error',
        error: `Agent "${pending.agentName}" not found for re-entry`,
        reason: 'internal',
      })
      return
    }

    const pausedMsg = this.state.messages.find(
      (m) => m.id === pending.messageId && m.role === 'assistant'
    ) as AssistantSessionMessage | undefined
    const resumeFrom: AgentQueryResumeHint | undefined = pausedMsg
      ? {
          messageId: pausedMsg.id,
          parts: pausedMsg.parts,
          turnUsage: pausedMsg.metadata?.usage ?? {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
          iterations: pausedMsg.metadata?.iterations ?? [],
        }
      : undefined

    for await (const event of this.runAgentAndUpdateState(agent, config, resumeFrom)) {
      yield event
      if (event.type === 'turn-error') return
      if (event.type === 'assistant-message-finished' && event.usage) {
        this.accumulateUsage(event)
        if (this.turnMeteredTokens >= budget.maxTokensPerTurn) {
          yield this.tokenBudgetExit(budget)
          return
        }
      }
    }

    if (this.state.waitingForApproval) {
      logger.info('Turn paused for approval after resume', { turnId: this.turnId })
      return
    }

    this.sweepRunningToolParts('Turn ended before tool completed')

    yield this.tagEvent({
      type: 'turn-completed',
      route,
      usage: this.snapshotTurnUsage(),
    })
  }

  // ===== HELPERS =====

  /**
   * Open a fresh per-turn abort scope and return the config the turn runs on.
   *
   * The engine mints its own `AbortController` because that is what
   * `interrupt()` drives. It used to write that signal straight over
   * `config.signal`, so a caller that supplied one had it silently discarded —
   * the documented field did nothing, and every caller only worked because it
   * ALSO wired `interrupt()` by hand. `AbortSignal.any` composes the two so
   * either source really stops the turn.
   */
  private startTurnAbort(): AgentEngineConfig {
    this.abortController = new AbortController()
    const callerSignal = this.config.signal
    return {
      ...this.config,
      signal: callerSignal
        ? AbortSignal.any([this.abortController.signal, callerSignal])
        : this.abortController.signal,
    }
  }

  /** Did either abort source fire? Read by `withTurnEnd`'s finally guard. */
  private isTurnAborted(): boolean {
    return this.abortController?.signal.aborted === true || this.config.signal?.aborted === true
  }

  /**
   * Classify a `turn-error` for {@link AgentDomainConfig.onTurnEnd}.
   *
   * Deliberately reads only the event's `reason` discriminator — the `error`
   * string is a human-readable message that changes freely, and matching on it
   * is how "ran out of tokens after twelve good edits" gets mistaken for
   * "threw mid-write".
   */
  private outcomeForTurnError(reason: TurnErrorReason | undefined): TurnOutcome {
    return reason !== undefined && EXHAUSTION_REASONS.has(reason) ? 'exhausted' : 'error'
  }

  private buildTurnBudget(config: AgentEngineConfig): TurnBudget {
    return {
      maxTokensPerTurn: config.maxTokensPerTurn ?? DEFAULT_MAX_TOKENS_PER_TURN,
      maxIterations: config.maxTotalIterations ?? DEFAULT_MAX_TOTAL_ITERATIONS,
      maxApprovalsPerTurn: config.maxApprovalsPerTurn ?? DEFAULT_MAX_APPROVALS_PER_TURN,
    }
  }

  /**
   * The token-budget exit, shared by the three sites that meter turn usage
   * (between agents, after each assistant message, and on the resume path).
   *
   * The log line is the point of the helper: these exits used to emit an event
   * and nothing else, so a turn discarded on a token tally left no trace at all
   * in log search. `reason` is what lets `withTurnEnd` classify this as
   * exhaustion without reading the message text.
   */
  private tokenBudgetExit(budget: TurnBudget): AgentEvent {
    logger.warn('Turn exceeded token budget — closing the turn', {
      turnId: this.turnId,
      sessionId: this.config.sessionId,
      reason: 'token-budget',
      turnTokensUsed: this.turnTokensUsed,
      turnMeteredTokens: this.turnMeteredTokens,
      maxTokensPerTurn: budget.maxTokensPerTurn,
      llmCalls: this.turnLlmCalls,
    })
    return this.tagEvent({
      type: 'turn-error',
      error: `Turn exceeded token budget (${this.turnMeteredTokens}/${budget.maxTokensPerTurn})`,
      reason: 'token-budget',
    })
  }

  private resetTurnUsage(): void {
    this.turnTokensUsed = 0
    this.turnMeteredTokens = 0
    this.turnPromptTokens = 0
    this.turnCompletionTokens = 0
    this.turnLlmCalls = 0
  }

  /**
   * Roll an `assistant-message-finished` event into the turn's usage counters.
   *
   * **The budget meters off `event.iterations`, not `event.usage`** — three
   * reasons, all load-bearing:
   *
   * 1. *Unit.* `event.usage` is the query loop's cumulative roll-up of
   *    `total_tokens`, and `total_tokens` includes prompt tokens while the whole
   *    conversation is re-sent every iteration. Metering it charges the same
   *    prompt once per tool round-trip, so the budget measured iteration count
   *    wearing a token-shaped mask. The per-call records carry the cache fields,
   *    which is what makes "charge only for new input" expressible at all.
   * 2. *Provider.* Whether `prompt_tokens` already contains the cached reads
   *    depends on which provider served the call. `IterationUsage` keeps that;
   *    a roll-up spanning two providers cannot answer it.
   * 3. *Double-charging.* `iterations` is the query loop's `segmentIterations` —
   *    reset across a pause/resume — whereas `usage` is seeded from the paused
   *    message and therefore re-counts the pre-pause calls. It is exactly the
   *    source billing already drains, for exactly this reason.
   *
   * `turnTokensUsed` / `turnPromptTokens` / `turnCompletionTokens` remain the
   * provider-reported grand totals for reporting. Only `turnMeteredTokens`
   * gates the budget.
   */
  private accumulateUsage(event: { usage?: UsageMetrics; iterations?: IterationUsage[] }): void {
    const records = event.iterations
    if (records && records.length > 0) {
      for (const record of records) {
        const norm = normalizeCallUsage(record.usage, record.provider)
        this.turnPromptTokens += norm.promptInput
        this.turnCompletionTokens += norm.completion
        this.turnTokensUsed += record.usage.total_tokens ?? norm.promptInput + norm.completion
        this.turnMeteredTokens += norm.meteredTokens
        this.turnLlmCalls += 1
      }
      return
    }

    // No per-call records: the query loop only builds them for calls reporting
    // a non-zero `total_tokens`, so this is the degenerate case where a provider
    // reported prompt/completion but no total. Meter the roll-up on the
    // documented fallback (`prompt + completion`) — never NaN, and never a
    // silent 0, which would disable the budget outright.
    const usage = event.usage
    if (!usage) return
    this.turnPromptTokens += usage.prompt_tokens ?? 0
    this.turnCompletionTokens += usage.completion_tokens ?? 0
    this.turnTokensUsed +=
      usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)
    this.turnMeteredTokens += meterRollupTokens(usage)
    this.turnLlmCalls += 1
  }

  private snapshotTurnUsage(): TurnUsageSummary {
    return {
      totalTokens: this.turnTokensUsed,
      promptTokens: this.turnPromptTokens,
      completionTokens: this.turnCompletionTokens,
      llmCalls: this.turnLlmCalls,
    }
  }

  private tagEvent<E extends AgentEvent>(event: E): E {
    if (this.turnId) {
      return { ...event, turnId: this.turnId }
    }
    return event
  }

  private async *tagTurnId(gen: AsyncGenerator<AgentEvent>): AsyncGenerator<AgentEvent> {
    for await (const event of gen) {
      yield this.tagEvent(event)
    }
  }

  /**
   * Wrap a turn's event stream so the domain's `onTurnEnd` hook fires exactly
   * once with the resolved outcome, before the terminal event is yielded.
   *
   * Terminal events drive the normal path: `turn-completed` → `'completed'`,
   * and a `turn-error` is classified by its `reason` — a resource cap becomes
   * `'exhausted'`, anything else `'error'` (see {@link outcomeForTurnError}).
   *
   * An abnormal close that yields no terminal event — a client disconnect that
   * cancels this generator, a thrown error — hits the `finally` guard, which
   * reads the abort flag to tell `'aborted'` from `'error'`. Note that an abort
   * the engine is still *draining* does NOT come through here: the route loop
   * breaks and falls through to `turn-completed`. It is specifically the
   * undrained close that lands in the guard.
   *
   * The one exception is an approval pause: it returns without a terminal event
   * but the turn isn't over, so `waitingForApproval` suppresses the guard.
   *
   * A hook failure is logged and swallowed; it must never mask the turn result.
   */
  private async *withTurnEnd(gen: AsyncGenerator<AgentEvent>): AsyncGenerator<AgentEvent> {
    const hook = this.config.domainConfig.onTurnEnd
    if (!hook) {
      yield* gen
      return
    }
    let fired = false
    const fire = async (outcome: TurnOutcome) => {
      if (fired) return
      fired = true
      try {
        await hook(this.getState(), outcome, this.turnId ?? undefined)
      } catch (err) {
        logger.error('onTurnEnd hook failed', {
          turnId: this.turnId,
          outcome,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    try {
      for await (const event of gen) {
        if (event.type === 'turn-completed') await fire('completed')
        else if (event.type === 'turn-error') await fire(this.outcomeForTurnError(event.reason))
        yield event
      }
    } finally {
      // LOAD-BEARING ORDERING: `this.abortController` is still non-null here.
      // `submitMessage` / `resume` / `continueTurn` null it in an OUTER finally,
      // and an outer finally only runs after the delegated generator's own
      // finally has completed — so the flag is still readable at this point.
      // Moving the null-out inward, or hoisting this guard outward, silently
      // turns every disconnect back into `'error'`.
      if (!fired && !this.state.waitingForApproval) {
        await fire(this.isTurnAborted() ? 'aborted' : 'error')
      }
    }
  }

  /**
   * Run a single agent, yield its events, and update this.state with the return value.
   * On resume after an approval pause, the engine passes `resumeFrom` so the
   * agent loop continues appending parts to the existing message instead of
   * minting a new one — see plan §5.6 ("same `messageId` across resume").
   */
  private async *runAgentAndUpdateState(
    agent: AgentDefinition,
    config: AgentEngineConfig,
    resumeFrom?: AgentQueryResumeHint
  ): AsyncGenerator<AgentEvent> {
    const depsTurnId = this.turnId ?? undefined
    const gen = agentQueryLoop(agent, this.state, config, depsTurnId, resumeFrom)

    while (true) {
      const { value, done } = await gen.next()
      if (done) {
        if (value) {
          this.state = value as AgentState
        }
        break
      }
      yield this.tagEvent(value as AgentEvent)
    }
  }

  /**
   * Locate the paused tool_call part by (messageId, partIndex). Returns
   * `null` when the message isn't found or the part isn't a tool_call.
   */
  private findPendingPart(
    messageId: string,
    partIndex: number,
    toolCallId: string
  ): { msgIdx: number; part: ToolCallPart } | null {
    const msgIdx = this.state.messages.findIndex((m) => m.id === messageId)
    if (msgIdx === -1) return null
    const msg = this.state.messages[msgIdx]
    if (!msg || msg.role !== 'assistant') return null
    const part = (msg as AssistantSessionMessage).parts[partIndex]
    if (!part || part.type !== 'tool_call') return null
    if (part.toolCallId !== toolCallId) return null
    return { msgIdx, part }
  }

  /**
   * Flip the persisted approval system message's `approval.status` so refresh
   * shows the same state as the live session. Matched by `toolCallId` — the
   * card lives as a sibling `system` message with `approval.toolCallId` equal
   * to the tool_call part's id.
   */
  private updateApprovalMessageStatus(toolCallId: string, status: 'approved' | 'rejected'): void {
    let dirty = false
    const newMessages = this.state.messages.map((m) => {
      if (m.role !== 'system') return m
      const s = m as SystemSessionMessage
      if (!s.approval || s.approval.toolCallId !== toolCallId) return m
      if (s.approval.status === status) return m
      dirty = true
      return { ...s, approval: { ...s.approval, status } }
    })
    if (dirty) this.state = { ...this.state, messages: newMessages }
  }

  /**
   * Immutably-ish mutate a single part on an assistant message. Replaces
   * the message reference (and its parts array) so React refs / shallow
   * comparisons notice the change.
   */
  private mutatePart(
    messageId: string,
    partIndex: number,
    mutator: (part: ContentPart) => void
  ): void {
    const msgIdx = this.state.messages.findIndex((m) => m.id === messageId)
    if (msgIdx === -1) return
    const oldMsg = this.state.messages[msgIdx] as AssistantSessionMessage
    const newParts = oldMsg.parts.map((p, i) => {
      if (i !== partIndex) return p
      const clone = { ...p }
      mutator(clone)
      return clone
    })
    const newMsg: AssistantSessionMessage = { ...oldMsg, parts: newParts }
    this.state = {
      ...this.state,
      messages: this.state.messages.map((m, i) => (i === msgIdx ? newMsg : m)),
    }
  }

  /**
   * Flip any `running` tool_call parts to `error`. Defensive guard for abnormal
   * exits (abort, connection drop). Per answers §C.2: one place to enforce
   * the invariant.
   */
  private sweepRunningToolParts(reason: string): void {
    let dirty = false
    const newMessages = this.state.messages.map((m) => {
      if (m.role !== 'assistant') return m
      const a = m as AssistantSessionMessage
      let msgDirty = false
      const newParts = a.parts.map((p) => {
        if (p.type === 'tool_call' && p.status === 'running') {
          msgDirty = true
          dirty = true
          return { ...p, status: 'error' as const, error: reason }
        }
        return p
      })
      return msgDirty ? { ...a, parts: newParts } : a
    })
    if (dirty) this.state = { ...this.state, messages: newMessages }
  }
}
