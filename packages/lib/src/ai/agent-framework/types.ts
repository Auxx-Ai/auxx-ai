// packages/lib/src/ai/agent-framework/types.ts

import type { Database } from '@auxx/database'
import type { z } from 'zod'
import type { Message, ModelParameters, Tool, ToolCall, UsageMetrics } from '../clients/base/types'
import type { ToolContext } from './tool-context'

// ===== SESSION & MESSAGE TYPES =====

/** Persisted message in an agent session */
export interface SessionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Tool call ID for tool-result messages */
  toolCallId?: string
  /** Tool calls the assistant wants to make */
  toolCalls?: ToolCall[]
  /** Reasoning content from thinking-enabled models (DeepSeek, Kimi, Qwen) */
  reasoning_content?: string
  /** Timestamp when this message was added */
  timestamp: number
  /** Parent message ID for conversation tree branching (null = root) */
  parentId?: string | null
  /** Optional metadata (e.g. which agent produced this) */
  metadata?: Record<string, unknown>
  /**
   * Literal UI blocks produced by tools (draft-preview, action-result, kb-article-list,
   * docs-results). Persisted alongside the tool message so session reload can re-emit them
   * as role:'block' transcript items. Reference blocks live inside the final assistant
   * message's content as `auxx:*` fences, not here.
   */
  blocks?: AgentBlock[]
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
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'tool-call'; toolCall: ToolCall }
  /**
   * Incremental delta of a tool call's argument JSON string as the model emits it.
   * Used by the query loop to surface streaming `submit_final_answer.content`
   * deltas as `final-message-delta` events. Providers that don't support arg
   * streaming simply never emit this and the loop falls back to the atomic
   * `final-message` event when the tool completes.
   */
  | { type: 'tool-args-delta'; toolCallId: string; toolName?: string; argsDelta: string }
  | { type: 'usage'; usage: UsageMetrics }
  | {
      type: 'done'
      content: string
      toolCalls: ToolCall[]
      usage: UsageMetrics
      providerType?: string
      credentialSource?: string
      reasoning_content?: string
    }

// ===== TOOL TYPES =====

/**
 * Canonical reference-block kind a tool's output maps to. Both a prompt hint
 * (which block the LLM should embed) and the dispatch key for the snapshot
 * walker (what id shape to look for in the output). Omit when the tool emits
 * no id-bearing output (e.g. writes attach literal blocks directly, or
 * metadata-only tools like `list_entities`).
 */
export type ToolOutputBlock = 'entity-list' | 'entity-card' | 'thread-list' | 'task-list'

/** A tool available to an agent, built from node processors or custom definitions */
export interface AgentToolDefinition {
  /** Unique tool name (e.g. 'find_threads', 'reply_to_thread') */
  name: string
  /** Human-readable description for the LLM */
  description: string
  /** JSON Schema for the tool's parameters */
  parameters: Record<string, unknown>
  /**
   * Execute the tool and return a result. The second argument is a caller-
   * agnostic `ToolContext` (see ./tool-context.ts) — same shape whether the
   * tool was invoked from chat, the headless runner, or apply-time.
   */
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<AgentToolResult>
  /**
   * Whether this tool requires human approval before execution. Pass a boolean
   * for static gating, or a predicate to gate per-call based on the call's args
   * (e.g. `(args) => args.mode === 'send'` to approve only sends, not drafts).
   */
  requiresApproval?: boolean | ((args: Record<string, unknown>) => boolean)
  /**
   * Marks this tool as a read-only / side-effect-free operation. When true, the
   * agent query loop caches the first call's result for the duration of the turn
   * and reuses it on any subsequent call with identical args — avoiding redundant
   * DB/API roundtrips when the LLM retries the same lookup.
   */
  idempotent?: boolean
  /**
   * Optional Zod schema for the tool's success `output`. Reserved for future
   * runtime validation + inference; today the snapshot walker uses structural
   * probes instead. Optional so migration is incremental.
   */
  outputSchema?: z.ZodType
  /**
   * Canonical reference-block kind this tool's results map to. Drives both
   * the auto-generated prompt section and the generic snapshot walker.
   */
  outputBlock?: ToolOutputBlock
  /**
   * Escape hatch for non-obvious usage rules (e.g. "search_entities only
   * enriches fields when matches ≤5"). Rendered as-is under the tool's
   * auto-generated entry in the system prompt. Keep to ≤3 sentences.
   */
  usageNotes?: string
  /**
   * Capture-mode hook: predict the tool's output without executing.
   *
   * When the engine runs in `approvalMode: 'capture'`, approval-required tools
   * are not executed — instead, the engine calls `captureMint(args, ctx)` (if
   * defined) and synthesizes a tool-result message from the return value. This
   * lets the model chain captured calls naturally — e.g. a `create_task` whose
   * `captureMint` returns `{ id: 'temp_<localIndex>', ... }` produces a result
   * the model can reference in a downstream `update_task` invocation. Apply-time
   * (Phase 3e) substitutes the temp IDs with real IDs.
   *
   * Tools without `captureMint` fall back to a `{ status: 'queued_for_approval' }`
   * placeholder. The engine wraps the return value with `_captured: true` so
   * downstream code can detect that the output is synthetic. Treated as
   * best-effort: if `captureMint` throws, the engine logs and uses the
   * placeholder. Implementations must be pure / cheap — no DB or network IO.
   */
  captureMint?: (args: Record<string, unknown>, ctx: { localIndex: number }) => unknown
  /**
   * Optional human-readable summary of an invocation. Used when the engine
   * needs to describe a captured action (Today UI, transcripts, telemetry).
   * When absent, the engine falls back to `${toolName}(${truncatedArgs})`.
   */
  summary?: (args: Record<string, unknown>) => string
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
  data: unknown
}

