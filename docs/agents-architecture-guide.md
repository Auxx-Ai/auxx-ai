# Agents Architecture Guide

An **Agent** is a user-authored, org-scoped AI worker: a persona (prompt + identity), a
scoped toolset, an optional set of **procedures** (deterministic playbooks), a set of
**triggers** that invoke it, an immutable **permission policy**, and a suite of **evals**
that prove it still behaves.

Agents run on the same engine as Kopilot (`docs/kopilot-architecture-guide.md` — read that
first for the engine, query loop, context store, and tool contract). This guide covers the
layer above it: what an agent *is*, how it's authored and versioned, and how it's proven.

## System at a Glance

```
Authoring (draft)                        Runtime (published)
─────────────────                        ───────────────────
Agent row  ← the draft working copy      AgentVersion (immutable, numbered)
 ├ prompt (Tiptap)                        ├ prompt / toolsets / knowledge
 ├ toolsets[]      ─ mention reconciler   ├ appAccounts / toolRestrictions / modelId
 ├ knowledge[]     ─┘ (prompt+procedure)  └ permissionPolicy  ← resolved + author-clamped
 ├ appAccounts / toolRestrictions               │
 ├ modelId, permissionProfileId                 │ Agent.activeVersionId
 └ config (name/color/icon) ─ User mirror       ▼
        │  publish ──────────────────────►  org cache (`agents`)
        │  ◄──────────────────── discard          │
        ▼                                         ▼
   AgentProcedure ──► Procedure ──► ProcedureVersion (draft = null, 1..N published + compiled)
                                                   │
        Trigger fires (scheduled│event│app│mention│assignment│dm│webhook)
                                                   ▼
              resolveAgentRunCapabilities  = policy ∩ run-as ∩ invoker
                                                   ▼
              buildEffectiveAgentRuntime (tools, bindings, model, capabilities)
                                                   ▼
              runProcedureTurn:  select ──► prepareTurn ──► AgentEngine loop ──► interpretSignal
                                   │           │                 │                    │
                          classifier call   walk to an     tool calls +        advance / await /
                          over whenToUse    instruction    control tools       digress / end / handoff
                                                   ▼
                                        reply · CRM writes · handoff

Evals ── EvalCase ──► EvalSuiteRun ──► EvalRun (definitionSnapshot + runtimeSnapshot)
             │                              │
        assertions                    simulation: LLM persona ↔ agent, tools mocked
             └────────────────────► grader → passed | failed | error → suite diff
```

## The Agent Row

`Agent` (`packages/database/src/db/schema/agent.ts`) is one row per agent, backed by a
synthetic `User` (`userType = 'AGENT'`) so an agent can author, be assigned, be mentioned,
and be attributed like a member.

- **`kind`** — `'internal'` (Kopilot / triggers / autonomous, admin-facing) or `'chat'`
  (visitor-facing, filtered toolset, carries a `Subject` on every tool call). Chosen at
  creation, **immutable** thereafter.
- **`userId` is nullable.** A mid-build draft has no `User` yet; `completeAgentSetup`
  materializes it, mirrors `name`/`avatarAssetId` onto it, and publishes v1 in the same
  transaction. Until then `Agent.config` (`name`, `avatarAssetId`, `color`, `iconId`) is the
  only home for identity. Read priority for User-owned fields: `User.<field> ??
  Agent.config.<field> ?? null`.
- **`setupCompletedAt`** flips the rail UI from the chat-driven setup carousel to the
  Prompt / Tools / Knowledge / Triggers tabs.
- **`mentionable`**, **`archivedAt`**, **`slug`** (unique per org) round out lifecycle.

### Behavior fields (the versioned six)

`prompt`, `toolsets`, `knowledge`, `appAccounts`, `toolRestrictions`, `modelId`. Everything
else — identity, lifecycle, the draft profile binding, `AgentProcedure` links, `AgentTrigger`
rows — is deliberately **not** versioned.

`toolsets[]` entries carry `{ slug, appInstallationId?, config, enabled, source, mentions? }`
where `source` is pure provenance (`manual | mention | auto_default`) and `mentions[]` is the
lock state (a non-empty list forces `enabled: true` and freezes the target in the UI).
`config.enabledTools` is the per-tool allow-list for implicit toolsets.

