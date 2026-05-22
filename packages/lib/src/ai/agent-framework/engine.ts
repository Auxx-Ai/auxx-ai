// packages/lib/src/ai/agent-framework/engine.ts

import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils/generateId'
import { manageContext } from './context-manager'
import { type AgentQueryResumeHint, agentQueryLoop } from './query-loop'
import {
  type AgentDefinition,
  type AgentEngineConfig,
  type AgentEvent,
  type AgentState,
  type AssistantSessionMessage,
  type ContentPart,
  createEmptyTurnSnapshots,
  type ResumeOptions,
  type Route,
  type SessionMessage,
  type SystemSessionMessage,
  type ToolCallPart,
  type TurnBudget,
  type TurnUsageSummary,
} from './types'
import { buildToolDigest, executeToolWithProgress } from './utils'

const logger = createScopedLogger('agent-engine')
const DEFAULT_MAX_TOTAL_ITERATIONS = 50
const DEFAULT_MAX_TOKENS_PER_TURN = 200_000
const DEFAULT_MAX_APPROVALS_PER_TURN = 5

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
    }

    logger.info('Turn submitted', {
      turnId: this.turnId,
      sessionId: this.config.sessionId,
      messageLength: userMessage.length,
      totalMessages: this.state.messages.length,
      contextKeys: context ? Object.keys(context) : [],
      contextSummary: this.config.domainConfig.summarizeContext?.(context),
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

      for await (const event of this.runAgentAndUpdateState(agent, config)) {
        yield event
        if (event.type === 'turn-error') return
        // Roll up usage from each assistant message finish for budget enforcement.
        if (event.type === 'assistant-message-finished' && event.usage) {
          totalIterations++
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
        yield this.tagEvent({
          type: 'turn-error',
          error: `Tool "${pending.toolName}" not found on agent "${pending.agentName}"`,
        })
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
        workflow: config.workflow,
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

    // Enforce max-approvals cap.
    if ((this.state.approvalsThisTurn ?? 0) > budget.maxApprovalsPerTurn) {
      yield this.tagEvent({
        type: 'turn-error',
        error: `Exceeded max approvals per turn (${budget.maxApprovalsPerTurn})`,
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

    this.sweepRunningToolParts('Turn ended before tool completed')

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
