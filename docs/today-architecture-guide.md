# Today Architecture Guide

Today is a daily-triage home tab: a headless AI agent watches CRM entities
(deals/leads/tickets) that have gone quiet, proposes a bundle of next actions
per entity, and the account owner triages each bundle with a single Yes/No.
Covers the scanner, the headless agent run, the bundle data model, apply-time
execution, and the frontend. Verified against the implementation on
**2026-07-09**. Feature-flagged (`FeatureKey.todayInbox`, default **off**) —
nothing here runs for an org unless the flag is enabled.

Ground-truth plan (matches shipped code closely):
`plans/follow-up/phases/phase-3e-today-ui.md`, with sibling phases
`phase-3a-capture-mode.md` (engine capture mode), `phase-3b-headless-runner.md`,
`phase-3c-suggestion-table.md` (`AiSuggestion` design), `phase-3d-event-triggers.md`
(**not yet built** — see §6), `phase-4-override.md`, `phase-5-spawn.md`,
`phase-6-polish.md` (ranking — **not yet built**, see §3).

---

## 1. The shape in one paragraph

Every 5 minutes a BullMQ scanner (`nextActionStaleScannerJob`) sweeps orgs
with `todayInbox` enabled, finds entities (`deals`/`leads`/`tickets`) whose
activity has gone cold past a per-type threshold, and runs a **headless
kopilot** (`runHeadlessSuggestion`) for each candidate: the same
`AgentEngine`/tool-capability stack as chat, but with no session row, no
human in the loop, and `approvalMode: 'capture'` — read-only tools execute
for real, write tools are recorded instead of run. The model proposes 0..N
actions and a one-line summary; a non-empty proposal is persisted as an
**`AiSuggestion`** bundle (`status: 'FRESH'`). The **Approvals tab** of the
notification panel lists FRESH bundles one row at a time; **Approve** walks
the bundle's actions in dependency order and actually invokes the tools (or
promotes an already-created Draft to a scheduled send); **Dismiss** closes
the bundle with no side effects undone. AI-originated sends get a 5-minute
cancel buffer (`ScheduledMessage.source = 'AI_SUGGESTED'`), surfaced as an
in-row countdown with an `Undo`.

---

## 2. Data model (`packages/database/src/db/schema/`)

