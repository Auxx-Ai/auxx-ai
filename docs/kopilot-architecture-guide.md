# Kopilot Architecture Guide

Kopilot is an AI-powered assistant embedded in the Auxx.ai web app. A single agent owns the full turn: it calls page-scoped tools in a loop, writes structured `auxx:*` reference fences, and ends the turn implicitly when it stops calling tools (or explicitly via an `endsTurn` tool).

## System at a Glance

```
User Input (Composer)
  |
  v
SSE POST /api/kopilot/stream ──── Auth + Feature Gate
  |                                └─ resolveContinuationSurface (restore page/context
  |                                   for approval-resume / task-notification turns)
  v
AgentEngine (in-process or BullMQ worker)
  |
  ├── Context Manager ── compress old messages if over token budget
  ├── KopilotContextStore ── hydrate domainState.__context (vars, captured tool calls)
  ├── Solo Agent (query loop, up to 30 iterations)
  │     ├── buildMessages: system prompt + transformed history
  │     ├── LLM call (streaming, tool-calling)
  │     ├── applyContextDefaults: pre-fill binding args from session refs
  │     ├── execute tool calls → onToolResult / transformToolResult hooks
  │     ├── endsTurn tool succeeded → finalize turn without re-invoking LLM
  │     └── stop when LLM returns no tool calls (final prose + fences)
  ├── Snapshot Walker ── mines tool outputs for entity/thread/task/doc snapshots
  └── postProcessFinalContent ── inject snapshots, extract auxx://-link snapshots
  |
  v
SSE Events → Frontend Store → UI Render
  |                └─ task-watch-store: poll async-task refs → inject
  |                   <task-notification> message → new turn
  v
Persist: messages + domainState (incl. __context) + linkSnapshots → AiAgentSession (JSONB)
```

## Solo Agent, Not a Pipeline

The previous design used a multi-agent pipeline (supervisor → planner → executor → responder) with a route table. That has been collapsed into a **single agent** (`agents/agent.ts`) registered against a single `default` route. There is no supervisor, no planner agent, and no separate responder.

Multi-step planning is now a tool concern, not an agent concern: the agent calls `plan_create` to publish steps and `plan_update_step` to advance them. The plan lives on `KopilotDomainState.plan` and persists across turns until replaced.

## Execution Context (chat v9)

A shared `ContextManager` interface is threaded onto every `ToolContext` as `ctx.context`, so a tool reaches turn state the same way whether it runs in plain chat, internal Kopilot, or inside a workflow AI node. Two backing stores conform to it: `KopilotContextStore` (the full implementation) and the workflow `ExecutionContextManager` (via thin adapters).

Values are addressed by a typed string grammar (`ContextRef`), parsed once into `(kind, root, path)` and navigated by one shared path walker:

- `var:*` — scratch namespace, **persists across turns** (e.g. `var:cart.total`)
- `tool:*` / `call:*` — captured tool invocations, **turn-scoped** (`tool:search_entities` latest, `tool:search_entities[]` all, `call:<toolCallId>` exact)
- `sys:*` — read-only system values (`userId`, `orgId`, `now`, `agentName`)
- `FieldReference` — v8 entity-field grammar, resolved off `Subject.anchors`, memoized per turn

The store serializes onto `domainState.__context` (`CONTEXT_SLICE_KEY`): `vars` survives across turns; the optional `turn` sub-slice (captured tool outputs) survives an approval pause/resume but is wiped by `resetTurn()` on a new user message. A 256KB cap drops the turn slice on overflow.

**Input bindings** (renamed from `restrictions`): tools declare `inputBindings?: ReadonlyArray<{ name; default: VarSource }>` on `AgentToolDefinition` to wire arguments to context sources.

## Session Context Refs & Arg Pre-fill

The composer's context chips (current page, `@`-mentions) flow in as `SessionContext.references`. Three layers agree on precedence (mention wins over surface):

1. The agent prompt teaches the model about "Active references".
2. `applyContextDefaults()` (`kopilot/context-refs.ts`) pre-fills empty binding args (`threadId`, `articleId`, `knowledgeBaseId`, `actorId`) from the matching ref before dispatch — even if the model ignored the prompt.
3. `findRef()` / `findAllRefs()` give tools direct access to the same precedence rules.

`record` is deliberately not auto-bound: pages often have several record-ish things live at once, and silently routing the wrong one is worse than asking.

## Async Task Notifications

