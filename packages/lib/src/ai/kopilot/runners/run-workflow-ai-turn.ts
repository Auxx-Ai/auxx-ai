// packages/lib/src/ai/kopilot/runners/run-workflow-ai-turn.ts

import { database } from '@auxx/database'
import type { ContextManager } from '../../agent-framework/context/context-manager'
import { AgentEngine } from '../../agent-framework/engine'
import { createCallModel } from '../../agent-framework/llm-adapter'
import type { WorkflowToolContext } from '../../agent-framework/tool-context'
import type {
  AgentDefinition,
  AgentDomainConfig,
  AgentEvent,
  AgentToolDefinition,
  SessionMessage,
  UserSessionMessage,
} from '../../agent-framework/types'
import type { Message, UsageMetrics } from '../../clients/base/types'

/**
 * Inputs for {@link runWorkflowAiTurn}.
 *
 * A synchronous sibling of the chat-surface agent runner. The workflow AI node
 * pre-builds its messages + tools and hands them off here — no kopilot persona,
 * no system-prompt assembly. Events are pushed through the supplied `onEvent`
 * callback so the workflow engine can surface tool calls in its run log.
 */
export interface RunWorkflowAiTurnArgs {
  /** Organization owning the workflow run. */
  organizationId: string
  /** Acting user (or system user) the LLM call is billed to. */
  userId: string
  /** Workflow run id — surfaces as `sessionId` for the LLM adapter. */
  sessionId: string
  /** Filtered agent-framework tools available to the loop. */
  tools: AgentToolDefinition[]
  /** Provider + model the AI node resolved before calling. */
  model: { provider: string; model: string }
  /** Pre-built prompt messages, already interpolated. */
  messages: Message[]
  /** Workflow handle threaded into every tool's `ctx`. */
  workflow: WorkflowToolContext
  /**
   * The run's live `ExecutionContextManager` (conforms to `ContextManager`),
   * threaded onto every tool's `ctx.context` so the shared context tools
   * (`assign_variable`, etc.) read/write the workflow's variables directly
   * instead of an ephemeral kopilot store. See plans/chat/v9 phase-2b.
   */
  context: ContextManager
  /** Optional model parameters (temperature, max_tokens, …). */
  parameters?: Record<string, unknown>
  /** Cap on tool-loop iterations. Defaults to 10. */
  maxIterations?: number
  /** Optional abort signal. */
  signal?: AbortSignal
  /**
   * Callback invoked for every agent event yielded by the engine. The workflow
   * AI processor adapts these into run-log lines.
   */
  onEvent?: (event: AgentEvent) => void
}

/** Summary of a single tool invocation surfaced from the loop. */
export interface ToolCallSummary {
  toolCallId: string
  name: string
  args: Record<string, unknown>
  success: boolean
  output?: unknown
  error?: string
}

/** Return value from {@link runWorkflowAiTurn}. */
export interface RunWorkflowAiTurnResult {
  finalAssistantMessage: string
  toolCalls: ToolCallSummary[]
  usage?: UsageMetrics
}

/**
 * Run one synchronous agent-framework turn for the workflow AI node.
 *
 * Builds a minimal one-agent domain config that re-uses the caller's
 * pre-built messages verbatim — no kopilot persona, no per-page registry
 * lookups. Pumps engine events through `onEvent` and returns the final
 * assistant text + tool-call summaries when the loop terminates.
 */
export async function runWorkflowAiTurn(
  args: RunWorkflowAiTurnArgs
): Promise<RunWorkflowAiTurnResult> {
  const {
    organizationId,
    userId,
    sessionId,
    tools,
    model,
    messages,
    workflow,
    context,
    parameters,
    maxIterations = 10,
    signal,
    onEvent,
  } = args

  const domain = buildWorkflowAiDomainConfig({
    tools,
    messages,
    defaultProvider: model.provider,
    defaultModel: model.model,
    parameters,
    maxIterations,
  })

  const callModel = createCallModel({
    organizationId,
    userId,
    source: 'workflow_ai_node',
    sourceId: sessionId,
  })

  const engine = new AgentEngine({
    organizationId,
    userId,
    sessionId,
    db: database,
    domainConfig: domain,
    callModel,
    signal,
    workflow,
    // The live ECM becomes ctx.context — workflow tools read/write the run's
    // variables directly (chat v9 phase-2b), not an ephemeral kopilot store.
    context,
    // AI nodes don't pause for approval today — Q-1.
    approvalMode: 'auto',
  })

  const toolCalls: ToolCallSummary[] = []
  let finalAssistantMessage = ''
  let usage: UsageMetrics | undefined

  // The engine expects at least one user message in state — `submitMessage`
  // synthesizes one. We pass an empty string because `messages` already
  // contains the full prompt; the agent's `buildMessages` returns those
  // verbatim, ignoring the session's user-message tail.
  const stream = engine.submitMessage('')

  for await (const event of stream) {
    onEvent?.(event)

    if (event.type === 'tool-call-started') {
      toolCalls.push({
        toolCallId: event.toolCallId,
        name: event.name,
        args: event.args,
        success: false,
      })
    } else if (event.type === 'tool-call-completed') {
      const existing = toolCalls.find((t) => t.toolCallId === event.toolCallId)
      if (existing) {
        existing.success = true
        existing.output = event.output
      }
    } else if (event.type === 'tool-call-failed') {
      const existing = toolCalls.find((t) => t.toolCallId === event.toolCallId)
      if (existing) {
        existing.success = false
        existing.error = event.error
      }
    } else if (event.type === 'assistant-message-finished') {
      finalAssistantMessage = joinTextParts(event.parts)
      usage = event.usage
    }
  }

  return { finalAssistantMessage, toolCalls, usage }
}

/**
 * Build a minimal one-agent domain config that returns the workflow's
 * pre-built messages directly. Skips the kopilot persona / catalog work —
 * the AI node owns its own prompt template.
 */
function buildWorkflowAiDomainConfig(opts: {
  tools: AgentToolDefinition[]
  messages: Message[]
  defaultProvider: string
  defaultModel: string
  parameters?: Record<string, unknown>
  maxIterations: number
}): AgentDomainConfig {
  const { tools, messages, defaultProvider, defaultModel, parameters, maxIterations } = opts

  const agent: AgentDefinition = {
    name: 'workflow-ai-node',
    tools,
    maxIterations,
    parameters: parameters as AgentDefinition['parameters'],
    buildMessages: () => messages,
    processResult: async (_content, _toolCalls, state) => state,
  }

  return {
    type: 'kopilot',
    defaultModel,
    defaultProvider,
    agents: { 'workflow-ai-node': agent },
    routes: [{ name: 'default', agents: ['workflow-ai-node'] }],
    createInitialState: () => ({}),
  }
}

/** Concatenate every `text` part of an assistant message into a single string. */
function joinTextParts(parts: ReadonlyArray<{ type: string; text?: string }>): string {
  return parts
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
}

// Re-export so callers don't need to reach into agent-framework directly.
export type { AgentEvent, SessionMessage, UserSessionMessage }
