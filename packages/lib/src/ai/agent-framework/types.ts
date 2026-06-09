// packages/lib/src/ai/agent-framework/types.ts

import type { Database } from '@auxx/database'
import type { VarSource } from '@auxx/types/field'
import type { z } from 'zod'
import type { AgentSurface } from '../../agents/client'
import type { Message, ModelParameters, Tool, ToolCall, UsageMetrics } from '../clients/base/types'
import type { ContextManager } from './context/context-manager'
import type { EvalFieldResolver, Subject, ToolContext, WorkflowToolContext } from './tool-context'

// ===== CONTENT PARTS =====

/**
 * Discriminated content part on an assistant message. Persisted shape is identical
 * to streamed shape — `text` and `tool_call` parts interleave in order.
 */
export type ContentPart = TextPart | ThinkingPart | ToolCallPart

export interface TextPart {
  type: 'text'
  text: string
  /** Which agent produced this part (omitted when same as previous part). */
  agent?: string
}

export interface ThinkingPart {
  type: 'thinking'
  text: string
  agent?: string
}

export type ToolCallStatus = 'running' | 'awaiting-approval' | 'completed' | 'error' | 'rejected'

export interface ToolCallPart {
  type: 'tool_call'
  toolCallId: string
  name: string
  args: Record<string, unknown>
  status: ToolCallStatus
  /** Raw tool output once execution completes. */
  output?: unknown
  /** Display projection of `output` produced by the tool's `buildDigest`. */
  digest?: unknown
  /** Error message when status === 'error'. */
  error?: string
  agent?: string
  /**
   * True when the result was synthesized by capture-mode (no real execution).
   * Drives the "captured" badge in the UI.
   */
  captured?: true
  /** Per-iteration usage metrics (one LLM call produced this tool call). */
  iterationUsage?: UsageMetrics
  /** Input amendment applied at approval time, if any. */
  inputAmendment?: Record<string, unknown>
}

// ===== SESSION & MESSAGE TYPES =====

interface BaseSessionMessage {
  /** Stable id — assigned on creation; used for parentId chains, feedback refs, streaming targets. */
  id: string
  timestamp: number
  /** Parent message ID for conversation tree branching (null = root). */
  parentId?: string | null
  metadata?: Record<string, unknown>
}

/** User-authored message. */
export interface UserSessionMessage extends BaseSessionMessage {
  role: 'user'
  content: string
}

/**
 * System message. Used for the LLM system prompt (transient) AND for
 * approval-card system messages that live alongside assistant messages in
 * the persisted history.
 */
export interface SystemSessionMessage extends BaseSessionMessage {
  role: 'system'
  content: string
  /**
   * When this system message represents a tool approval request, the
   * approval card binds to the assistant message's `tool_call` part with
   * matching `toolCallId`.
   */
  approval?: {
    toolName: string
    toolCallId: string
    args: Record<string, unknown>
    status: 'pending' | 'approved' | 'rejected'
  }
}

/**
 * One LLM call's billing context, persisted per assistant message.
 *
 * A turn may contain multiple LLM calls (one per agent iteration). Each
 * call produces one entry. Billing consumers iterate this array to push
 * usage records with correct SYSTEM-vs-CUSTOM credit gating.
 */
export interface IterationUsage {
  /** 1-based iteration number within the turn. */
  iteration: number
  /** Provider id from `callParams.provider` (e.g. 'anthropic', 'openai'). */
  provider: string
  /** Model id from `callParams.model`. */
  model: string
  /** 'SYSTEM' (auxx-supplied keys) or 'CUSTOM' (BYOK). Drives credit gating. */
  providerType?: 'SYSTEM' | 'CUSTOM'
  /** 'SYSTEM' | 'CUSTOM' | 'MODEL_SPECIFIC' | 'LOAD_BALANCED' — for analytics. */
  credentialSource?: 'SYSTEM' | 'CUSTOM' | 'MODEL_SPECIFIC' | 'LOAD_BALANCED'
  /** Token totals for this call. */
  usage: UsageMetrics
  /** Optional finish reason — useful for diagnosing length-truncated turns. */
  finishReason?: string
}