// ===== REFERENCE BLOCK SNAPSHOTS =====

/** Minimal record snapshot written by the tool; preserves display on deletion */
export interface EntitySnapshot {
  recordId: string
  entityDefinitionId: string
  displayName: string
  summary?: string
}

/** Minimal thread snapshot written by the tool */
export interface ThreadSnapshot {
  threadId: string
  subject: string | null
  lastMessageAt: string | null
  sender?: string
  isUnread?: boolean
}

/** Minimal task snapshot written by the tool */
export interface TaskSnapshot {
  taskId: string
  title: string
  deadline: string | null
  completedAt: string | null
}

/**
 * Per-turn map of id → snapshot, populated by per-tool extractors as tool
 * results land. Consumed by `injectSnapshotsIntoFinal()` to backfill
 * `auxx:*` reference-block fences in the final assistant message.
 */
export interface TurnSnapshots {
  records: Record<string, EntitySnapshot>
  threads: Record<string, ThreadSnapshot>
  tasks: Record<string, TaskSnapshot>
}

// ===== AGENT STATE =====

/**
 * A tool call captured for later approval, produced by `approvalMode: 'capture'`.
 * Phase 3b/3e consume `state.capturedActions` to build a bundle and apply it
 * topologically (substituting `temp_<localIndex>` references with real IDs as
 * each captured call executes).
 */
export interface CapturedAction {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  /** Display string — `tool.summary?.(args)` or `${name}(${truncatedArgs})` fallback. */
  summary: string
  /** Monotonic across the entire engine run. Drives `temp_<localIndex>` IDs. */
  localIndex: number
  /** Synthetic output the model saw for this call (always carries `_captured: true`). */
  predictedOutput: unknown
}

/** Stored tool call awaiting human approval — executed directly on resume */
export interface PendingToolCall {
  toolCallId: string
  toolName: string
  agentName: string
  args: Record<string, unknown>
  /**
   * The assistant message that emitted this tool_call. Held here (NOT in
   * state.messages) until the approval resolves, so the persisted messages
   * array can never contain a dangling assistant tool_call. On resume, the
   * engine appends this together with the tool result as one atomic pair.
   */
  assistantMessage: SessionMessage
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
  /** Number of approvals already granted in the current turn (for maxApprovalsPerTurn cap) */
  approvalsThisTurn?: number
  /**
   * Per-turn id → snapshot map. Populated from each tool result; consumed by
   * `injectSnapshotsIntoFinal()` to backfill `auxx:*` fences. Reset at turn start;
   * not persisted between turns.
   */
  turnSnapshots?: TurnSnapshots
  /**
   * Tool calls captured during the current turn under `approvalMode: 'capture'`.
   * Empty in pause mode (chat). Reset at turn start. Phase 3b's headless runner
   * reads this after the engine drains to build a bundle for approval.
   */
  capturedActions?: CapturedAction[]
}