`knowledge[]` entries are `{ recordId, mode, source, mentionedBy? }` with `recordId` prefixed
`kb` / `article` / `dataset` (bare `kb` or `dataset` = definition-level "all of these") and
`mode` ∈ `include_descendants | include_one | exclude`.

## Draft vs Published

**The `Agent` row IS the draft.** There is no `draftVersionId` — autosave, the toolset /
scope / bindings services, and the Kopilot builder tools all write the row live.
`AgentVersion` holds immutable numbered snapshots; `Agent.activeVersionId` points at what
production runs, and `hasUnpublishedChanges` tracks divergence (set by behavior mutations
only — identity edits and the mention reconciler never set it).

| Path | Behavior source | Authorization source |
| --- | --- | --- |
| Production run, queued run, **pinned** eval | active `AgentVersion` (via org cache) | that version's `permissionPolicy` |
| Builder Chat tab, **draft** eval run | live `Agent` row (`agentConfigSource: 'draft'`) | live `Agent.permissionProfileId` |

The two must always be chosen together — `resolveAgentConfig({ source })` and
`resolveAgentRunCapabilities({ source })` are paired, so behavior and authority come from
the same view.

`configHash` is a stable hash of the six behavior fields **plus the authorization-only
projection** of the policy (audit metadata excluded), which makes a no-op republish a real
no-op while still minting a version when a re-clamp actually bites.

**Two documented immutability exceptions** on a published version: the procedure mention
reconciler amends derived (`source: 'mention'`) toolset/knowledge rows in place and
recomputes `configHash`; and `label` is editable via `agent.renameVersion`.

## Persona

The persona is the agent's identity slot in an otherwise shared system prompt. It is *not* a
separate prompt — `buildAgentPersonaPrompt` emits `You are <name>. <description>` plus the
author-authored body, and it renders as one section inside the shared registry
(`prompts/sections/registry.ts`).

Ordering matters and is enforced. Sections are grouped static → org → turn
(`validateStabilityOrder` throws otherwise) so prompt-cache breakpoints land on tier
boundaries. `houseRules` is the **last tier-1 section**, deliberately placed after the job
statement and before the persona so author-written guards stack *on top of* the house rules
rather than replacing them.

- **Surface** (`internal | chat | email | builder`) picks the rendering medium — `builder`
  emits `auxx:*` reference fences, `chat`/`email` emit plain text.
- **Audience** (`member | customer`) picks the voice — customer-facing runs swap the
  job-statement and house rules.
- Both are derived at the entry point (a `customer_message` trigger ⇒ `customer`), never
  read off `Agent.kind`. A chat-kind agent *serves* a customer; audience is still computed.

### Mention chips are the authoring surface

The prompt is a Tiptap doc. `@[tool:<name>]`, `@[toolset:<slug>]`, and record chips inside it
**enable** the thing they point at: `reconcilePromptMentions` (client, on the autosave fast
path) and the same functions server-side on flush write `mentions[]` locks onto the matching
toolset/knowledge entries. Attached procedure docs reconcile independently
(`MentionSource = 'prompt' | 'procedure'`), so the hot prompt path never reads procedures.
When the last mention covering a target disappears, the reconciler-private
`config.mentionOverrides` pre-image restores what the mention overrode.

New agents seed only the built-in `Auxx.ai` default toolsets (`resolveDefaultToolsets`);
installed third-party app toolsets are never auto-added.

## Procedures

A procedure is a deterministic, branching playbook the agent executes step by step — the
opposite end of the spectrum from free-form persona mode. Procedures are org-scoped and
reusable: `Procedure` (defaults) ← `ProcedureVersion` (draft = `versionNumber: null`, edited
in place; `1..N` published with a `compiled` step tree) → `AgentProcedure` (M:N link with
`enabled`, `priority`, and per-agent `whenToUse` / `triggerExamples` / `ruleset` overrides).

### Compiled shape

`compileProcedure` turns the authored Tiptap doc into a flat `CompiledProcedure`:

- **`instruction`** — the only step the agent *rests* on. Inline `@[tool:…]` ops are hints
  the model acts on inside the engine loop; a result binds to a declared local attribute.
- **`code`** — its own deterministic step. The stepper walks *through* it (runs the block,
  writes `result[name]` → `var:<name>`, advances to `next`, never rests), which is why a
  resume can't re-fire it. `main(inputs)` gets an ambient `{ vars, subject }` bag.
- **`condition`** — `structured` mode evaluates a `ConditionGroup` via `evaluateConditions`;
  `text` mode classifies the conversation against compiled predicate strings. Both branch
  through real `thenStep` / `elseStep` bodies.
- **`routing`** — `finished` / `handoff` (terminal), `call` (local sub-procedure, same
  version, returns to `next`), `switch` (replace the frame with another Procedure, no
  return).

`localAttributes` are the *only* way a tool or code result becomes addressable in procedure
logic — `tool:<name>` is deliberately not readable from a procedure (latest-wins is ambiguous
when a tool runs twice). Each compiles to a `var:<name>` scoped by `procedureVersionId`, so a
local sub-procedure shares the namespace and a cross-procedure push gets its own.

### Selection

`selectProcedure` runs once per turn, in this order — every layer before the classifier is
free:

1. **Sticky resume** — an unfinished top frame resumes; no classifier call at all.
2. **Zero-procedure short-circuit** — no usable candidate (`enabled`, non-empty `whenToUse`)
   ⇒ free-form persona mode, no LLM call, no regression for agents without procedures.
3. **Deterministic ruleset pre-filter** over the resolved `ruleset`, sorted by `priority`.
4. **One classifier call** among survivors, few-shot over `whenToUse` + `use`/`avoid`
   `triggerExamples`.
5. **Frame 0**, pinning `activeVersion.id`.

Criteria are read off the **active version's snapshot**, not the mutable `Procedure` row, so
unpublished edits never reach a live run. The frame pins a `procedureVersionId` for the whole
run — a mid-run republish or revert cannot disturb an in-flight conversation.

### Stepper and control tools

`prepareTurn` walks the cursor through deterministic steps until it lands on an `instruction`
to inject (or the stack empties). `interpretSignal` runs post-turn and reads the signal the
model recorded.

The four control tools (`agents/procedures/control-tools.ts`, category `control`) write into
the shared context store at `var:__proc_signal` rather than mutating the stack:

| Tool | Meaning |
| --- | --- |
| `advance_procedure` | this step is done — move on |
| `await_customer` | need more from the customer before this step completes |
| `digress` | the ask isn't covered here; route it (don't answer it yourself) |
| `end_procedure` | the whole procedure is finished |

`handoff` is **not** a control tool — the unified `handoff` tool writes a `{ kind: 'handoff' }`
signal and a single post-turn applier (`flipHandoffState`) does the thread flip, so chat and
procedure agents share one tool and one flip site.

Two guardrails sit around the model's judgment: `advance` is verified by `goalMetCheck` (the
one irreversible signal — did the reply actually meet the step's goal?), and a silent reply
with no control tool goes through `backstopClassify` (did it stay on the active step?). The
stack is depth-capped (`MAX_DEPTH`).

Control tools are mounted only when the agent has procedures (`hasProcedures`); they're inert
without an active step.

## Tool Calls

An agent never gets every registered tool. The chain, in order:

```
org catalog (apps + built-ins + MCP servers)
   → surface filter        (tool.surfaces ?? ALL_SURFACES ∋ surface)
   → agent toolsets        (allow-list by slug; config.enabledTools per tool, fail-closed)
   → capability registry   (page-scoped + global capabilities, tool deps injected)
   → binding projection    (author-default inputBindings ?? per-agent override)
   → wrapTools seam        (evals only — mock resolver)
   → AgentEngine
```

`buildEffectiveAgentRuntime` (`ai/agent-framework/effective-runtime.ts`) is the single
construction site for all of it — production, builder, chat, and the eval simulation all
build the agent through it, so there is no divergent second copy.