/** Per-turn metadata persisted on an assistant message. */
export interface AssistantMessageMetadata {
  /** Last agent that produced parts on this turn (responder, by convention). */
  agent?: string
  modelId?: string
  /** Turn-total usage metrics (canonical billing record). */
  usage?: UsageMetrics
  /** True if max_tokens/length stopped the turn. */
  truncated?: boolean
  /** True if any captured tool participated in this turn. */
  captured?: boolean
  /** Per-LLM-call billing breakdown. One entry per agent iteration. */
  iterations?: IterationUsage[]
}

/**
 * Assistant message — one per turn, holding all text/thinking/tool_call parts
 * produced by the agent across all iterations of the LLM loop.
 */
export interface AssistantSessionMessage extends BaseSessionMessage {
  role: 'assistant'
  /** Schema version. 1 = parts-based content blocks. */
  v?: 1
  parts: ContentPart[]
  /** Per-message lookup table for inline `auxx://` link chips. */
  linkSnapshots?: Record<string, LinkSnapshot>
  metadata?: AssistantMessageMetadata
  /** Set when the turn ended in an error. */
  error?: string
}

export type SessionMessage = UserSessionMessage | SystemSessionMessage | AssistantSessionMessage

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
  | { type: 'usage'; usage: UsageMetrics }
  | {
      type: 'done'
      content: string
      toolCalls: ToolCall[]
      usage: UsageMetrics
      /** Cast to `IterationUsage['providerType']` at the consumer site. */
      providerType?: string
      /** Cast to `IterationUsage['credentialSource']` at the consumer site. */
      credentialSource?: string
      reasoning_content?: string
      /**
       * Provider-reported reason the response ended. Normalized: `length` means
       * the output cap was hit (Anthropic `max_tokens`, OpenAI `length`). Used
       * to detect truncated tool_use input and warn before falling into the
       * empty-args trap.
       */
      finishReason?: string
    }

// ===== TOOL TYPES =====