/** Options passed to engine.resume() for approval actions */
export interface ResumeOptions {
  /** Whether the user approved or rejected the pending tool call */
  action: 'approve' | 'reject'
  /** Optional overrides merged into the tool args (e.g. { mode: 'draft' }) */
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
  /** Minimum tool calls required before allowing a text-only exit. If the LLM returns no
   *  tool calls before reaching this threshold, a nudge message is injected to retry. (default: 0) */
  minToolCalls?: number
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
  /**
   * Optional supervisor agent name for multi-agent domains (classifies intent → picks route).
   * When absent, the engine skips classification and enters the first route directly —
   * suitable for solo-agent domains like the v2 Kopilot.
   */
  supervisorAgent?: string
  /** Create initial domain state for a new session */
  createInitialState: (context: Record<string, unknown>) => TDomainState
  /** Merge fresh UI context into domain state before each pipeline run */
  applyContext?: (state: TDomainState, context: Record<string, unknown>) => TDomainState
  /** Default model for agents that don't override */
  defaultModel: string
  /** Default provider for agents that don't override */
  defaultProvider: string
  /**
   * Optional hook called after every successful tool result. Lets a domain mine
   * snapshot data (e.g. `turnSnapshots`) out of tool outputs without the
   * framework knowing the tool's shape. Must return a fresh state object.
   */
  onToolResult?: (toolName: string, result: AgentToolResult, state: AgentState) => AgentState
  /**
   * Optional hook called on the final content string from a terminator tool
   * (e.g. `submit_final_answer`) before it is persisted as the assistant's
   * final message. Kopilot uses this to inject snapshots into `auxx:*` fences
   * and to auto-emit a fallback fence when the LLM forgot to embed one.
   */
  postProcessFinalContent?: (content: string, state: AgentState) => string
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
  /**
   * Database handle threaded into every tool's `ToolContext` at execution
   * time. Required so tools have a uniform db source regardless of caller.
   */
  db: Database
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
  /** Hard cap on total LLM tokens consumed in a single turn (default: 200000) */
  maxTokensPerTurn?: number
  /** Max chained approvals allowed within a single turn before forcing termination (default: 5) */
  maxApprovalsPerTurn?: number
  /**
   * How approval-required tool calls are handled mid-turn.
   * - `'pause'` (default): the loop emits `approval-required` and stops at the
   *   first approval tool, waiting for `engine.resume()`. This is chat behavior.
   * - `'capture'`: the loop never pauses. Approval tools are recorded into
   *   `state.capturedActions` with a synthetic `_captured: true` result (driven
   *   by the tool's `captureMint`), and the loop continues until the model emits
   *   `submit_final_answer` or runs out of tool calls. Read-only tools execute
   *   normally in either mode. Used by the headless kopilot runner.
   */
  approvalMode?: 'pause' | 'capture'
}

// ===== AGENT DEPENDENCIES =====

/** Dependencies injected into agent functions (buildMessages, processResult, tool execute) */
export interface AgentDeps {
  organizationId: string
  userId: string
  sessionId: string
  signal?: AbortSignal
  /** Unique ID for the current turn — stable across all events, logs, and tool calls in one request */
  turnId?: string
}

// ===== AGENT EVENTS =====

/** Per-turn budget summary carried on turn-started / turn-completed events */
export interface TurnBudget {
  maxTokensPerTurn: number
  maxIterations: number
  maxApprovalsPerTurn: number
}

/** Per-turn usage summary carried on turn-completed */
export interface TurnUsageSummary {
  totalTokens: number
  promptTokens: number
  completionTokens: number
  llmCalls: number
}

/**
 * Events emitted by the engine during turn execution — streamed to the frontend.
 * Every event (except `done`) carries a `turnId` tying it to a single user request.
 */
export type AgentEvent = { turnId?: string } & (
  | { type: 'turn-started'; route: string; agents: string[]; budget: TurnBudget }
  | { type: 'turn-completed'; route: string; usage: TurnUsageSummary }
  | { type: 'turn-error'; error: string }
  | { type: 'agent-started'; agent: string }
  | { type: 'llm-stream'; agent: string; delta: string }
  | { type: 'llm-reasoning-stream'; agent: string; delta: string }
  | {
      type: 'llm-complete'
      agent: string
      content: string
      usage: UsageMetrics
      provider: string
      model: string
      providerType?: string
      credentialSource?: string
    }
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
  /** Streaming delta for submit_final_answer.content as the LLM types the final message */
  | { type: 'final-message-delta'; agent: string; delta: string }
  /** Commits the final assistant prose message for the turn */
  | { type: 'final-message'; agent: string; content: string }
  | { type: 'message'; role: 'assistant'; content: string; blocks?: AgentBlock[] }
  | { type: 'session-created'; sessionId: string; title: string; createdAt: string }
  | { type: 'session-title-updated'; sessionId: string; title: string }
  | { type: 'done' }
)
