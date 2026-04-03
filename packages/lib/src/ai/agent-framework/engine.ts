// packages/lib/src/ai/agent-framework/engine.ts

import { createScopedLogger } from '@auxx/logger'
import { manageContext } from './context-manager'
import { agentQueryLoop } from './query-loop'
import type {
  AgentDefinition,
  AgentEngineConfig,
  AgentEvent,
  AgentState,
  Route,
  SessionMessage,
} from './types'

const logger = createScopedLogger('agent-engine')
const DEFAULT_MAX_TOTAL_ITERATIONS = 50

/**
 * AgentEngine — session owner and pipeline orchestrator.
 *
 * Owns the runtime state for a single session. On each submitMessage:
 * 1. Appends user message to state
 * 2. Runs the supervisor agent to classify intent → pick route
 * 3. Executes agents in the chosen route sequentially
 * 4. Yields AgentEvents throughout for real-time streaming
 * 5. Detects HITL (approval-required) and pauses
 */
export class AgentEngine {
  private config: AgentEngineConfig
  private state: AgentState
  private abortController: AbortController | null = null

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
   * Submit a user message and run the pipeline.
   * Yields AgentEvents for every phase of execution.
   */
  async *submitMessage(userMessage: string): AsyncGenerator<AgentEvent> {
    const userMsg: SessionMessage = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    }
    this.state = {
      ...this.state,
      messages: [...this.state.messages, userMsg],
      waitingForApproval: false,
    }

    logger.info('Submitting message', {
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
      yield* this.runPipeline(configWithAbort)
    } finally {
      this.abortController = null
    }
  }

  /**
   * Resume a paused session (e.g. after user approves an action).
   */
  async *resume(approvalMessage?: string, resumeState?: AgentState): AsyncGenerator<AgentEvent> {
    if (resumeState) {
      this.state = resumeState
    }

    if (approvalMessage) {
      const approvalMsg: SessionMessage = {
        role: 'user',
        content: approvalMessage,
        timestamp: Date.now(),
        metadata: { type: 'approval' },
      }
      this.state = {
        ...this.state,
        messages: [...this.state.messages, approvalMsg],
        waitingForApproval: false,
      }
    }

    this.abortController = new AbortController()
    const configWithAbort: AgentEngineConfig = {
      ...this.config,
      signal: this.abortController.signal,
    }

    try {
      yield* this.runPipeline(configWithAbort)
    } finally {
      this.abortController = null
    }
  }

  /** Abort the current pipeline execution. */
  interrupt(): void {
    this.abortController?.abort()
  }

  // ===== PIPELINE =====

  private async *runPipeline(config: AgentEngineConfig): AsyncGenerator<AgentEvent> {
    const { domainConfig } = config

    // Context management — compress if over budget
    this.state = {
      ...this.state,
      messages: await manageContext(this.state.messages, config),
    }

    logger.debug('Context managed', {
      messageCount: this.state.messages.length,
    })

    // Run supervisor to classify intent and pick route
    const supervisor = domainConfig.agents[domainConfig.supervisorAgent]
    if (!supervisor) {
      yield {
        type: 'pipeline-error',
        error: `Supervisor agent "${domainConfig.supervisorAgent}" not found`,
      }
      return
    }

    yield* this.runAgentAndUpdateState(supervisor, config)

    // Check for errors or abort
    if (config.signal?.aborted) return

    // Resolve route from supervisor's classification
    const routeName = this.state.currentRoute
    logger.info('Route selected', { route: routeName })
    const route = domainConfig.routes.find((r) => r.name === routeName) ?? domainConfig.routes[0]

    if (!route) {
      yield {
        type: 'pipeline-error',
        error: `No routes configured in domain "${domainConfig.type}"`,
      }
      return
    }

    yield* this.executeRoute(route, config)
  }

  private async *executeRoute(route: Route, config: AgentEngineConfig): AsyncGenerator<AgentEvent> {
    yield { type: 'pipeline-started', route: route.name, agents: route.agents }
    logger.info('Pipeline started', { route: route.name, agents: route.agents })

    let totalIterations = 0
    const maxTotal = config.maxTotalIterations ?? DEFAULT_MAX_TOTAL_ITERATIONS

    for (const agentName of route.agents) {
      if (config.signal?.aborted) break
      if (totalIterations >= maxTotal) {
        yield { type: 'pipeline-error', error: 'Max total iterations exceeded' }
        break
      }

      // Skip the supervisor — it already ran
      if (agentName === config.domainConfig.supervisorAgent) continue

      const agent = config.domainConfig.agents[agentName]
      if (!agent) {
        yield {
          type: 'pipeline-error',
          error: `Agent "${agentName}" not found in domain config`,
        }
        break
      }

      let iterCount = 0
      for await (const event of this.runAgentAndUpdateState(agent, config)) {
        yield event
        if (event.type === 'pipeline-error') return
        iterCount++
      }
      totalIterations += iterCount

      // If waiting for approval, pause the pipeline
      if (this.state.waitingForApproval) {
        logger.info('Pipeline paused for approval')
        break
      }
    }

    if (!this.state.waitingForApproval) {
      // Extract final assistant message
      const lastMessage = this.state.messages[this.state.messages.length - 1]
      if (lastMessage?.role === 'assistant' && lastMessage.content) {
        yield { type: 'message', role: 'assistant', content: lastMessage.content }
      }

      yield { type: 'pipeline-completed', route: route.name }
      logger.info('Pipeline completed', { route: route.name, totalIterations })
    }
  }

  /**
   * Run a single agent, yield its events, and update this.state with the return value.
   * Uses manual iteration to capture the generator's return value (AgentState).
   */
  private async *runAgentAndUpdateState(
    agent: AgentDefinition,
    config: AgentEngineConfig
  ): AsyncGenerator<AgentEvent> {
    const gen = agentQueryLoop(agent, this.state, config)

    while (true) {
      const { value, done } = await gen.next()
      if (done) {
        // When done=true, value is the returned AgentState
        if (value) {
          this.state = value as AgentState
        }
        break
      }
      yield value as AgentEvent
    }
  }
}
