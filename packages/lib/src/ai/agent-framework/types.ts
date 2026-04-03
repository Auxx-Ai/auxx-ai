// packages/lib/src/ai/agent-framework/types.ts

import type { Message, ModelParameters, Tool, ToolCall, UsageMetrics } from '../clients/base/types'

// ===== SESSION & MESSAGE TYPES =====

/** Persisted message in an agent session */
export interface SessionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Tool call ID for tool-result messages */
  toolCallId?: string
  /** Tool calls the assistant wants to make */
  toolCalls?: ToolCall[]
  /** Timestamp when this message was added */
  timestamp: number
  /** Parent message ID for conversation tree branching (null = root) */
  parentId?: string | null
  /** Optional metadata (e.g. which agent produced this) */
  metadata?: Record<string, unknown>
}

/** Discriminated session type — each domain registers its own */
export type AgentSessionType = 'kopilot' | 'builder'

// ===== LLM CALL TYPES =====

/** Parameters passed to the LLM adapter */
export interface LLMCallParams {
  model: string
  provider: string
  messages: Message[]
  tools?: Tool[]
  parameters?: ModelParameters
  /** Structured output JSON schema (for planner, supervisor, etc.) */
  responseFormat?: { type: 'json_schema'; jsonSchema: Record<string, unknown> }
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/** Events yielded by the LLM adapter during streaming */
export type LLMStreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; toolCall: ToolCall }
  | { type: 'usage'; usage: UsageMetrics }
  | { type: 'done'; content: string; toolCalls: ToolCall[]; usage: UsageMetrics }

// ===== TOOL TYPES =====

/** A tool available to an agent, built from node processors or custom definitions */
export interface AgentToolDefinition {
  /** Unique tool name (e.g. 'find_threads', 'draft_reply') */
  name: string
  /** Human-readable description for the LLM */
  description: string
  /** JSON Schema for the tool's parameters */
  parameters: Record<string, unknown>
  /** Execute the tool and return a result string */
  execute: (args: Record<string, unknown>, deps: AgentDeps) => Promise<AgentToolResult>
  /** Whether this tool requires human approval before execution */
  requiresApproval?: boolean
}

/** Result from executing a tool */
export interface AgentToolResult {
  success: boolean
  output: unknown
  error?: string
  /** Structured UI blocks to render in the frontend */
  blocks?: AgentBlock[]
}

/** A rich UI block returned by tools for frontend rendering */
export interface AgentBlock {
  type: string
  data: Record<string, unknown>
}

// ===== AGENT STATE =====

/** Stored tool call awaiting human approval — executed directly on resume */
export interface PendingToolCall {
  toolCallId: string
  toolName: string
  agentName: string
  args: Record<string, unknown>
}

/** Runtime state passed through the agent pipeline */
export interface AgentState<TDomainState = Record<string, unknown>> {
  /** Full conversation history */
  messages: SessionMessage[]
  /** Domain-specific state (e.g. plan, search results, page context) */
  domainState: TDomainState
  /** The current route chosen by the supervisor */
  currentRoute?: string
  /** Whether the pipeline is waiting for human input */
  waitingForApproval?: boolean
  /** Tool call awaiting approval — executed directly on resume without re-running pipeline */
  pendingToolCall?: PendingToolCall
}

/** Options passed to engine.resume() for approval actions */
export interface ResumeOptions {
  /** Whether the user approved or rejected the pending tool call */
  action: 'approve' | 'reject'
  /** Optional overrides merged into the tool args (e.g. { saveAsDraft: true }) */
  inputAmendment?: Record<string, unknown>
  /** Optional state to restore before resuming (e.g. after reconnect) */
  resumeState?: AgentState
  /** Fresh UI context to apply before execution */
  context?: Record<string, unknown>
}

// ===== AGENT DEFINITION =====