**Catalog.** `getOrgCatalogTree` produces a recursive `CatalogNode` tree: app → sub-group →
toolset → tool. Tools are first-class nodes. **Explicit** toolsets are atomic authored
bundles (one row, no per-tool UI); **implicit** ones (`app:<appId>` for an app's ungrouped
tools, `mcp:<serverId>`) are per-tool selectable. Registered names are the join key
everywhere — `getRegisteredToolName(appSlug, id)` for app tools, `mcp__<server>__<tool>`
(hash-suffixed past 60 chars, computed identically client and server) for MCP.

**Bindings** (`agents/bindings/`) wire a tool input to a context source: `{ kind: 'var' |
'const' | 'model' }`. Each tool ships author-default `inputBindings`; `Agent.toolRestrictions`
holds only deliberate admin overrides (usually empty). Effective = `override ??
author-default`, resolved per turn and clamped onto the args before `execute`.

**App accounts.** `Agent.appAccounts` pins the agent's execution to a specific `Credential`
per app id. An app with no pin contributes no tools to that session.

**Approval.** `requiresApproval` (boolean or arg predicate) pauses the loop for a HITL card.
MCP write tools default to requiring approval via `readOnlyHint`/`trusted`; autonomous runs
drop untrusted write tools entirely.

**Categories** drive visibility, not security: `control` (loop plumbing — hidden from
user-facing lists, exempt from eval mock wrapping), `system` (platform built-ins, collapsed
in the mock editor), `capability` (default). `externalSafe` is advisory metadata that flags a
tool in the chat/email Tools UI. The actual boundary is *adding a toolset to an agent* (an
admin act) plus the permission policy.

## Triggers and Runtimes

`AgentTrigger` is one row per trigger with hot routing columns mirrored from `Workflow`
(indexed per kind) and a kind-specific JSONB `config` tail. Each trigger carries an optional
`instructions` addendum layered on the agent's base prompt at run time, plus
`lastFiredAt` / `lastErrorAt` / `lastError` for the list view.

| Kind | Fires on |
| --- | --- |
| `scheduled` | cron / interval (BullMQ job scheduler, `scheduledTriggerQueue`) |
| `event` | CRUD (`entityDefinitionId` + `created\|updated\|deleted`) or a direct event type from `ALLOWED_DIRECT_EVENT_TYPES` |
| `app` | an installed app's declared trigger, optionally connection-scoped, optionally polled |
| `webhook-endpoint` | inbound delivery to a `WebhookEndpoint` + topic |
| `mention` | the agent is referenced in a comment |
| `assignment` | the agent is assigned to a ticket |
| `dm` | a member direct-messages the agent |

Runtimes that drive the same agent definition:

- **`ai-agent-worker`** → `processAgentMessage` — internal/autonomous runs, SSE-relayed via
  Redis.
- **`chat-agent-worker`** → `buildChatEngineConfig` — visitor chat, `surface: 'chat'`,
  `audience: 'customer'`, chat-surface tool filter, `Subject` on every tool call.
- **Workflow AI node** → `run-workflow-ai-turn.ts`.
- **`eval-run-worker`** → the simulation executor (below).

## Permissions

An agent's authority is an **immutable snapshot**, not a live lookup.

`AgentVersion.permissionPolicy` (`PublishedAgentPermissionPolicy`) is resolved at publish
from the draft `Agent.permissionProfileId` and then **clamped by the publishing human's own
effective capabilities**. It is total: every keyspace (`areas`, `definitions` keyed by
`apiSlug`, `resources` by type → instance) carries an explicit `default`, so a lookup always
returns exactly one of `none | view | edit | admin` — including for definitions created after
publication. `clamp[]` records every reduction, so the publish UI can say *"Deals reduced from
Full to Read — you hold Read"* instead of silently downgrading. `sourceProfileId` is audit
metadata, deliberately not an FK: deleting the profile cannot change a running agent.

At run time, `resolveAgentRunCapabilities` composes:

```
effective = publishedPolicy(target)             // the version snapshot — the ceiling
effective = min(effective, runAsUser(target))   // when Agent.runAsUserId is set
effective = min(effective, invoker(target))     // human-triggered runs only
```