| Table | File | Role |
| --- | --- | --- |
| `AiSuggestion` | `ai-suggestion.ts` | One bundle of `ProposedAction[]` per entity per triage cycle. `entityInstanceId`/`entityDefinitionId` (denormalized), `threadId?` (context only), `ownerUserId` (snapshotted at creation — reassignment doesn't re-route), `bundle` (jsonb: `{ actions, summary, modelId, headlessTraceId, computedForLatestMessageId? }`), `actionCount` (denormalized), `computedForActivityAt` (drives FRESH→STALE), `triggerSource` (`'event'\|'stale_scan'\|'manual'\|'override'`), `status` (`FRESH → APPROVED\|PARTIALLY_APPROVED\|REJECTED\|STALE`), `outcomes` (jsonb `ActionOutcome[]`, populated on approve), `decidedById`/`decidedAt`. Partial unique index `(organizationId, entityInstanceId) WHERE status='FRESH'` — enforces **one active bundle per entity**; the scanner relies on the resulting unique-violation as a no-op signal. |
| `SuggestionDismissal` | `suggestion-dismissal.ts` | Per-user, per-entity skip record from Reject/Snooze. `dismissedAtActivity` (entity's `lastActivityAt` at dismissal time) + optional `snoozeUntil`. The scanner's candidate query excludes an entity while `dismissedAtActivity >= entity.lastActivityAt` — so the dismissal naturally expires once new activity lands, independent of `snoozeUntil`. Unique per `(organizationId, userId, entityInstanceId)` — upserted on repeat dismissal. Dismissal is **per-user**, not org-wide. |
| `ScheduledMessage` (extended) | `scheduled-message.ts` | Reused, not a new table. Today-specific columns: `source` (`USER_SCHEDULED\|AI_SUGGESTED\|AUTO_REPLY`), `approvedById` (who clicked Yes), `cancelledAt`/`cancelledById`, `aiSuggestionId` (FK back to the originating bundle). Indexed `(organizationId, source, approvedById, status)` for the pending-sends pill. |
| — | — | No new tables for entity data itself — Today reads `EntityInstance` (+ two new columns, below), `Draft`, and the existing field-value system. |

**`EntityInstance` gained one column**: `lastSuggestionScanAt` — bumped by the
scanner after *every* run regardless of outcome, so a tick never re-evaluates
an entity unless `lastActivityAt` has since advanced past it. This (not a TTL
on suggestion rows) is the whole suppression mechanism for "already
considered, nothing to do" — the doc comment on `AiSuggestion` notes NOOP
runs deliberately don't insert a row, keeping the table lean.

---

## 3. The scanner (`packages/lib/src/jobs/approvals/next-action-stale-scanner-job.ts`)

Runs every 5 minutes via BullMQ scheduler. Per enabled org:

1. Resolve the org's default LLM (`getCachedDefaultModel`); skip the org
   entirely if none is configured.
2. For each slug in `SCANNED_ENTITY_SLUGS` (`work-items/stale-defaults.ts` —
   currently `['deals', 'leads', 'tickets']`, hardcoded v1 table, no
   per-template override yet): fetch up to 50 candidates where
   `lastActivityAt` is older than the type's staleness threshold
   (`STALE_AFTER_DAYS`: deals 7, leads 5, tickets 2, default 7),
   `lastSuggestionScanAt IS NULL OR < lastActivityAt`, and no active
   `SuggestionDismissal` covers the current activity — then drops candidates
   currently in a terminal stage (`TERMINAL_STAGES`, read via
   `FieldValueService.batchGetValues` on the resource's `stage` field).
3. Runs `runHeadlessSuggestion` for up to 5 candidates concurrently
   (`RUN_CONCURRENCY`), **always** bumps `lastSuggestionScanAt` on the entity
   afterward (success, failure, or noop alike), and on a non-empty result
   calls `createBundleFromHeadlessRun`.
4. After the org's candidates are processed, `markStaleBundles` bulk-flips
   any `FRESH` bundle whose `computedForActivityAt` now predates the
   entity's current `lastActivityAt` to `STALE` in one UPDATE.

**Ranking is v1-simple**: `listBundles` (§4) just orders by `createdAt`
descending within the requested status filter — the SLA/value/confidence
weighted score described in `phase-6-polish.md` was never built.

---

## 4. Headless agent run (`packages/lib/src/approvals/headless-runner.ts`)

`runHeadlessSuggestion` runs the **same `AgentEngine`** used by chat Kopilot,
wired with a minimal one-shot `AgentDefinition` (`maxIterations: 10`, no
session persistence) instead of the full multi-agent `domain-config.ts`:

- **Tool registry**: entity, knowledge, mail, actor, task, app, and MCP
  capabilities — the same factories chat Kopilot uses (`createEntityCapabilities`
  etc.) — but no KB or workflow-builder tools; scoped to `registry.getTools('mail')`
  (the mail page's tool set, reused as "the general CRM toolset").
- **Prompt**: entity header + field snapshot (`enrichEntitiesWithFieldValues`,
  200-char/field cap) + up to 5 open linked tasks + a sanitized trigger-event
  payload (`sanitizeEventPayloadForLLM` strips raw free-text PII) — assembled
  fresh per run, not from chat history.
- **`approvalMode: 'capture'`** (`agent-framework/capture-mode.ts`,
  `types.ts:816-826`): the tool loop never pauses. A read-only tool executes
  normally. An approval-required write tool calls its `captureMint(args, {localIndex})`
  (if defined) to synthesize a plausible result — typically
  `{ id: 'temp_<n>', ...predictedFields }` — without touching the database,
  and the call is pushed onto `state.capturedActions`; downstream tool calls
  in the same run can reference that `temp_<n>` id, so multi-step plans
  (draft a reply → create a follow-up task referencing it) still chain
  correctly even though nothing durable exists yet.
- **Soft calls** are the one exception: `reply_to_thread`/`start_new_conversation`
  called with `mode: 'draft'` (not `'send'`) run for real during the headless
  pass — they produce a genuine `Draft` row — and are recorded via a thin
  `wrapWithSoftCapture` wrapper as `ranDuringCapture: { output }` rather than
  `predictedOutput`. `mode: 'send'` calls of the same tools go through the
  normal capture path instead (queued, not executed).
- The model ends with `[summary] <text>` or `[noop] <reason>` on its final
  line, parsed by `parseFinalText`; soft actions and captured actions are
  merged (`mergeActions`) into one `localIndex`-ordered `ProposedAction[]`.
- Returns `Result.error` on model/entity failure; **partial bundles are never
  salvaged** — apply-time expects the full action list or nothing.

`ProposedAction` (`approvals/types.ts`) carries exactly one of
`ranDuringCapture` (already happened, apply-time promotes/finalizes it) or
`predictedOutput` (not yet happened, apply-time invokes the real tool) — no
separate `kind` discriminator, callers branch on which field is set.

---

## 5. Apply-time — approving a bundle (`packages/lib/src/approvals/actions-service.ts`)

`approveBundle` is the all-or-nothing execution path, invoked from
`approvals.approve`:

1. **Lock + validate**: load the bundle, reject if not `FRESH`.
2. **Staleness re-check**: if the entity's `lastActivityAt` has advanced past
   `bundle.computedForActivityAt` since it was computed, flip the bundle to
   `STALE` and return a `ConflictError` — the UI shows "Out of date" rather
   than silently acting on context that's no longer true.
3. **Topo-sort** the bundle's actions by their `temp_<n>` dependency graph
   (`temp-id.ts`).
4. **Build one shared `ToolContext` + tool registry** for the whole bundle
   (`buildApprovalToolContext` / `buildKopilotToolMap`) — mirrors the
   headless runner's tool set (entity/knowledge/mail/actor/task/app/MCP),
   but MCP capabilities run non-autonomous here since apply-time is executing
   a plan a human already approved, matching the live-chat pause semantics.
5. **Walk actions in order**:
   - If a prior action this action depends on (via a `temp_<n>` reference in
     its `args`) already failed, mark this one `skipped_dep_rejected` without
     invoking anything.
   - `ranDuringCapture` actions: `applySoftAction` reads the Draft back by id
     and promotes it to a real `ScheduledMessage` — `source: 'AI_SUGGESTED'`,
     `scheduledAt = now + 5min` (`SEND_BUFFER_MS`), `aiSuggestionId` linking
     back to the bundle — then enqueues the send job. Real id substitutes for
     any downstream `temp_<n>` reference.
   - Captured actions: substitute resolved real ids for any `temp_<n>` in
     `args`, look up the tool by name, and call `tool.execute()` for real.
     The tool's own real output supplies any further `temp_<n>` substitution.
6. **Terminal status**: `APPROVED` (all succeeded), `REJECTED` (none
   succeeded), or `PARTIALLY_APPROVED` (mixed) — written to the bundle along
   with the full per-action `outcomes[]` array and `decidedById`/`decidedAt`.
   There is no re-approve-the-remainder path for a partial failure; the doc
   comment is explicit that recovery is "the user waits for the next scanner
   tick."

`rejectBundle` just flips status to `REJECTED` — any Drafts created as soft
actions during the headless run are **not** cleaned up (an open, deferred
question in the plan). `snoozeBundle` does the same plus upserts a
`SuggestionDismissal` row keyed to the entity's current `lastActivityAt`, so
the scanner skips the entity until either activity moves or the snooze
window lapses (whichever is later — see the schema note above).
`cancelPendingSend` cancels a `PENDING` `ScheduledMessage` (writes
`CANCELLED` + best-effort removes the BullMQ job — the send job re-checks
status at fire time regardless, so a failed removal is harmless), and
returns a distinguishable `ConflictError('send_in_flight')` if the send has
already flipped to `PROCESSING`.

---

## 6. Backend surface & known gaps

### tRPC (`apps/web/src/server/api/routers/approvals.ts` — `approvalsRouter`)
Deliberately separate from the pre-existing workflow `approvalRouter` to
avoid name collisions as the two evolve independently.

| Procedure | Purpose |
| --- | --- |
| `list` | Paginated bundles (`ownerScope`: `mine`\|`mine_and_unassigned`\|`all`; default status filter `['FRESH']`; cursor = base64 `createdAt\|id`). |
| `get` | Single bundle by id. |
| `approve` | Runs `approveBundle`; maps `ConflictError` → tRPC `CONFLICT`. |
| `reject` | Runs `rejectBundle`. |
| `snooze` | Runs `snoozeBundle`. |
| `cancelPendingSend` | Runs `cancelPendingSend`. |
| `listPending` | `ScheduledMessage` rows where `source='AI_SUGGESTED', status='PENDING'`, optionally scoped to the caller (`mineOnly`, default true). |

### Known gaps vs. the plan epic
- **`phase-3d-event-triggers.md` (reactive triggers) was never built.** The
  scanner (`triggerSource: 'stale_scan'`) is the only thing that calls
  `runHeadlessSuggestion` today — `'event'` and `'manual'` are valid
  `triggerSource` values in the type system but nothing produces them yet.
  Bundles are compute-on-a-5-minute-poll only, not reactive to inbound
  messages.
- **`phase-6-polish.md`'s ranking model was never built** — `listBundles`
  is recency-sorted, not the planned SLA/value/confidence score.
- **Snooze has no frontend affordance** — the mutation and schema support
  exist, but `BundleCard` (§7) only renders Yes/No; there's no snooze UI
  wired up yet.
- **Reject doesn't clean up soft-tool side effects** — a Draft created
  during headless capture survives a Reject and sits in the org's normal
  Drafts tab (explicitly deferred, not a bug).

---

## 7. Frontend (`apps/web/src/components/global/notifications/`)

There is no Today page. `/app/today`, `/app/today/pending`, and
`components/today/` were deleted; triage lives in the **Approvals tab** of
the notification side panel. See `plans/today/` for the rationale.

### The tab (`ui/approvals-tab.tsx`)
Third item in the panel's `RadioTab` (All / Unread / Approvals). It reads
its two source tables directly — **no `Notification` rows are minted for
bundles** — and renders two sections:

- **Needs a decision** — `approval.getPendingRequests` (workflow human
  confirmations). Not feature-flagged, unpaginated, sorted `expiresAt` asc
  nulls last.
- **Suggestions** — `approvals.list` (`mine_and_unassigned`,
  `status: ['FRESH']`, limit 25), cursor-paginated. Gated by
  `useFeatureFlags().hasAccess(FeatureKey.todayInbox)`, which skips the
  query entirely when off.

An empty section is hidden; both empty shows one `Empty` state. Search, the
type filter, and the bulk delete actions are hidden on this tab.

### `SuggestionRow` (`ui/items/suggestion-row.tsx`)
Shows the bundle's `summary` (or a generic "`N` actions" fallback),
Approve/Dismiss pills wired to `approvals.approve`/`approvals.reject`, and
an inline expand listing each `ProposedAction` (`toolName` + `summary`) —
**no per-action edit or partial-approval UI**; Choose-mode was explicitly
cut from v1. A `STALE` bundle disables both actions behind an inline "Out of
date" banner rather than letting the click 409. Approve does not drop the
row: if the chain scheduled a send, the row flips in place to a countdown
with `Undo` (`approvals.cancelPendingSend`); a `send_in_flight` conflict
surfaces as "Send in flight, can't cancel." Snooze
(`approvals.snooze`) and Open record live in the row's overflow menu.

### `ConfirmationRow` (`ui/items/confirmation-row.tsx`)
Absorbs the retired `HumanConfirmationDialog`. Collapsed: workflow name and
`Expires in …`. Expanded (lazily fetches `approval.getApprovalDetails`):
node, message, timestamps, and the decision comment `Textarea`. Approve has
no confirm; **Deny does** — it stops a live run with no undo. A past-expiry
request disables both actions.

Panel state (`open`, `mode`, `highlightApprovalId`) lives in
`notification-panel-store.ts`; `openApprovals(id?)` is how the kbar action
and `APPROVAL` notification rows jump to the tab. Only `width` is persisted.

---

## 8. End-to-end flows

**A deal goes quiet and gets a bundle**
Scanner tick (every 5 min) → deal's `lastActivityAt` older than 7 days and
unscanned since → `runHeadlessSuggestion` runs the CRM toolset in capture
mode against the deal's context → model proposes e.g. a drafted follow-up
email (soft call, real `Draft` created) + a follow-up task (captured,
`temp_1`) → `[summary] Draft check-in, add follow-up task` →
`createBundleFromHeadlessRun` inserts a `FRESH` `AiSuggestion` →
`EntityInstance.lastSuggestionScanAt` bumped either way.

**Owner approves from Today**
`TodayPage` renders the card → click **Yes** → `approvalsRouter.approve` →
staleness re-check passes → topo-sort → soft action promotes the Draft to a
`ScheduledMessage` (send in 5 min, cancellable) → captured action's
`create_task` tool runs for real, referencing the promoted message's id if
chained → bundle marked `APPROVED` with per-action outcomes.

**Owner cancels an AI-drafted send**
`/app/today/pending` shows the countdown row → **Cancel** before the 5-minute
buffer elapses → `ScheduledMessage` flips to `CANCELLED`, BullMQ job removed
(best-effort) → row disappears from the pending list.

**Owner rejects instead**
Click **No** → bundle flips to `REJECTED`, nothing executes; if the reject
came from Snooze, a `SuggestionDismissal` is also written so the scanner
won't re-propose for this entity until activity advances past the snoozed
point.

---

## 9. Key file index

| Concern | Path |
| --- | --- |
| Schema | `packages/database/src/db/schema/{ai-suggestion,suggestion-dismissal,scheduled-message}.ts`, `EntityInstance.lastSuggestionScanAt` |
| Scanner job | `packages/lib/src/jobs/approvals/next-action-stale-scanner-job.ts` |
| Staleness config | `packages/lib/src/work-items/stale-defaults.ts` |
| Headless agent | `packages/lib/src/approvals/headless-runner.ts` |
| Bundle CRUD | `packages/lib/src/approvals/bundle-service.ts` |
| Apply / reject / snooze / cancel | `packages/lib/src/approvals/actions-service.ts` |
| Types | `packages/lib/src/approvals/types.ts` (`ProposedAction`, `ActionOutcome`, `StoredBundle`) |
| Capture-mode engine | `packages/lib/src/ai/agent-framework/capture-mode.ts`, `types.ts` (`approvalMode`, `captureMint`, `capturedActions`) |
| tRPC | `apps/web/src/server/api/routers/approvals.ts` |
| Frontend | `apps/web/src/components/today/` (`today-page.tsx`, `pending-page.tsx`, `bundle-card.tsx`) |
| Routes | `apps/web/src/app/(protected)/app/today/{page.tsx,pending/page.tsx}` |
| Feature flag | `packages/lib/src/permissions/types.ts` (`FeatureKey.todayInbox`) |
| Plans (ground truth) | `plans/follow-up/phases/phase-3{a,b,c,d,e}-*.md`, `phase-4-override.md`, `phase-5-spawn.md`, `phase-6-polish.md` |