/** A tool available to an agent, built from node processors or custom definitions */
export interface AgentToolDefinition {
  /** Unique tool name (e.g. 'find_threads', 'reply_to_thread') */
  name: string
  /** Short, human-friendly label for chips, pickers, and audit UI (e.g. 'Reply to thread'). */
  displayName: string
  /** Human-readable description for the LLM */
  description: string
  /** JSON Schema for the tool's parameters */
  parameters: Record<string, unknown>
  /**
   * Execute the tool and return a result. The second argument is a caller-
   * agnostic `ToolContext` (see ./tool-context.ts) — same shape whether the
   * tool was invoked from chat, the headless runner, or apply-time.
   *
   * Streaming variant: returning an `AsyncGenerator<ToolProgressPayload, AgentToolResult>`
   * lets the tool emit progress updates during a long-running call. The query
   * loop forwards each yielded payload as a `tool-progress` agent event, and
   * the generator's return value becomes the final tool result. App-backed
   * tools opt into this via `defineTool({ config: { streaming: true } })`;
   * native capabilities are buffered today.
   */
  execute: (
    args: Record<string, unknown>,
    ctx: ToolContext
  ) => Promise<AgentToolResult> | AsyncGenerator<ToolProgressPayload, AgentToolResult, void>
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
   * Zod schema for the **full** shape of the tool's success `output` — the same
   * value persisted on `ToolCallPart.output` and replayed to the model. This is
   * the single source of truth for the output's shape.
   *
   * **Declarative, not enforced:** the engine does NOT parse/throw against this at
   * execute time (output stays `unknown` on the wire). It exists so consumers can
   * (a) type/enumerate an addressable `tool:<name>.<path>` ref for the prompt's
   * available-context section, (b) let v8 bind a later tool's input to an earlier
   * tool's output, and (c) declare a connector referenceable before it is called
   * (lazy fetch-on-read). See plans/chat/v9/OUTPUT-SCHEMAS.md.
   *
   * The small UI render projection is `buildDigest` — a *projection of this
   * schema*, not a competing one. Optional so migration is incremental.
   */
  outputSchema?: z.ZodType
  /**
   * One realistic example of this tool's success `output` — the same shape as
   * `outputSchema` describes. Authored once by the tool owner; consumed by eval
   * autofill (seeds a tool-response mock) via `getToolExampleOutput`. Must be
   * JSON-serializable; for app-backed tools it is carried verbatim from the
   * SDK `tool.exampleOutput` through the catalog. Declarative, optional, and
   * never enforced at runtime. See plans/evals/tool-example-outputs.md.
   */
  exampleOutput?: unknown
  /**
   * Build the small display projection of the tool's output. Called once at
   * tool-completion time; the result is persisted on `ToolCallPart.digest` and
   * re-emitted on session reload — status pills and approval/result cards render
   * from it. A projection of `outputSchema` (the single source of truth); trusted
   * as-is (not re-validated). When omitted, the UI falls through to a generic
   * pill rendering name + args summary. MUST be deterministic and pure.
   */
  buildDigest?: (output: unknown) => unknown
  /**
   * Schema for input-amendment data sent back from the approval card on
   * approve. The amendment is shallow-merged into the original args before
   * execution. Use for tool-mode toggles ("Save as draft" / "Send"), recipient
   * edits, body overrides, etc.
   */
  inputAmendmentSchema?: z.ZodType
  /**
   * Optional input validator + normalizer. Runs after `parseToolArgs` and
   * before `execute()` (or before `captureMint` in capture mode). Lets the
   * tool reshape LLM args into canonical form and reject unrecoverable
   * inputs with an LLM-actionable error message.
   *
   * - `{ ok: false, error }` short-circuits the call: the engine emits a
   *   `tool-call-completed` event with `success: false` + the error, and skips
   *   `execute()` / `captureMint`. Counts as one tool-loop iteration.
   * - `{ ok: true, args, warnings? }` lets the tool rewrite args before
   *   `execute()` sees them. Warnings are logged at info level only — not
   *   surfaced to the user or the LLM.
   *
   * `ctx` is `ToolContext` so the validator can read from the org cache
   * (entity-def slugs, members, groups). It must NOT touch the DB.
   */
  validateInputs?: (
    args: Record<string, unknown>,
    ctx: ToolContext
  ) => Promise<
    { ok: true; args: Record<string, unknown>; warnings?: string[] } | { ok: false; error: string }
  >
  /**
   * Escape hatch for non-obvious usage rules (e.g. "search_entities only
   * enriches fields when matches ≤5"). Rendered as-is under the tool's
   * auto-generated entry in the system prompt. Keep to ≤3 sentences.
   */
  usageNotes?: string
  /**
   * Slug grouping this tool into a toolset for per-agent enablement.
   * Phase 1+ uses this to filter `tools` by an agent's enabled toolsets at
   * session-init time. Tools without a slug are treated as core/always-on
   * (plan tools, future `search_records` / `load_records`, etc.).
   *
   * Format: `<domain>.<group>` — kebab segments. App-provided tools will
   * use the `app:<app-id>:<group>` shape.
   */
  toolsetSlug?: string
  /**
   * Surfaces this tool is offered on (allow-list). Absent ⇒ every surface
   * (the permissive default). Narrow it only when a tool makes no sense in a
   * context — e.g. the agent-builder meta-tools set `['builder']`. NOT a
   * security boundary: the admin adding a toolset to an agent + the restriction
   * engine are. See plans/chat/v6/chat-tool-availability.md.
   */
  surfaces?: AgentSurface[]
  /**
   * Advisory: verified safe for an untrusted, externally-identified caller
   * (anonymous/just-verified chat visitor, email sender) — either self-clamps
   * on a visitor turn (`search_knowledge`) or is identity-scoped. Absent ⇒ the
   * chat/email Tools UI flags it with a warning. Replaces `chatSafe`; not a
   * gate. See plans/chat/v6/chat-tool-availability.md.
   */
  externalSafe?: boolean
  /**
   * Per-input **default** binding declared by the tool/app author (plans/chat/v8
   * phase-3). The platform resolves each from the subject (phase-1/2) and clamps
   * it onto the args before `execute`; the model never supplies a bound input.
   * The admin can override per agent (phase-5). Absence ⇒ the model supplies the
   * input normally.
   *
   * Carried verbatim from the SDK's `tool.agent.inputBindings` for app tools, or
   * set directly on a native definition. Top-level scalar input names only
   * (structured paths are a follow-up).
   */
  inputBindings?: ReadonlyArray<{ name: string; default: VarSource }>
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
}