Tools that fire background work (BullMQ jobs, minutes-long eval suites) opt into async continuation instead of blocking the loop: they return immediately with `taskNotification: { kind, ref }` in their success output. The client (`task-watch-store` + `use-task-watchers`) watches the ref; when the task reaches a terminal state, it injects a server-built `<task-notification>` message that triggers a new Kopilot turn automatically.

Per-kind handlers (`task-notifications/kinds/`) know how to load the task, check terminal status, and summarize the outcome for the follow-up turn — `eval-suite` is the first kind (`run_eval_suite` tool). Convention doc: `plans/kopilot/task-notifications/convention.md`.

## Continuation Surfaces

Approval-resume and task-notification turns POST to `/api/kopilot/stream` without `page`/`context`, which used to drop the original page-scoped tools. `resolveContinuationSurface()` (`kopilot/continuation-surface.ts`) restores the persisted surface (`LAST_PAGE_KEY` / `LAST_CONTEXT_KEY` on `domainState`) **only for continuation turns** — fresh message turns deliberately stay page-less (global tools only), and live request values always win when present.

## Terminal Tools & Tool Categories

- **`endsTurn`** — a tool marked `endsTurn: true` is a turn-terminal UI directive. When all tool calls in an iteration are `endsTurn` tools and all succeed, the query loop finalizes the turn immediately without re-invoking the LLM; the prose emitted alongside the call becomes the final reply (e.g. `suggest_replies`).
- **`category`** — tools self-classify for UI visibility: `control` (agent-loop plumbing like plan tools; hidden from user-facing lists, exempt from eval mock wrapping), `system` (platform built-ins like entity reads; collapsed by default in the eval mock editor), `capability` (default; ordinary user-meaningful tools).

## Beyond Chat: Runners, Effective Runtime, Evals

The Kopilot engine is reused outside the chat surface:

- **Runners** (`kopilot/runners/`) — `run-workflow-ai-turn.ts` drives workflow AI nodes through the same agent loop; `run-structured-output-pass.ts` runs single-shot structured extraction.
- **Effective runtime** (`agent-framework/effective-runtime.ts`) — unified execution abstraction covering capture mode, mock tools, and field overlays, so the same agent definition runs live, dry, or simulated. This is also the production path that wires MCP capabilities, applies per-agent toolset scoping, and sets `maxIterations` (30 for Kopilot).
- **Live customer chat** (`packages/lib/src/chat/agent/`) — the visitor-facing chat agent runs on the same engine via `build-chat-engine-config.ts`, differentiated by surface/audience (below) rather than a separate pipeline.
- **Evals** (`packages/lib/src/evals/`) — assertion-graded simulation suites run agents through the effective runtime with mocked tools, support draft-vs-pinned procedure binding and baseline diffing, and report back into chat via the `run_eval_suite` tool + task notification.

## Surface & Audience

The same agent engine serves several rendering targets. Two orthogonal axes select prompt formatting and semantics; both default for Kopilot but are set explicitly by the chat/email surfaces:

- **`surface`** (`AgentSurface = 'internal' | 'chat' | 'email' | 'builder'`, `agents/client.ts`) — the rendering medium. `builder` emits rich `auxx:*` reference fences (internal Kopilot); `chat`/`email` emit plain text for customer channels.
- **`audience`** (`'member' | 'customer'`) — who reads the output. `member` enables internal/debugging framing; `customer` switches the job-statement and house rules to a customer-facing voice.

`effective-runtime.ts` derives both when not explicitly passed: a customer trigger ⇒ `audience: 'customer'`, and the surface is inferred from the trigger/channel (chat vs email). Kopilot defaults to `surface: 'builder', audience: 'member'`; the live chat agent sets `surface: 'chat', audience: 'customer'` in `build-chat-engine-config.ts`. Prompt sections (`prompts/sections/job-statement.ts`, `chat-formatting.ts`, `house-rules.ts`) branch on these. Tools may also declare `surfaces?: AgentSurface[]` to opt out of surfaces where they don't apply.

## MCP Integration

Client-side MCP servers contribute tools to the agent loop as a **global capability** (`ai/mcp/`, a ~20-file subsystem separate from `kopilot/`). `createMcpCapabilities({ organizationId, autonomous })` (`mcp/capabilities.ts`) is registered by the effective runtime and the chat-engine config, so MCP tools appear alongside native capabilities for both Kopilot and customer agents.