/** Defines a single agent in the pipeline (supervisor, planner, executor, responder) */
export interface AgentDefinition<TDomainState = Record<string, unknown>> {
  /** Unique agent name */
  name: string
  /** Build the message array for the LLM call */
  buildMessages: (
    state: AgentState<TDomainState>,
    deps: AgentDeps
  ) => Message[] | Promise<Message[]>
  /** Tools available to this agent (empty = one-shot, no tool loop) */
  tools: AgentToolDefinition[]
  /** Process the LLM response and update domain state */
  processResult: (
    content: string,
    toolCalls: ToolCall[],
    state: AgentState<TDomainState>,
    deps: AgentDeps
  ) => Promise<AgentState<TDomainState>>
  /** Model override for this specific agent */
  model?: string
  /** Provider override for this specific agent */
  provider?: string
  /** Model parameters override */
  parameters?: ModelParameters
  /** Max tool-use iterations before forcing a stop (default: 10) */
  maxIterations?: number
  /** Structured output format (for supervisor, planner) */
  responseFormat?: LLMCallParams['responseFormat']
}

// ===== ROUTING =====

/** A route defines a sequence of agents to execute */
export interface Route {
  /** Route name (e.g. 'simple', 'multi-step', 'conversational') */
  name: string
  /** Ordered list of agent names to execute in this route */
  agents: string[]
  /** Whether this route should run in a background worker */
  background?: boolean
}

// ===== DOMAIN CONFIG =====

/** Domain-specific configuration — each consumer (Kopilot, Builder) provides one */
export interface AgentDomainConfig<TDomainState = Record<string, unknown>> {
  /** Domain identifier (matches AgentSessionType) */
  type: AgentSessionType
  /** All agents registered in this domain */
  agents: Record<string, AgentDefinition<TDomainState>>
  /** All routes available in this domain */
  routes: Route[]
  /** The supervisor agent name (classifies intent → picks route) */
  supervisorAgent: string
  /** Create initial domain state for a new session */
  createInitialState: (context: Record<string, unknown>) => TDomainState
  /** Merge fresh UI context into domain state before each pipeline run */
  applyContext?: (state: TDomainState, context: Record<string, unknown>) => TDomainState
  /** Default model for agents that don't override */
  defaultModel: string
  /** Default provider for agents that don't override */
  defaultProvider: string
}

// ===== ENGINE CONFIG =====

/** Configuration for the AgentEngine instance */
export interface AgentEngineConfig {
  /** Organization context */
  organizationId: string
  /** User context */
  userId: string
  /** Session ID (for persistence) */
  sessionId: string
  /** The domain config to use */
  domainConfig: AgentDomainConfig
  /** LLM call function (injected, wraps LLMOrchestrator) */
  callModel: (params: LLMCallParams) => AsyncGenerator<LLMStreamEvent>
  /** Optional abort signal */
  signal?: AbortSignal
  /** Max total iterations across all agents in a pipeline run (default: 50) */
  maxTotalIterations?: number
  /** Token budget for context management */
  contextTokenBudget?: number
}

// ===== AGENT DEPENDENCIES =====

/** Dependencies injected into agent functions (buildMessages, processResult, tool execute) */
export interface AgentDeps {
  organizationId: string
  userId: string
  sessionId: string
  signal?: AbortSignal
}

// ===== AGENT EVENTS =====

/** Events emitted by the engine during pipeline execution — streamed to the frontend */
export type AgentEvent =
  | { type: 'pipeline-started'; route: string; agents: string[] }
  | { type: 'agent-started'; agent: string }
  | { type: 'llm-stream'; agent: string; delta: string }
  | { type: 'llm-complete'; agent: string; content: string; usage: UsageMetrics }
  | { type: 'tool-started'; agent: string; tool: string; args: Record<string, unknown> }
  | {
      type: 'tool-completed'
      agent: string
      tool: string
      result: AgentToolResult
    }
  | { type: 'tool-error'; agent: string; tool: string; error: string }
  | { type: 'agent-completed'; agent: string }
  | {
      type: 'approval-required'
      agent: string
      tool: string
      toolCallId: string
      args: Record<string, unknown>
    }
  | { type: 'tool-rejected'; agent: string; tool: string; toolCallId: string }
  | { type: 'pipeline-completed'; route: string }
  | { type: 'pipeline-error'; error: string }
  | { type: 'message'; role: 'assistant'; content: string; blocks?: AgentBlock[] }
  | { type: 'done' }