/**
 * Payload yielded by a streaming tool. The shape is intentionally loose —
 * each tool decides what to put in `data`; the digest / UI layer is
 * responsible for rendering. `kind` is an optional hint (e.g. 'phase',
 * 'partial', 'count') for renderers that want to dispatch on type.
 */
export interface ToolProgressPayload {
  kind?: string
  data: unknown
}

// ===== REFERENCE BLOCK SNAPSHOTS =====

/** Minimal record snapshot written by the tool; preserves display on deletion */
export interface EntitySnapshot {
  recordId: string
  entityDefinitionId: string
  displayName: string
  summary?: string
  /**
   * Free-form per-resource hints captured from the tool output. Used by
   * resource types that don't fit the generic `<defId>:<instId>` detail-page
   * pattern (e.g. articles, which live at /app/kb/<kbId>/editor/<slug>).
   * Renderers may read known keys to derive deep links.
   */
  extras?: Record<string, string>
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

/** Minimal draft snapshot written by the list_drafts tool */
export interface DraftSnapshot {
  /** RecordId — `thread:<id>` for in-progress replies, `draft:<id>` for standalones */
  id: string
  kind: 'reply' | 'standalone'
  subject: string | null
  recipientSummary: string | null
  snippet: string | null
  updatedAt: string | null
  scheduledAt: string | null
  /** Populated when kind === 'reply'; the underlying thread instance id */
  threadId: string | null
}

/** Minimal knowledge-base / docs snapshot written by search_docs / search_knowledge */
export interface DocSnapshot {
  /** URL-friendly id used in `auxx://doc/<slug>` */
  slug: string
  title: string
  description?: string
  /**
   * Canonical https URL the chip links to. Optional — internal KB articles may
   * not have a stable user-facing URL yet, in which case the chip is
   * hover-only.
   */
  url?: string
}

/**
 * Per-turn map of id → snapshot, populated by per-tool extractors as tool
 * results land. Consumed by `injectSnapshotsIntoFinal()` to backfill
 * `auxx:*` reference-block fences and by inline-link post-processing to
 * build per-message `linkSnapshots` maps.
 */
export interface TurnSnapshots {
  records: Record<string, EntitySnapshot>
  threads: Record<string, ThreadSnapshot>
  tasks: Record<string, TaskSnapshot>
  drafts: Record<string, DraftSnapshot>
  docs: Record<string, DocSnapshot>
}

export function createEmptyTurnSnapshots(): TurnSnapshots {
  return { records: {}, threads: {}, tasks: {}, drafts: {}, docs: {} }
}

/**
 * A snapshot value referenced by an inline `auxx://` link in an assistant
 * message. Persisted on the assistant `SessionMessage` so reload renders the
 * hover-card preview without re-fetching.
 */
export type LinkSnapshot = EntitySnapshot | ThreadSnapshot | TaskSnapshot | DocSnapshot

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

/**
 * Pointer to a tool_call part awaiting approval. The assistant message that
 * owns the paused part already lives in `state.messages` with the part in
 * `status: 'awaiting-approval'` — resume mutates that part in place.
 */
export interface PendingToolCall {
  /** Assistant message that owns the paused tool_call part. */
  messageId: string
  /** Index of the tool_call part within `parts[]`. */
  partIndex: number
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
   * Cheap same-provider sibling of {@link defaultModel}, auto-derived via
   * `resolveUtilityModel`, for low-stakes internal LLM tasks (procedure
   * selection/routing, goal-met checks) — never the customer-facing reply.
   * Optional: producers that don't set it leave callers to fall back to the
   * primary. See `ai/providers/utility-model.ts`.
   */
  utilityModel?: string
  /** Provider for {@link utilityModel} (same family as {@link defaultProvider}). */
  utilityProvider?: string
  /**
   * Optional hook called after every successful tool result. Lets a domain mine
   * snapshot data (e.g. `turnSnapshots`) out of tool outputs without the
   * framework knowing the tool's shape. Must return a fresh state object.
   */
  onToolResult?: (toolName: string, result: AgentToolResult, state: AgentState) => AgentState
  /**
   * Optional hook called after `onToolResult`, before the LLM-visible tool
   * message is built. Lets a domain rewrite a tool's raw output into the
   * canonical shape the model should see next iteration — typically expanding
   * a sentinel/delta against domain state. Pure read of `state`; do not
   * mutate (that's `onToolResult`'s job). Return `undefined` to leave the
   * result untouched.
   *
   * Runs in both the live tool-call path and the approval-resume path.
   */
  transformToolResult?: (
    toolName: string,
    result: AgentToolResult,
    state: AgentState
  ) => AgentToolResult | undefined
  /**
   * Optional hook called before a tool's `validateInputs` / `execute` runs.
   * Lets a domain inject defaults into tool-call arguments (e.g. pre-fill
   * `threadId` from the user's active thread reference). Pure transform of
   * `args` against `state`; do not mutate either. Return the rewritten
   * args object — or just return the input untouched if no change applies.
   *
   * Runs in both the live tool-call path and the approval-resume path.
   */
  transformToolInput?: (
    toolName: string,
    args: Record<string, unknown>,
    state: AgentState
  ) => Record<string, unknown>
  /**
   * Optional hook called on the responder's final content string before it is
   * persisted as the assistant's final message. Kopilot uses this to inject
   * snapshots into `auxx:*` fences and build the per-message `linkSnapshots`
   * lookup table for inline `auxx://` chips.
   */
  postProcessFinalContent?: (content: string, state: AgentState) => PostProcessResult
  /**
   * Optional hook for the engine's `Turn submitted` log entry. Lets a domain
   * surface debug-relevant context fields (refs, page, …) without the
   * framework knowing the shape. Return value is serialized into the log line.
   */
  summarizeContext?: (
    context: Record<string, unknown> | undefined
  ) => Record<string, unknown> | undefined
  /**
   * Optional hook fired once at the end of a turn, after final state is
   * computed and before the terminal event is yielded. Runs in whatever
   * process executes the engine (web route for in-process, worker for the
   * BullMQ path), so a domain can commit or roll back side-effects keyed off
   * domain state regardless of where the turn ran.
   *
   * `outcome` is `'completed'` for a clean finish and `'error'` for a
   * turn-error, an aborted run, or a client disconnect. It does NOT fire when
   * a turn pauses for approval (the turn isn't over). Must not throw — the
   * engine wraps it in try/catch so a hook failure can't mask the turn result.
   *
   * `turnId` is the engine's id for the turn that just ended (undefined only if
   * no turn was active). Domains that scope per-turn side-effects by turn id —
   * e.g. fanning the hook out to capability lifecycles — read it here instead of
   * smuggling turn-ephemeral identity through the persisted `domainState`.
   */
  onTurnEnd?: (state: AgentState, outcome: 'completed' | 'error', turnId?: string) => Promise<void>
  /**
   * Optional hook to clear per-turn domain state at the start of a NEW user
   * turn (`submitMessage`) — NOT on approval-resume, which continues the same
   * turn. Mirrors the engine's reset of `turnSnapshots` / `capturedActions`.
   * Return a fresh domainState (or the same reference when nothing to clear).
   */
  resetTurnDomainState?: (domainState: Record<string, unknown>) => Record<string, unknown>
}

/** Return shape from `postProcessFinalContent`. */
export interface PostProcessResult {
  content: string
  /** Per-message lookup table for inline `auxx://` link chips (G phase). */
  linkSnapshots?: Record<string, LinkSnapshot>
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
   *   by the tool's `captureMint`), and the loop continues until the model
   *   returns no tool calls. Read-only tools execute normally in either mode.
   *   Used by the headless kopilot runner.
   * - `'auto'`: the loop never pauses and approval-required tools execute
   *   like any other tool. Used by autonomous agent triggers — the agent's
   *   toolset is the capability boundary, so wiring the tool onto the agent
   *   IS the authorization. There is no human in the loop to ask.
   */
  approvalMode?: 'pause' | 'capture' | 'auto'
  /**
   * Workflow handle threaded into every tool's `ToolContext` when this engine
   * runs inside a workflow AI node. Lets workflow-native tools
   * (`assign_variable`, future code-eval, …) reach the active run's execution
   * context without forming a hard dependency on `@auxx/lib/workflow-engine`.
   */
  workflow?: WorkflowToolContext
  /**
   * The turn's **subject** — the ambient records in scope. The engine copies it
   * onto every tool's `ToolContext` so tool bindings can clamp identity / scope
   * inputs to a subject-derived record. Undefined for kopilot / builder /
   * autonomous-trigger runs (bound inputs then fall through to the model).
   * See plans/chat/v8.
   */
  subject?: Subject
  /**
   * The agent's bound app accounts (`Agent.appAccounts`), copied onto every
   * tool's `ToolContext` so the binding resolver can scope an `@app:<slug>:<key>`
   * var segment to the agent's connection at turn time (plans/chat/v8 phase-2).
   */
  appAccounts?: Record<string, { credId: string }>
  /**
   * The execution-context manager to thread onto every tool's `ToolContext` as
   * `ctx.context` (chat v9). Set by a workflow AI node to its live
   * `ExecutionContextManager` (which conforms to `ContextManager`); left unset
   * by chat / job / headless runs, where the engine builds a fresh
   * `KopilotContextStore` hydrated from `domainState.__context`.
   */
  context?: ContextManager
  /**
   * Applied to every tool call's args immediately before validateInputs /
   * execute, in both the live and approval-resume paths. Lets the caller
   * clamp arguments per the agent's restriction map (constant / dynamic-var
   * override) and refuse the call when a required binding can't resolve.
   * Caller-provided so the engine stays free of the var registry. See
   * plans/chat/v6 phase-1.
   *
   * On `{ ok: false }` the engine short-circuits the call exactly like a
   * `validateInputs` failure (emits tool-call-failed, skips execute, counts
   * as one iteration). On `{ ok: true }` the returned `args` object MUST be
   * the one threaded into validateInputs / execute / prepareLambdaCall — the
   * engine never re-reads the pre-clamp args.
   */
  applyToolRestrictions?: (
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ) => Promise<{ ok: true; args: Record<string, unknown> } | { ok: false; error: string }>
  /**
   * Eval-only frozen framework clock (epoch ms). When set, every tool `ToolContext.now`
   * and the framework `sys:now` read this instead of the wall clock, so a Simulation's
   * `timeFrozenAt` makes time deterministic. Absent on every production run.
   */
  nowMs?: number
  /**
   * Eval-only subject field overlay. When set, the engine copies it onto every tool's
   * `ToolContext.evalFieldResolver` so `startingFields` override CRM reads without a
   * write. Absent on every production run (the subject resolver reads `subject.anchors`).
   */
  evalFieldResolver?: EvalFieldResolver
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
 *
 * All assistant-content events carry `messageId` (the assistant message they
 * mutate) and, where applicable, `partIndex` (the part within that message).
 * The frontend mirrors them as direct mutations to `messages[messageId].parts[partIndex]` —
 * no derivation, no fallbacks.
 */
export type AgentEvent = { turnId?: string } & (
  | { type: 'turn-started'; route: string; agents: string[]; budget: TurnBudget }
  | { type: 'turn-completed'; route: string; usage: TurnUsageSummary }
  | { type: 'turn-error'; error: string; messageId?: string }
  | { type: 'agent-started'; agent: string }
  /** Opens a new assistant message. The frontend appends an empty bubble keyed by `messageId`. */
  | { type: 'assistant-message-started'; messageId: string; agent: string }
  /** Extend a text part at `partIndex`. The first text-delta for a fresh part also creates the part. */
  | { type: 'text-delta'; messageId: string; partIndex: number; delta: string }
  /** Extend a thinking part at `partIndex` (reasoning content). */
  | { type: 'thinking-delta'; messageId: string; partIndex: number; delta: string }
  | {
      type: 'tool-call-started'
      messageId: string
      partIndex: number
      toolCallId: string
      name: string
      agent: string
      args: Record<string, unknown>
    }
  | {
      type: 'tool-call-status'
      messageId: string
      partIndex: number
      toolCallId: string
      agent: string
      status: ToolCallStatus
      digest?: unknown
    }
  | {
      type: 'tool-call-completed'
      messageId: string
      partIndex: number
      toolCallId: string
      agent: string
      output: unknown
      digest?: unknown
      captured?: true
    }
  | {
      type: 'tool-call-failed'
      messageId: string
      partIndex: number
      toolCallId: string
      agent: string
      error: string
    }
  | {
      /**
       * Streaming tools emit one or more progress updates between
       * `tool-call-started` and `tool-call-completed`.
       */
      type: 'tool-progress'
      messageId: string
      partIndex: number
      toolCallId: string
      agent: string
      kind?: string
      data: unknown
    }
  | {
      type: 'approval-required'
      messageId: string
      partIndex: number
      toolCallId: string
      toolName: string
      agent: string
      args: Record<string, unknown>
      digest?: unknown
      /**
       * ID of the system approval-card message the server pushed into
       * `state.messages` alongside the paused assistant message. The client
       * uses this id when synthesizing the card in its local store so
       * refresh-from-persistence and live-streaming render the same message.
       */
      approvalMessageId: string
    }
  /**
   * Commits the canonical final state of an assistant message. Carries the
   * full final parts array (post link-snapshot rewrite, post-processed) plus
   * `linkSnapshots` and turn-total `usage`. The frontend's `finalizeMessage`
   * replaces the in-store message wholesale — streaming + refresh both render
   * from the same data.
   */
  | {
      type: 'assistant-message-finished'
      messageId: string
      agent: string
      parts: ContentPart[]
      linkSnapshots?: Record<string, LinkSnapshot>
      usage?: UsageMetrics
      truncated?: boolean
      /**
       * Per-LLM-call billing breakdown for this turn. Consumers iterate this
       * to push usage records with correct SYSTEM-vs-CUSTOM credit gating.
       * Mirrors `message.metadata.iterations`.
       *
       * Contains only the iterations executed since the last `started`/`resumed`
       * bracket — not the whole turn's history. Billing collectors drain on
       * both `paused` and `finished` for full coverage across pause boundaries.
       */
      iterations?: IterationUsage[]
    }
  /**
   * Suspends streaming on an assistant message that is paused for approval.
   * The message stays open server-side; the same `messageId` will resume
   * appending parts after `engine.resume()` runs. Carries per-LLM-call
   * billing for the iterations that ran in this segment so consumers can
   * push usage records before suspension.
   */
  | {
      type: 'assistant-message-paused'
      messageId: string
      agent: string
      iterations?: IterationUsage[]
    }
  /**
   * Re-opens streaming on a previously-paused assistant message. The
   * frontend uses this to flip `isStreaming` back on for the existing
   * bubble keyed by `messageId` — no new bubble is created.
   */
  | { type: 'assistant-message-resumed'; messageId: string; agent: string }
  | { type: 'session-created'; sessionId: string; title: string; createdAt: string }
  | { type: 'session-title-updated'; sessionId: string; title: string }
  | { type: 'done' }
)
