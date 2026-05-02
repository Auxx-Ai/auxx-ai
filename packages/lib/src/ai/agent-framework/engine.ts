// packages/lib/src/ai/agent-framework/engine.ts

import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils/generateId'
import { manageContext } from './context-manager'
import { agentQueryLoop } from './query-loop'
import type {
  AgentDefinition,
  AgentEngineConfig,
  AgentEvent,
  AgentState,
  ResumeOptions,
  Route,
  SessionMessage,
  TurnBudget,
  TurnUsageSummary,
} from './types'
import { buildToolDigest } from './utils'

const logger = createScopedLogger('agent-engine')
const DEFAULT_MAX_TOTAL_ITERATIONS = 50
const DEFAULT_MAX_TOKENS_PER_TURN = 200_000
const DEFAULT_MAX_APPROVALS_PER_TURN = 5

/**
 * AgentEngine — session owner and turn orchestrator.
 *
 * Owns the runtime state for a single session. On each submitMessage:
 * 1. Generates a `turnId` tagged on every event and log line for the turn
 * 2. Applies fresh UI context to domain state
 * 3. Runs the supervisor (if configured) to pick a route, otherwise enters route[0]
 * 4. Executes agents in the chosen route sequentially
 * 5. Enforces a per-turn token budget and iteration cap
 * 6. Yields AgentEvents throughout for real-time streaming
 * 7. Detects HITL (approval-required) and pauses
 */