- **Adaptation** — `buildMcpAgentTools()` (`mcp/tool-adapter.ts`) wraps each MCP tool as an `AgentToolDefinition`, names it `mcp__<server>__<tool>`, and sets `requiresApproval` from `readOnlyHint`/`trusted` so writes pause for HITL by default.
- **Untrusted output** — results are marked with an output boundary (`outputBoundary: { server, tool }`) and fenced as untrusted before reaching the model.
- **Autonomous runs** drop untrusted write tools entirely.
- **Resilience** — `rate-limiter.ts` caps per-turn/org MCP calls; `call-with-auth-retry.ts` retries and flags 401s for reconnect. Server discovery/sync/auth live in `mcp/{discovery,sync,auth,client}.ts`.

## Per-Agent Tool Scoping

Agents don't get every registered tool. Toolsets are scoped per-agent (allow-list semantics), and the agent builder edits them via the `set_agent_toolsets` tool (`capabilities/agents-builder/`), which accepts `enabledTools?: string[]` per toolset — for MCP servers this restricts which of the server's tools the agent may call. Selections validate against the org toolset catalog for the surface (`agents/toolset-catalog.ts`) and are applied at session init before domain-config assembly.

## Key Design Decisions

- **Async generators everywhere** — the engine and query loop yield `AgentEvent` objects, enabling real-time SSE streaming without buffering.
- **JSONB message storage** — full conversation history (messages + domainState) persisted as JSONB in `AiAgentSession`, not normalized rows.
- **Page-scoped capabilities** — tools are registered per page (e.g., mail tools only on the mail page). Entity / actor / knowledge tools are global (`__global__`).
- **Human-in-the-loop (HITL)** — tools marked `requiresApproval` pause the loop. The frontend renders an approval card; on approve/reject (with optional input amendment), the engine resumes. Captured tool outputs survive the pause via the `__context` turn slice.
- **Reference fences, not blocks-as-content** — the agent writes prose with `auxx:<type>` fenced JSON references (entities, threads, tasks, plan-steps, docs, tables). The frontend resolves them against per-message snapshots into interactive cards.
- **Snapshot mining** — every tool output is walked for entity / thread / task ids; knowledge tools also contribute doc snapshots. Captured into `state.turnSnapshots` and injected into the final assistant message before persistence.
- **Inline `auxx://` links** — references inside prose (e.g. `[ACME](auxx://record/<defId>:<instId>)`) get a per-message `linkSnapshots` lookup so hover cards work after reload without any tool replay. The href grammar is `auxx://<kind>/<id>`, and only four kinds resolve to a snapshot — `record`, `thread`, `task`, `doc` (`blocks/extract-link-snapshots.ts`); the chip renderer additionally accepts `actor`, and anything else falls back to a label-only chip.
- **Plan as state** — plans live on `KopilotDomainState.plan` and survive across turns. `plan_update_step` validates the patch against the current plan and surfaces explicit errors back to the LLM via `transformToolResult`.
- **Real-USD usage metering** — every LLM call records actual provider COGS (including prompt-cache costs) with provider type (`SYSTEM` vs BYOK) and credential source per iteration; credits are derived from list-price USD, not flat multipliers (`packages/lib/src/ai/quota/`, `ai/usage/`).
- **Realtime refresh, not rail signals** — admin-side mutations (agent builder, procedures) emit `agent:updated` / `procedure:updated` realtime events on the org channel; clients use them as refresh signals instead of tool-output rail hacks.
- **Handoff as pure intent** — the unified `handoff` tool (`chat/agent/tools/handoff.ts`) doesn't flip thread state itself; it writes a `{ kind: 'handoff' }` signal into the context store. A single post-turn applier (`flipHandoffState`, `chat/agent/handoff.ts`) performs the actual state flip, so chat and procedure agents share one tool and one flip site.

## File Map