Every layer goes through `intersectCapabilities`, so **no source can widen another**. Run-as
is delegation, never replacement — an OWNER delegate cannot widen an agent published as
`None`. The delegate must be an ACTIVE human member or the run **stops**
(`AgentRunAsUnavailableError`, 422) rather than falling back — a silently-widened agent is
worse than a stopped one. Engine identity stays `agent.userId` in every case so audit trails
stay honest.

A set-up agent with no resolvable policy **fails closed** (inert + a loud log), not
unrestricted. Only a pre-setup draft (no backing `User`) legitimately returns `undefined`.

**Knowledge scope is not access control.** `Agent.knowledge` is purely a *retrieval* scope —
which knowledge sources `search_knowledge` and the prompt's Knowledge Catalog look at. `[]`
means org-wide. Entity-record inclusion moved to the permission layer; older version
snapshots may still carry entity rows, so `filterKnowledgeScopeEntries` drops them at read
time.

## Evals

Evals are the regression gate for agent behavior: assertion-graded simulations that run the
**real** agent loop with mocked tools and a synthetic customer.

### Data model

- **`EvalCase`** — reusable definition: `kind` (`agent_simulation` today; `workflow` /
  `recorded_ticket` reserved), an explicit validated `target`, a `SimulationConfig`, and
  ≥1 assertion. `agentId` / `procedureId` are denormalized from `target` for indexed listing.
- **`EvalRun`** — one immutable execution. Both `definitionSnapshot` and `runtimeSnapshot`
  are written at `queued` insert and never change, so historical detail renders without
  joining the mutable case. `snapshotHash` is the canonical hash of both. Deleting a case
  keeps its runs (`caseId` → null).
- **`EvalSuiteRun`** — parent of a `runAll` batch. Its `status` describes **orchestration**,
  not pass/fail: `completed` once every child is terminal, regardless of verdicts.
  `selectionSnapshot` records the exact ordered case ids so the batch is reproducible.

**Targets** are explicit, never a generic `targetId`:

```ts
{ kind: 'agent_simulation', scope: 'procedure', agentId, procedureId, procedureVersionId }
{ kind: 'agent_simulation', scope: 'agent',     agentId }   // persona + procedure selection
```