export class AgentEngine {
  private config: AgentEngineConfig
  private state: AgentState
  private abortController: AbortController | null = null
  private turnId: string | null = null
  private turnTokensUsed = 0
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
    context?: Record<string, unknown>
  ): AsyncGenerator<AgentEvent> {
    this.turnId = generateId('turn')
    this.resetTurnUsage()

    // Refresh domain state with latest UI context
    if (context && this.config.domainConfig.applyContext) {
      this.state = {
        ...this.state,
        domainState: this.config.domainConfig.applyContext(this.state.domainState, context),
      }
    }

    const userMsg: SessionMessage = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    }
    // A fresh user message means the user is abandoning whatever was paused.
    // Drop pendingToolCall (and its assistantMessage) — that branch never
    // landed in state.messages, so there's nothing else to clean up.
    this.state = {
      ...this.state,
      messages: [...this.state.messages, userMsg],
      waitingForApproval: false,
      pendingToolCall: undefined,
      approvalsThisTurn: 0,
      turnSnapshots: { records: {}, threads: {}, tasks: {} },
      capturedActions: [],
    }

    logger.info('Turn submitted', {
      turnId: this.turnId,
      sessionId: this.config.sessionId,
      messageLength: userMessage.length,
      totalMessages: this.state.messages.length,
    })

    this.abortController = new AbortController()
    const configWithAbort: AgentEngineConfig = {
      ...this.config,
      signal: this.abortController.signal,
    }

    try {
      yield* this.tagTurnId(this.runPipeline(configWithAbort))
    } finally {
      this.abortController = null
    }
  }

  /**
   * Resume a paused session after the user approves or rejects a tool call.
   *
   * On **approve**: executes the stored `pendingToolCall` directly (no LLM re-call),
   * appends the real tool result to state.messages, then re-enters the same agent's
   * query loop so it can decide whether to request more approvals or wrap up
   * with a final reply.
   *
   * On **reject**: appends `{ rejected: true, reason }` as the tool result and
   * re-enters the same agent's loop so it can respond to the rejection.
   */
  async *resume(opts: ResumeOptions): AsyncGenerator<AgentEvent> {
    if (opts.resumeState) {
      this.state = opts.resumeState
    }

    // Keep the prior turnId if the paused state has one on it; otherwise mint one
    // so resume events are still tied together. In practice we just mint a fresh
    // turnId for each resume — the SSE stream opens a new turn section anyway.
    this.turnId = generateId('turn')
    this.resetTurnUsage()

    // Refresh domain state with latest UI context
    if (opts.context && this.config.domainConfig.applyContext) {
      this.state = {
        ...this.state,
        domainState: this.config.domainConfig.applyContext(this.state.domainState, opts.context),
      }
    }

    const pending = this.state.pendingToolCall
    if (!pending) {
      yield this.tagEvent({ type: 'turn-error', error: 'No pending tool call to resume' })
      return
    }

    const route = this.state.currentRoute ?? 'default'

    this.abortController = new AbortController()
    const configWithAbort: AgentEngineConfig = {
      ...this.config,
      signal: this.abortController.signal,
    }

    try {
      yield* this.tagTurnId(this.runResume(opts, route, configWithAbort))
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

    // Context management — compress if over budget
    this.state = {
      ...this.state,
      messages: await manageContext(this.state.messages, config),
    }

    logger.debug('Context managed', {
      turnId: this.turnId,
      messageCount: this.state.messages.length,
    })

    // Route selection: supervisor (if configured) picks a route; otherwise use route[0]
    let route: Route | undefined
    if (domainConfig.supervisorAgent) {
      const supervisor = domainConfig.agents[domainConfig.supervisorAgent]
      if (!supervisor) {
        yield this.tagEvent({
          type: 'turn-error',
          error: `Supervisor agent "${domainConfig.supervisorAgent}" not found`,
        })
        return
      }
      yield* this.runAgentAndUpdateState(supervisor, config)
      if (config.signal?.aborted) return
      const routeName = this.state.currentRoute
      logger.info('Route selected', { turnId: this.turnId, route: routeName })
      route = domainConfig.routes.find((r) => r.name === routeName) ?? domainConfig.routes[0]
    } else {
      // Solo-agent domain: no classification needed
      route = domainConfig.routes[0]
      this.state = { ...this.state, currentRoute: route?.name }
    }

    if (!route) {
      yield this.tagEvent({
        type: 'turn-error',
        error: `No routes configured in domain "${domainConfig.type}"`,
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
        yield this.tagEvent({ type: 'turn-error', error: 'Max total iterations exceeded' })
        return
      }
      if (this.turnTokensUsed >= budget.maxTokensPerTurn) {
        yield this.tagEvent({
          type: 'turn-error',
          error: `Turn exceeded token budget (${this.turnTokensUsed}/${budget.maxTokensPerTurn})`,
        })
        return
      }

      if (agentName === config.domainConfig.supervisorAgent) continue

      const agent = config.domainConfig.agents[agentName]
      if (!agent) {
        yield this.tagEvent({
          type: 'turn-error',
          error: `Agent "${agentName}" not found in domain config`,
        })
        return
      }

      let iterCount = 0
      for await (const event of this.runAgentAndUpdateState(agent, config)) {
        yield event
        if (event.type === 'turn-error') return
        if (event.type === 'llm-complete') {
          iterCount++
          this.accumulateUsage(event.usage)
          if (this.turnTokensUsed >= budget.maxTokensPerTurn) {
            yield this.tagEvent({
              type: 'turn-error',
              error: `Turn exceeded token budget (${this.turnTokensUsed}/${budget.maxTokensPerTurn})`,
            })
            return
          }
        }
      }
      totalIterations += iterCount

      if (this.state.waitingForApproval) {
        logger.info('Turn paused for approval', { turnId: this.turnId })
        return
      }
    }

    const legacyMessage = this.emitFinalMessageFromState()
    if (legacyMessage) yield legacyMessage
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

    // Apply the tool result (approve → execute tool; reject → synthetic rejection)
    if (opts.action === 'reject') {
      yield this.tagEvent({
        type: 'tool-rejected',
        agent: pending.agentName,
        tool: pending.toolName,
        toolCallId: pending.toolCallId,
      })
      yield this.tagEvent({
        type: 'tool-status-changed',
        agent: pending.agentName,
        tool: pending.toolName,
        toolCallId: pending.toolCallId,
        status: 'rejected',
      })
      const rejectionResult = { rejected: true, reason: 'User declined the action' }
      this.state = {
        ...this.state,
        waitingForApproval: false,
        pendingToolCall: undefined,
        messages: [
          ...this.state.messages,
          pending.assistantMessage,
          {
            role: 'tool' as const,
            content: JSON.stringify(rejectionResult),
            toolCallId: pending.toolCallId,
            timestamp: Date.now(),
            metadata: { agent: pending.agentName, rejected: true },
            toolStatus: 'rejected' as const,
          },
        ],
      }
    } else {
      // Approve: execute the pending tool
      const agent = config.domainConfig.agents[pending.agentName]
      const tool = agent?.tools.find((t) => t.name === pending.toolName)
      if (!tool) {
        yield this.tagEvent({
          type: 'turn-error',
          error: `Tool "${pending.toolName}" not found on agent "${pending.agentName}"`,
        })
        return
      }

      // Validate input amendment against the tool's schema (when defined).
      // Rejection here surfaces as a turn-error so the frontend can show a clear
      // message rather than silently sending malformed data through to execute.
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
          })
          return
        }
      }

      let finalArgs = opts.inputAmendment
        ? { ...pending.args, ...opts.inputAmendment }
        : pending.args
      const ctx = {
        db: config.db,
        organizationId: config.organizationId,
        userId: config.userId,
        sessionId: config.sessionId,
        signal: config.signal,
        turnId: this.turnId ?? undefined,
        traceId: this.turnId ?? undefined,
      }

      // Re-run input validation on the merged args. The pre-pause validator
      // (in query-loop) already saw `pending.args`; an inputAmendment may have
      // mutated fields it cared about, so we revalidate here. A failure at
      // this point is surfaced as a tool error — the user already approved,
      // so we cannot pause again; the LLM gets the error and retries.
      if (tool.validateInputs) {
        const v = await tool.validateInputs(finalArgs, ctx)
        if (!v.ok) {
          logger.info('Approved tool validateInputs failed', {
            turnId: this.turnId,
            tool: pending.toolName,
            error: v.error,
          })
          yield this.tagEvent({
            type: 'tool-error',
            agent: pending.agentName,
            tool: pending.toolName,
            toolCallId: pending.toolCallId,
            error: v.error,
          })
          yield this.tagEvent({
            type: 'tool-status-changed',
            agent: pending.agentName,
            tool: pending.toolName,
            toolCallId: pending.toolCallId,
            status: 'error',
          })
          this.state = {
            ...this.state,
            waitingForApproval: false,
            pendingToolCall: undefined,
            messages: [
              ...this.state.messages,
              pending.assistantMessage,
              {
                role: 'tool' as const,
                content: JSON.stringify({ error: v.error, output: null }),
                toolCallId: pending.toolCallId,
                timestamp: Date.now(),
                metadata: { agent: pending.agentName, validationError: true },
                toolStatus: 'error' as const,
                ...(opts.inputAmendment ? { inputAmendment: opts.inputAmendment } : {}),
              },
            ],
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

      yield this.tagEvent({
        type: 'tool-started',
        agent: pending.agentName,
        tool: pending.toolName,
        toolCallId: pending.toolCallId,
        args: finalArgs,
      })

      // Notify the frontend that the approval card should switch from
      // 'awaiting-approval' to 'executing' so the UI can morph in place.
      yield this.tagEvent({
        type: 'tool-status-changed',
        agent: pending.agentName,
        tool: pending.toolName,
        toolCallId: pending.toolCallId,
        status: 'executing',
      })

      try {
        const result = await tool.execute(finalArgs, ctx)
        const digest = result.success ? buildToolDigest(tool, result.output, logger) : undefined
        yield this.tagEvent({
          type: 'tool-completed',
          agent: pending.agentName,
          tool: pending.toolName,
          toolCallId: pending.toolCallId,
          result,
          digest,
        })
        yield this.tagEvent({
          type: 'tool-status-changed',
          agent: pending.agentName,
          tool: pending.toolName,
          toolCallId: pending.toolCallId,
          status: result.success ? 'completed' : 'error',
          digest,
        })
        const toolResultContent = JSON.stringify(
          result.success
            ? result.output
            : { error: result.error ?? 'Unknown error', output: result.output }
        )
        // Give the domain a chance to mine the post-approval result for snapshots.
        let postHookState = this.state
        if (result.success && config.domainConfig.onToolResult) {
          postHookState = config.domainConfig.onToolResult(pending.toolName, result, this.state)
        }
        this.state = {
          ...postHookState,
          waitingForApproval: false,
          pendingToolCall: undefined,
          approvalsThisTurn: (this.state.approvalsThisTurn ?? 0) + 1,
          messages: [
            ...postHookState.messages,
            pending.assistantMessage,
            {
              role: 'tool' as const,
              content: toolResultContent,
              toolCallId: pending.toolCallId,
              timestamp: Date.now(),
              metadata: { agent: pending.agentName, approved: true },
              toolStatus: (result.success ? 'completed' : 'error') as 'completed' | 'error',
              ...(digest !== undefined ? { digest } : {}),
              ...(opts.inputAmendment ? { inputAmendment: opts.inputAmendment } : {}),
            },
          ],
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error('Approved tool execution failed', {
          turnId: this.turnId,
          tool: pending.toolName,
          error: errorMessage,
        })
        yield this.tagEvent({
          type: 'tool-error',
          agent: pending.agentName,
          tool: pending.toolName,
          toolCallId: pending.toolCallId,
          error: errorMessage,
        })
        yield this.tagEvent({
          type: 'tool-status-changed',
          agent: pending.agentName,
          tool: pending.toolName,
          toolCallId: pending.toolCallId,
          status: 'error',
        })
        this.state = {
          ...this.state,
          waitingForApproval: false,
          pendingToolCall: undefined,
          messages: [
            ...this.state.messages,
            pending.assistantMessage,
            {
              role: 'tool' as const,
              content: JSON.stringify({ error: errorMessage, output: null }),
              toolCallId: pending.toolCallId,
              timestamp: Date.now(),
              metadata: { agent: pending.agentName, failed: true },
              toolStatus: 'error' as const,
              ...(opts.inputAmendment ? { inputAmendment: opts.inputAmendment } : {}),
            },
          ],
        }
      }
    }

    // Enforce max-approvals cap before looping back into the same agent
    if ((this.state.approvalsThisTurn ?? 0) > budget.maxApprovalsPerTurn) {
      yield this.tagEvent({
        type: 'turn-error',
        error: `Exceeded max approvals per turn (${budget.maxApprovalsPerTurn})`,
      })
      return
    }

    // Re-enter the SAME agent's query loop so it can request more approvals or
    // wrap up with a final reply.
    const agent = config.domainConfig.agents[pending.agentName]
    if (!agent) {
      yield this.tagEvent({
        type: 'turn-error',
        error: `Agent "${pending.agentName}" not found for re-entry`,
      })
      return
    }

    for await (const event of this.runAgentAndUpdateState(agent, config)) {
      yield event
      if (event.type === 'turn-error') return
      if (event.type === 'llm-complete') {
        this.accumulateUsage(event.usage)
        if (this.turnTokensUsed >= budget.maxTokensPerTurn) {
          yield this.tagEvent({
            type: 'turn-error',
            error: `Turn exceeded token budget (${this.turnTokensUsed}/${budget.maxTokensPerTurn})`,
          })
          return
        }
      }
    }

    if (this.state.waitingForApproval) {
      logger.info('Turn paused for approval after resume', { turnId: this.turnId })
      return
    }

    const legacyMessage = this.emitFinalMessageFromState()
    if (legacyMessage) yield legacyMessage
    yield this.tagEvent({
      type: 'turn-completed',
      route,
      usage: this.snapshotTurnUsage(),
    })
  }

  // ===== HELPERS =====

  private buildTurnBudget(config: AgentEngineConfig): TurnBudget {
    return {
      maxTokensPerTurn: config.maxTokensPerTurn ?? DEFAULT_MAX_TOKENS_PER_TURN,
      maxIterations: config.maxTotalIterations ?? DEFAULT_MAX_TOTAL_ITERATIONS,
      maxApprovalsPerTurn: config.maxApprovalsPerTurn ?? DEFAULT_MAX_APPROVALS_PER_TURN,
    }
  }

  private resetTurnUsage(): void {
    this.turnTokensUsed = 0
    this.turnPromptTokens = 0
    this.turnCompletionTokens = 0
    this.turnLlmCalls = 0
  }

  private accumulateUsage(usage: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }): void {
    this.turnPromptTokens += usage.prompt_tokens ?? 0
    this.turnCompletionTokens += usage.completion_tokens ?? 0
    this.turnTokensUsed +=
      usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)
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
   * Emit the legacy `message` event for consumers that listen on it. Returns null
   * if the final message was already delivered via `final-message` (the
   * implicit-termination path in the query loop) so we don't double-fire.
   */
  private emitFinalMessageFromState(): AgentEvent | null {
    const lastMessage = this.state.messages[this.state.messages.length - 1]
    if (!lastMessage || lastMessage.role !== 'assistant' || !lastMessage.content) return null
    if ((lastMessage.metadata as Record<string, unknown> | undefined)?.final === true) return null
    return this.tagEvent({ type: 'message', role: 'assistant', content: lastMessage.content })
  }

  /**
   * Run a single agent, yield its events, and update this.state with the return value.
   * Uses manual iteration to capture the generator's return value (AgentState).
   */
  private async *runAgentAndUpdateState(
    agent: AgentDefinition,
    config: AgentEngineConfig
  ): AsyncGenerator<AgentEvent> {
    const depsTurnId = this.turnId ?? undefined
    const gen = agentQueryLoop(agent, this.state, config, depsTurnId)

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
}