```
packages/lib/src/ai/
├── agent-framework/             # Generic agent engine (domain-agnostic)
│   ├── types.ts                 # AgentState, AgentEvent, AgentDefinition, ToolCategory,
│   │                            # endsTurn, inputBindings, taskNotification, IterationUsage
│   ├── engine.ts                # AgentEngine — turn orchestration, persistence, resume
│   ├── query-loop.ts            # Single-agent tool loop (incl. endsTurn finalization)
│   ├── context-manager.ts       # Token budget / message compression (NOT the ctx.context store)
│   ├── context/                 # Chat-v9 execution context (ctx.context)
│   │   ├── context-manager.ts   # ContextManager contract, ContextRef grammar
│   │   ├── context-store.ts     # KopilotContextStore — vars, captured calls, __context slice
│   │   ├── context-ref.ts       # parseContextRef()
│   │   ├── path-walker.ts       # Shared path navigation
│   │   └── sources/             # field-source (v8 FieldReference), sys-source
│   ├── effective-runtime.ts     # Unified live/capture/mock execution (evals)
│   ├── capture-mode.ts          # CapturedAction collection during dry runs
│   ├── sessions/                # catchup-replay, find-or-create-thread-session
│   ├── builder-model.ts
│   ├── trigger-seed-message.ts
│   ├── llm-adapter.ts           # LLM provider abstraction (callModel)
│   ├── event-publisher.ts       # Redis pub/sub for SSE events
│   ├── tool-bridge.ts           # AgentToolDefinition → LLM tool schema + executor
│   ├── tool-context.ts          # ToolContext type passed to tool handlers
│   ├── tool-inputs.ts           # Shared input schemas (pagination, etc.)
│   ├── flatten-messages.ts      # Model-switch helpers (clean state, flatten history)
│   ├── run-log.ts               # withAgentRunLog — per-run debug log wrapper
│   ├── enqueue-agent-job.ts     # BullMQ job creation
│   ├── process-agent-job.ts     # BullMQ job handler (worker mode)
│   └── utils.ts
│
├── kopilot/                     # Kopilot domain layer
│   ├── types.ts                 # KopilotDomainState, SessionContext, PlanState, PlanStep
│   ├── domain-config.ts         # Solo-agent config: tools, onToolResult, postProcessFinalContent
│   ├── context-refs.ts          # findRef / applyContextDefaults — session-ref arg pre-fill
│   ├── continuation-surface.ts  # resolveContinuationSurface — restore page/context on resume
│   ├── task-notifications/      # Async-task continuation
│   │   ├── types.ts             # TaskNotificationRef, TaskSnapshot, kind handler contract
│   │   ├── registry.ts          # Handler lookup by kind
│   │   ├── body.ts              # buildTaskNotificationBody — the injected message
│   │   └── kinds/eval-suite.ts  # Eval-suite kind handler
│   ├── runners/                 # Engine reuse beyond chat
│   │   ├── run-workflow-ai-turn.ts
│   │   └── run-structured-output-pass.ts
│   ├── session-title.ts         # Auto-generate session titles
│   ├── digests.ts               # Tool digest definitions (pills, card payloads)
│   ├── load-master-settings.ts
│   ├── agents/
│   │   └── agent.ts             # createKopilotAgent — buildMessages + tools
│   ├── blocks/
│   │   ├── block-types.ts       # auxx:* fence type definitions
│   │   ├── snapshot-walker.ts   # Mine entity/thread/task ids out of tool outputs
│   │   ├── extract-link-snapshots.ts  # Capture auxx:// hrefs from final prose
│   │   ├── inject-snapshots.ts        # Embed turn snapshots into final assistant message
│   │   └── transform-for-llm.ts # Render auxx:* fences as numbered text for the LLM view
│   ├── capabilities/
│   │   ├── types.ts             # PageCapability, CapabilityRegistry
│   │   ├── registry.ts          # Capability registration
│   │   ├── create-deps.ts       # Tool dependency injection
│   │   ├── actors/              # list_members, list_groups (global)
│   │   ├── agents-builder/      # Agent/procedure builder tools incl. run_eval_suite,
│   │   │                        # suggest_replies (endsTurn)
│   │   ├── apps/                # Installed-app tools
│   │   ├── entities/            # CRUD + search + history + notes + transcripts (global)
│   │   ├── kb/                  # Knowledge-base authoring tools
│   │   ├── knowledge/           # search_docs, search_knowledge (global)
│   │   ├── kopilot/             # plan_create, plan_update_step (global)
│   │   ├── mail/                # find_threads, reply_to_thread, drafts, tags, … (mail page)
│   │   ├── tasks/               # list_tasks, create_task (global)
│   │   └── workflow/            # Workflow-builder tools
│   └── prompts/
│       ├── build-kopilot-prompt.ts   # Top-level prompt assembler
│       ├── core-runtime-prompt.ts    # Shared runtime preamble
│       ├── agent-persona-prompt.ts / kopilot-master-persona.ts
│       ├── resolve-instruction-references.ts
│       └── sections/                 # Composable prompt sections, branch on surface/audience:
│                                     # job-statement, chat-formatting, house-rules, entity-catalog,
│                                     # integration-catalog, block-catalog, active-refs, approval,
│                                     # toolset-additions, trigger-*, agent-procedure-step, …
│
├── mcp/                         # Client-side MCP server subsystem (Kopilot + agents)
│   ├── capabilities.ts          # createMcpCapabilities — global page capability
│   ├── tool-adapter.ts          # buildMcpAgentTools — MCP tool → AgentToolDefinition
│   ├── tool-schema.ts           # JSON-schema bridging
│   ├── client.ts / auth.ts / call-with-auth-retry.ts  # Connection + 401 reconnect
│   ├── discovery.ts / sync.ts / manage.ts             # Server lifecycle
│   ├── rate-limiter.ts          # Per-turn/org MCP call caps
│   ├── connections/ / templates/ / snippet/
│   └── types.ts                 # CachedMcpServer, MCP types
│
└── ../chat/agent/               # Live customer chat agent (same engine, surface='chat')
    ├── build-chat-engine-config.ts  # Wires surface/audience, MCP, toolsets for visitor chat
    ├── tools/handoff.ts             # Unified handoff tool (pure intent)
    └── handoff.ts                   # flipHandoffState — single post-turn applier

packages/lib/src/agents/
├── client.ts                    # AgentSurface type, ALL_SURFACES
└── toolset-catalog.ts           # Per-surface org toolset catalog (tool scoping)

packages/lib/src/evals/          # Eval framework (suites, grader, mock execution,
                                 # draft/pinned binding, baseline diffing)

apps/web/src/
├── app/api/kopilot/stream/route.ts      # SSE endpoint (+ continuation-surface resolution)
├── server/api/routers/kopilot.ts        # tRPC router (sessions, feedback, prompts)
├── components/kopilot/
│   ├── stores/
│   │   ├── kopilot-store.ts             # Zustand (messages, thinking, streaming)
│   │   ├── task-watch-store.ts          # Async-task watchers (poll + inject notification)
│   │   ├── select-context.ts
│   │   └── select-suggestions.ts
│   ├── hooks/
│   │   ├── use-kopilot-sse.ts           # SSE event consumer
│   │   ├── use-task-watchers.tsx        # Wires task-watch-store into the session
│   │   ├── use-smooth-stream.ts
│   │   ├── use-tool-app-resolver.ts
│   │   ├── use-kopilot-sessions.ts      # Session CRUD
│   │   ├── kopilot-session-cache.ts
│   │   ├── use-prompt-templates.ts
│   │   └── use-prompt-template-mutations.ts
│   ├── context/                         # KopilotContext provider + chip strip
│   ├── suggestions/                     # Slash-command / quick-action suggestions
│   ├── options/
│   ├── styles/                          # kopilot-prose.css (markdown typography)
│   └── ui/
│       ├── kopilot-panel.tsx            # Main container (page mode)
│       ├── kopilot-dock.tsx             # Floating dock mode
│       ├── kopilot-runtime.tsx
│       ├── kopilot-chat.tsx             # Chat surface
│       ├── kopilot-page-shell.tsx
│       ├── kopilot-message-list.tsx
│       ├── kopilot-composer.tsx         # TipTap editor + slash commands
│       ├── kopilot-reply-chip-strip.tsx
│       ├── kopilot-session-list.tsx
│       ├── kopilot-session-picker.tsx
│       ├── kopilot-empty-state.tsx
│       ├── messages/                    # user / assistant / tool message renderers,
│       │                                # thinking-steps, tool-status pills, branch nav,
│       │                                # task-notification-chip, eval-suite-progress
│       ├── blocks/                      # auxx:* fence renderers + approval cards
│       │                                # (incl. table-block, block-card wrapper)
│       ├── pickers/                     # Prompt-template picker
│       └── dialogs/                     # Prompt-template dialogs

packages/database/src/db/schema/
├── ai-agent-session.ts                  # Sessions + messages + domainState (JSONB)
├── ai-message-feedback.ts               # Thumbs up/down per message
├── ai-integration.ts                    # Provider API keys
├── ai-usage.ts                          # Token usage tracking (incl. cache costs, provider type)
├── ai-suggestion.ts                     # Cached suggestions
├── eval-case.ts / eval-run.ts / eval-suite-run.ts  # Eval framework
├── prompt-template.ts                   # Reusable prompt templates
└── prompt-history.ts                    # Prompt audit log
```