**Run mode**: `pinned` (the case's pinned `procedureVersionId` — regression-gate semantics) or
`draft` (the attached draft compiled in memory at prepare time — the iteration loop).
Denormalized onto both `EvalRun.runMode` and `EvalSuiteRun.runMode`.

### The simulation

`runAgentSimulation` drives the **same** loop production uses — selection → stepper → engine
drain — reconstructed from the immutable runtime snapshot:

- Tools are **mock-wrapped fail-closed**. An unmatched call errors the run
  (`UNMATCHED_MOCK`) unless `unmatchedToolPolicy: 'passthrough_readonly'` lets an idempotent
  tool run for real — which marks the run `nonOffline`. No CRM writes, ever.
- The framework clock is frozen (`timeFrozenAt`); `startingFields` overlay the field
  resolver; `subject` carries `recordIds`, `identityVerified`, and a curated `claimed`
  identity.
- `LlmPersonaConversationSource` is the customer: `openingMessage` verbatim on turn 1, then
  generated turns from the redacted visible conversation. It stops on a terminal outcome, on
  its own `done`, or at `maxCustomerTurns`.
- A stepper observer yields explicit terminal outcomes and the selected procedure.
- `verifyRuntimeAgainstSnapshot` catches drift (`SNAPSHOT_INCOMPATIBLE`) — a tool whose
  schema digest changed under a pinned run is a loud failure, not a silent pass.

### Assertions and grading

| Assertion | Graded |
| --- | --- |
| `terminal_outcome` | deterministic — `finished` / `handoff` / `switch` |
| `procedure_selected` | deterministic — agent-scope only |
| `tool_called` / `tool_not_called` | deterministic — name + optional `exact`/`subset` arg match |
| `crm_field` | deterministic — `FieldReference` + comparator against the final resolver |
| `local_variable` | deterministic — procedure `var:<name>` + comparator |
| `response_criteria` | **judged** — one utility-model call per criterion, over the visible prose |

Roll-up: all passed → `passed`; ran and ≥1 failed → `failed`; couldn't complete → `error`.
The distinction is load-bearing — a failed or unparseable judge call makes the assertion
`error`, never a silent `failed`, and an executor error (`UNMATCHED_MOCK`, `TURN_CAP_EXCEEDED`,
`SNAPSHOT_INCOMPATIBLE`, `MODEL_ERROR`, `TIMED_OUT`, …) forces the run to `error` even if the
surviving assertions happened to pass.

### The improvement loop

`compareSuiteRuns` diffs two terminal suites over the same case set into buckets —
`fixed` / `regressed` / `still_failing` / `still_passing` / `incomparable` / `uncompared` —
with a `flipDriver` per flip (`deterministic` = signal, `judge` = possible noise, `mixed`),
plus `passRateDelta` and a `judgeOnlyFlips` caveat count. Nothing here is persisted; it's
computed on read.

`suggestAgentSimulations` proposes cases from a procedure's text. The whole loop is reachable
from Kopilot: `run_eval_suite` fires the suite and returns immediately with a
`taskNotification`, the client watches it, and a `<task-notification>` message opens a new
turn with the outcome (`create_eval_case`, `get_eval_run`, `get_suite_diff`,
`update_eval_case_mock` complete the set).

The worker (`eval-run-worker`) claims, heartbeats, checkpoints the trace incrementally,
publishes progress, and a watchdog marks stale runs `timed_out` — the `EvalRun` row owns
lifecycle state, BullMQ retention is not run history.

## Key Design Decisions

- **The draft is the row; publishing is the snapshot.** No `draftVersionId`, no shadow copy.
  Every authoring surface writes the live row, and exactly one act (publish) moves production.
- **Authorization is versioned alongside behavior.** A tool without permission is denied and
  permission without a tool does nothing — so both live on the same immutable version, and
  neither can drift from the other.
- **The publish-time author clamp is the only bound on an autonomous run.** There is no
  invoker to intersect with when a schedule fires, which is why the clamp exists at publish
  and is recorded rather than applied silently.
- **Selection spends the cheap layers first.** Sticky resume, zero-procedure short-circuit,
  and deterministic ruleset filtering all run before the single classifier call.
- **Frames pin versions.** A running conversation reads the exact `ProcedureVersion` it
  started on; republish and revert are invisible to it.
- **Control tools record intent; appliers change state.** The stack lives in `domainState`
  and the handoff flip happens in one post-turn site — so tools stay pure signals.
- **The stepper is pure navigation except for `code`.** That one exception is safe only
  because the walk never rests on a code step, so resume re-enters behind it.
- **Mentions are authoring, not configuration.** Typing `@[tool:…]` in a prompt enables the
  tool; the reconciler keeps a pre-image so removing the mention restores what it overrode.
- **One construction site.** `buildEffectiveAgentRuntime` builds production, builder, chat,
  and simulation runtimes; the eval-only `wrapTools` seam is the single divergence, and it
  preserves name / parameters / schema digest so clamps stay invariant.
- **Evals fail closed and distinguish `error` from `failed`.** Mocks are fail-closed, snapshot
  drift is loud, and a broken judge never masquerades as a verdict.
- **Suite status is orchestration, not verdict.** `completed` means every child finished;
  pass rates come from counters and the diff.

## File Map

```
packages/database/src/db/schema/
├── agent.ts                     # Agent row: kind, behavior fields, ToolsetEntry, KnowledgeEntry,
│                                # AppAccountBinding, AgentToolBindings, AgentConfig, runAsUserId
├── agent-version.ts             # Immutable numbered snapshot + PublishedAgentPermissionPolicy + clamp
├── agent-trigger.ts             # Per-agent triggers (hot routing columns + kind-specific config)
├── agent-procedure.ts           # Agent ↔ Procedure M:N + per-agent criteria overrides
├── procedure.ts                 # Procedure defaults + draft/active version pointers
├── procedure-version.ts         # Draft (null) + published (1..N) versions, `compiled` tree
├── eval-case.ts / eval-run.ts / eval-suite-run.ts
└── ai-agent-session.ts          # Sessions + messages + domainState (shared with Kopilot)

packages/lib/src/agents/
├── agent-service.ts             # create/update/archive/delete, completeAgentSetup, detail+list
├── agent-version-service.ts     # publishAgent(Tx), discardAgentDraft, restore/rename, listVersions
├── agent-config-snapshot.ts     # The versioned six + hashAgentConfig (authorization-only policy)
├── agent-permission-policy.ts   # Draft policy resolve, version policy read, publish clamp
├── agent-scope-service.ts       # Knowledge-scope row CRUD
├── agent-toolset-service.ts     # Toolset enable/disable + per-tool allow-lists
├── agent-trigger-service.ts     # Trigger kinds, BullMQ schedulers, recordError
├── agent-trigger-queries.ts     # matchesFilter (event/app dispatch)
├── resolve-agent-config.ts      # ResolvedAgentConfig — active vs draft view
├── resolve-knowledge-scope.ts   # knowledge[] → concrete datasets/articles
├── knowledge-scope.ts           # kb/article/dataset prefixes, read-time filtering
├── toolset-catalog.ts           # Org catalog tree + flat projections (apps + built-ins + MCP)
├── builtin-app.ts / default-toolsets.ts   # The synthetic `Auxx.ai` app + seed toolsets
├── filter-tools.ts              # Runtime toolset/allow-list filter (client mirror in client.ts)
├── tool-visibility.ts           # category → visibility policy (shared client/server)
├── prompt-mention-reconciler.ts # Prompt/procedure chips → toolset + knowledge locks
├── set-tool-restrictions.ts     # Per-agent binding overrides
├── bindings/                    # VarSource model: resolve, effective (override ?? default), apply
├── templates/                   # Starter agent templates (support-triage, refund-handler, …)
├── procedures/
│   ├── types.ts                 # CompiledProcedure, ProcedureStep, LocalAttribute, frames/stack
│   ├── compile.ts               # Tiptap doc → compiled step tree (+ CompileError[])
│   ├── nodes.ts                 # Tiptap node types, step badges, code bindings
│   ├── select.ts                # selectProcedure — sticky → prefilter → classifier → frame 0
│   ├── classify.ts / classifier.ts  # Procedure classifier, text-branch, goalMet, backstop
│   ├── stepper.ts               # prepareTurn / interpretSignal — the deterministic walk
│   ├── stack.ts                 # push/pop/replace/clear, MAX_DEPTH
│   ├── control-tools.ts         # advance / await / digress / end + PROC_SIGNAL_KEY
│   ├── turn-wiring.ts           # cache → candidates, selection → stack, StepperDeps, runProcedureTurn
│   ├── context.ts               # scopedVar, procedure field/predicate resolvers, code inputs
│   ├── persist.ts               # domainState procedure slice
│   ├── queries.ts               # Procedure/version/link CRUD, publish/revert, readCompiled
│   ├── mention-reconcile.ts     # Procedure-doc mentions → agent toolsets/knowledge
│   ├── observer.ts              # Eval-only transition observer
│   └── authoring/               # Builder-facing procedure summaries
└── client.ts                    # Client-safe: AgentSurface, catalog nodes, filters, mcpToolName

packages/lib/src/ai/agent-framework/
├── effective-runtime.ts         # THE construction site (tools, bindings, model, capabilities)
├── agent-run-capabilities.ts    # policy ∩ run-as ∩ invoker; AgentRunAsUnavailableError
├── process-agent-job.ts         # BullMQ handler for internal/autonomous runs
├── enqueue-agent-job.ts / engine.ts / query-loop.ts / types.ts   # (see kopilot guide)
└── context/                     # ctx.context store (vars, captured calls)

packages/lib/src/ai/kopilot/
├── prompts/agent-persona-prompt.ts        # `You are <name>.` + author body
├── prompts/sections/registry.ts           # Ordered sections, stability tiers
├── prompts/sections/agent-persona.ts / agent-procedure-step.ts / trigger-*.ts
└── capabilities/agents-builder/           # Builder tools + builder persona
    ├── persona-prompt.ts                  # Shared `## Procedures` authoring section
    └── tools/                             # set_agent_prompt, set_agent_toolsets,
                                           # set_agent_resource_scope, set_agent_triggers,
                                           # update_agent_identity, complete_agent_setup,
                                           # procedure_create/read/set_body/update_criteria,
                                           # create_eval_case, run_eval_suite, get_suite_diff,
                                           # get_eval_run, update_eval_case_mock, suggest_replies

packages/lib/src/chat/agent/
├── build-chat-engine-config.ts  # Visitor-chat runtime (surface='chat', audience='customer')
├── tools/handoff.ts             # Unified handoff tool (pure intent)
└── handoff.ts                   # flipHandoffState — single post-turn applier

packages/lib/src/evals/
├── simulation/executor.ts       # runAgentSimulation — the real loop, mocked
├── simulation/persona.ts        # LlmPersonaConversationSource (the synthetic customer)
├── simulation/mock-tools.ts     # wrapToolsWithMocks, fail-closed matching, passthrough_readonly
├── simulation/field-resolver.ts # startingFields overlay + subject resolution
├── simulation/customer-envelope.ts
├── agent-grader.ts              # Deterministic assertions + response judge, roll-up
├── comparators.ts / validate.ts / authoring.ts / editor-support.ts
├── snapshots.ts                 # definitionSnapshot, canonicalize, stableHash, stripSecrets
├── runtime-snapshot.ts          # Build/verify runtime snapshot, tool manifest + schema digests
├── prepare-run.ts / lifecycle.ts / queries.ts / start-suite-run.ts
├── diff.ts                      # compareSuiteRuns — buckets, flipDriver, passRateDelta
├── suggestions.ts / tool-examples.ts / model-summary.ts
└── worker/                      # enqueue, process-eval-run, publisher, watchdog, run-log

packages/types/evals/
├── index.ts                     # Persisted contracts: targets, assertions, SimulationConfig,
│                                # trace, AssertionResult, suite diff
└── schema.ts                    # Zod parsers for every JSONB boundary

apps/web/src/
├── app/(protected)/app/agents/            # Agent routes
├── server/api/routers/                    # agent, agent-toolset, agent-scope, agent-trigger,
│                                          # agent-procedure, procedure, eval, kopilot
└── components/
    ├── agents/hooks/                      # use-agent(-s), autosave, mutations, realtime,
    │                                      # access, permission-profiles, tool-catalog
    ├── agents/ui/list/                    # grid, card, search, bulk bar, create, apply-profile
    ├── agents/ui/detail/                  # tabs, hero, publish cluster, versions dialog, docked chat
    │   ├── prompt/ tools/ knowledge/ triggers/ bindings/ permissions/ setup/
    ├── agents/procedures/                 # editor, nodes (condition blocks), publish, versions
    └── evals/                             # simulations tab, case drawer, assertions, trace view,
                                           # suite panel/history/diff, suggestions, run detail

packages/lib/src/jobs/agent/        # Trigger → agent-job dispatchers
├── scheduled-trigger-job.ts / event-trigger-job.ts
├── app-trigger-dispatch-job.ts / app-trigger-job.ts
├── mention-trigger-job.ts / assignment-trigger-job.ts
└── webhook-endpoint-dispatch-job.ts
packages/lib/src/events/handlers/trigger-agents.ts   # Entity events → event-trigger dispatch

apps/worker/src/workers/worker-definitions/
├── ai-agent-worker.ts           # Internal/autonomous agent runs (processAgentMessage)
├── chat-agent-worker.ts         # Visitor chat runs
├── eval-run-worker.ts           # Eval simulation runs
└── scheduled-trigger-worker.ts / polling-trigger-worker.ts / app-trigger-worker.ts
```

## Related Guides

- `docs/kopilot-architecture-guide.md` — the engine, query loop, context store, tool contract
- `docs/entity-events-architecture-guide.md` — the events that back `event` triggers
- `docs/knowledge-base-architecture-guide.md` / `docs/knowledge-sources-architecture-guide.md`
- `docs/ui-design-guide.md` — the primitives the agent/eval UI is built from
- `docs/lib-module-guide.md` — conventions for new `packages/lib` modules
