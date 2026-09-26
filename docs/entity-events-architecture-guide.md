# Entity Events & Record Rules Architecture Guide

**Last Updated:** 2026-09-21
**Scope:** The reactive layer over the entity system — how "when a record/field changes, do
something" works end-to-end: the **record-rules engine**, its dispatch **doors** (interactive
writes, record lifecycle, and connector/import syncs), the **B2 sync-change manifest** that makes
`skipEvents` sync writes visible, and the **system-rule** unification that folded the old
compile-time `FIELD_TRIGGERS` / `ENTITY_TRIGGERS` onto the same engine.

> This is the living reference for the events/record-rules subsystem. It supersedes the design
> and progress docs under `plans/events/` (`dynamic-field-rules-and-sync-events-plan.md`,
> `b2-sync-change-manifest-plan.md`, `b2-progress.md`, `b2-phase9-*`, `record-rules-settings-ui-plan.md`),
> which are decision/implementation history and can be deleted once this guide is trusted.
> Companion to `entity-architecture-guide.md` (the data model this reacts to) and
> `data-connectors-architecture-guide.md` (the sync path that produces the manifest).

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Core Concepts & Vocabulary](#2-core-concepts--vocabulary)
3. [The Rule Model](#3-the-rule-model)
4. [Conditions & Transitions](#4-conditions--transitions)
5. [Actions](#5-actions)
6. [The Engine](#6-the-engine)
7. [Dispatch Doors](#7-dispatch-doors)
   - [7.1 The payload shape each door hands over](#71-the-payload-shape-each-door-hands-over)
   - [7.2 The three write lanes and the hook chain](#72-the-three-write-lanes-and-the-hook-chain)
8. [The Sync-Change Manifest (B2)](#8-the-sync-change-manifest-b2)
9. [System Rules (the trigger unification)](#9-system-rules-the-trigger-unification)
10. [Cache & Invalidation](#10-cache--invalidation)
11. [tRPC & UI Surface](#11-trpc--ui-surface)
12. [End-to-End Flows](#12-end-to-end-flows)
13. [Gotchas & Invariants](#13-gotchas--invariants)
14. [Key Files](#14-key-files)

---

## 1. Executive Overview

A **record rule** is: *"when field X changes (or a record is created/deleted), and conditions
hold, run these actions."* One org-configurable engine (`@auxx/lib/record-rules`) evaluates them,
fed by three write sources through a small number of **dispatch doors**, all reducing to one call
path:

```
             WRITE SOURCE                    DOOR                         ENGINE
  ─────────────────────────────   ─────────────────────────   ───────────────────────
  interactive / API field write → '*' field-hook seam        ┐
  interactive bulk (native only) → batched field-trigger door ┤
  record created / deleted (bus)  → entity:created/deleted     ┼─▶ fireRecordRules[Batch]
  connector sync / CSV import     → sync:records:changed       ┘     match → conditions → actions
                                    (the B2 manifest)                 + RecordRuleRun log
```

Three kinds of rule feed the engine, **unioned in the org cache** (`recordRules` key):
1. **DB `RecordRule` rows** — user-defined automations (+ feature-provisioned "managed" rows).
2. **Code-declared system rules** — the manufacturing triggers (BOM cost recalc, stock explosion
   + QoH, company enrichment) that used to be hard-wired registries. Same engine now.
3. *(Planned)* rules **derived from published `FIELD_CHANGED` workflows** — not built.

The hard problem this subsystem solves is **sync-write visibility**: the data-connector sink and
the CSV importer write with `skipEvents: true`, which suppresses the entire per-write fan-out
(field hooks, activity, timeline, the BullMQ event bus, realtime). Without help, nothing reacts to
synced data. **B2** fixes this by accumulating a per-run **change manifest** and publishing **one**
`sync:records:changed` event per run that the engine consumes — storm-proof (O(1) events per sync,
not O(records)). The same manifest replays the **field-change hook chain** at finalize, so derived
fields stay current on synced data too (§7.2).

---

## 2. Core Concepts & Vocabulary

- **Record rule** — a `RecordRule` row (or a code-declared system rule of the same shape). Keyed
  by `entityDefinitionId` + optional `fieldId`.
- **Transition (`on`)** — `changed | increased | decreased | set | cleared` (field rules, need a
  `fieldId`) or `created | deleted` (lifecycle rules, `fieldId = null`). **Direction lives on the
  rule, not in conditions** — the condition evaluator sees one snapshot and can't express old→new.
- **Action** — one of `set-field | enqueue-workflow | notify | native`. Rules carry an **ordered
  array**; failures are continue-and-report (recorded per-action on the run row).
- **Native action** — `{ type: 'native', handler }` invoking a code-registered handler with a
  **batch** signature (`recordIds[]`). **Server-declared only** — never accepted from the tRPC
  router or UI. This is how system rules run the manufacturing trigger functions.
- **Door** — a dispatch site that turns a write into engine calls. Doors are exact complements on
  native vs non-native (see §7).
- **Sync-change manifest** — the per-run accumulation of `{ changed fields (old→new), created,
  archived }` that a bulk writer (connector sink / import job) builds so the engine can react to
  `skipEvents` writes. Published as `sync:records:changed`.
- **System rule** — a rule declared in code (`declareSystemRules`) with a `systemAttribute`/`defSlug`
  ref instead of a stored `fieldId`; resolved to the org's row ids at cache-compute time.
  `isSystem: true`, excluded from the tRPC `list` + UI.
- **Subscription set** — the set of `(def, field)` + lifecycle flags that *some* enabled rule
  watches. The manifest collector only captures writes to subscribed fields (no rules ⇒ the sink
  captures nothing).

---

## 3. The Rule Model

Schema: `packages/database/src/db/schema/record-rule.ts`.

### `RecordRule`
| Column | Notes |
| --- | --- |
| `id`, `organizationId` (cascade), `entityDefinitionId` (cascade) | org-scoped, dies with its def |
| `fieldId` (FK → CustomField, cascade, **nullable**) | the watched field; `null` ⇔ lifecycle rule |
| `name` | |
| `on` (`RecordRuleOn`, default `changed`) | transition selector — see §4 |
| `condition` (jsonb `ConditionGroup[]`, default `[]`) | AND'd groups; empty = always match |
| `actions` (jsonb `RecordRuleAction[]`) | ordered; continue-and-report |
| `enabled` (default true) | |
| `createdByUserId`, `createdAt`, `updatedAt` | |

Indexes: `(organizationId, fieldId)` (field dispatch) and `(organizationId, entityDefinitionId)`
(lifecycle dispatch). **No unique constraint** — N rules per field/def allowed.
**Invariant** (app-level): `fieldId IS NULL ⇔ on ∈ (created, deleted)`.

### `RecordRuleRun` (execution log)
| Column | Notes |
| --- | --- |
| `id`, `organizationId` (cascade) | |
| `ruleId` (**plain text, NO FK**) | system rules are `system:<key>`, not rows — an FK broke every system-rule insert (Bug 3, migration `0258`) |
| `entityInstanceId` (**plain text, NO FK**) | `deleted` rules log runs for records that no longer exist |
| `source` (`interactive | sync`) | which door dispatched |
| `fieldId`, `oldValue`, `newValue` (jsonb) | trigger context; null for lifecycle |
| `outcomes` (jsonb `[{actionIndex, type, status, error?}]`) | per-action results — the answer to action-array failure semantics |
| `status` (`ok | partial | failed`), `firedAt` | |

Runs are pruned nightly by age (60d) — `record-rules/run-retention-job.ts`, wired into the
maintenance worker at 03:45.

### The cached shape
`CachedRecordRule` (`record-rules/types.ts`) is the serializable form in the `recordRules` org
cache: the DB columns plus `isSystem?` (true for code-declared rules unioned in at compute time).
The hot dispatch path reads the cache, never the table.

---

## 4. Conditions & Transitions

**Conditions reuse the existing conditions system** (`@auxx/lib/conditions` — `ConditionGroup[]`,
`evaluateConditions` + operator catalog incl. relationship-path field refs; builder UI
`apps/web/src/components/conditions/ConditionContainer`). Consequences:
- Cross-field / relationship-path conditions come for free (same semantics as table filters and
  workflow nodes).
- `evaluateConditions` is **sync** — the engine builds a record snapshot first; unresolvable refs
  (`FIELD_NOT_RESOLVABLE`) pass, matching filter behavior. `valueSource: 'currentUser'` is a no-op
  (rules fire with no interactive user).

**Transitions live on the rule (`on`), evaluated by `record-rules/transitions.ts`**
(`matchesFieldTransition(on, old, new)`, with numeric coercion for increased/decreased). This is
separate from conditions because the evaluator only sees the *current* snapshot — "decreased" is a
property of the (old, new) pair, not of a single state.

---

## 5. Actions

`RecordRuleAction` union (`record-rules/types.ts`, `actions.ts`):

| Action | Behavior |
| --- | --- |
| `set-field { fieldRef, value }` | write a value onto the triggering record (via `UnifiedCrudHandler` as the system user); skipped on `deleted` |
| `enqueue-workflow { workflowAppId }` | enqueue a published workflow with the record snapshot as trigger payload (superset of an UPDATED trigger's payload) |
| `notify { userIds, message }` | in-app SYSTEM_MESSAGE notification |
| `native { handler }` | invoke a code-registered handler once per fire batch — **server-only** |

**`hasNativeAction(actions)`** is THE routing predicate: a rule is all-native or native-free
(enforced by `store.assertRuleShape` on the DB path and `declareSystemRules` for system rules),
never mixed. The two dispatch doors that handle native vs non-native are exact complements and both
call this predicate so they can't drift. The tRPC `actionSchema` has no `native` variant, so the
public API is doubly blocked from creating native rules.

Native handlers are registered with `registerNativeRuleHandler(key, handler)` and receive a
`NativeRuleHandlerEvent`: `{ recordIds, organizationId, userId?, action?, eventDataByRecordId? }`.
`eventDataByRecordId` carries **raw** create/delete-time values threaded from the dispatching door
(interactive `event.data.eventData`, sync `manifest.createdValues`) — never refetched (a refetch is
wrong for transient flags like `stock_movement_adjust_subparts`).

---

## 6. The Engine

`packages/lib/src/record-rules/engine.ts`. Two entry points, one matcher.

- **`fireRecordRules(rule, ctx)`** — per-record (door 1). Lazy record snapshot via
  `fetchResourceById`, `evaluateConditions`, ordered actions with continue-and-report, best-effort
  `RecordRuleRun` write. Loop guard: **AsyncLocalStorage depth cap 3 + per-chain seen-set** (a rule
  whose action writes a field that carries another rule can't recurse forever).
- **`fireRecordRulesBatch(rules, ctx)`** — the batch API (doors for lifecycle bus + sync manifest +
  bulk interactive). Matches each `{rule, event}` pair (field id + `matchesFieldTransition`, or
  lifecycle when `event.fieldId` is absent), then:
  - **non-native** rules → the existing per-record `fireRecordRules`, grouped by event so a record's
    rules share one snapshot load (batch-of-1 ≡ single);
  - **native** rules → the handler invoked **once across the batch** with `toRecordIds(def, ids)`,
    one `RecordRuleRun` row per record (D11). Unknown handler key ⇒ outcome `failed` + loud log,
    never throws.
- **Self-init:** on the first native-handler **miss**, the engine lazy-imports and runs
  `ensureHooksRegistered()` (the field-hooks bootstrap that registers the native handlers), then
  retries — because the events worker's dispatch path never touches the field-hooks registry
  otherwise (Bug 2). Miss-gated so tests that pre-register handlers never trigger it. Wrapped in
  try/catch (never-throws contract).

The engine **never throws** — every failure degrades to a logged `failed`/`partial` outcome.

---

## 7. Dispatch Doors

There are four dispatch sites, all converging on the engine. They partition cleanly by write kind
and by native vs non-native.

### Door 1 — interactive field writes (non-native)
The global `'*'` `EntityFieldChangeHandler` (`field-hooks/register-hooks.ts`) →
`record-rules/hook-handler.ts`. Fires on interactive/API field writes through the field-value
mutation path, **inline** in the writing process. **Excludes native rules** (they'd log a spurious
`ok` and skip the recalc). Gated by `publishEvents && ctx.userId` at
`field-values/field-value-mutations.ts` — i.e. covers interactive/API writes with an actor; system
writes without a `userId` skip here (the "userId gate").

### Door 1b — batched field-trigger door (native only)
`field-hooks/collect-triggers.ts` + `field-hook-job.ts`. Fires **only native-action** rules for
interactive writes — the migrated `FIELD_TRIGGERS` (vendor-part cost, subpart qty, reorder point,
preferred flag). Batches under bulk operations (one recalc per bulk edit, not N). Gating is
"the field has an enabled native cached rule" (cache-only).

### Door 2 — record lifecycle bus
`events/handlers/handle-record-rules.ts`, registered on **all** lifecycle keys —
`entity:created`/`entity:deleted` **and** the prefixed variants (`ticket:created`, `contact:*`,
`stock_movement:*`, `company:*`, …; `eventPrefix = entityType || 'entity'`). Handles `on:
created|deleted` rules (both user and native/system). `deleted` firings evaluate against the event
payload (last-known values — the record is archived).

### Door 3 — sync manifest (B2)
`events/handlers/handle-sync-record-rules.ts`, on `sync:records:changed`. The connector/import
door. Resolves the persisted manifest, transition-matches captured field writes + lifecycle lists,
and calls `fireRecordRulesBatch(source: 'sync')`. See §8.

All four are registered in the events worker's job mapping (`events-worker.ts`
`eventHandlersJobMappings`) *and* the `EventHandlers` map (`events/handlers/publish-event-job.ts`) —
miss either and the queued job won't resolve.

### 7.1 The payload shape each door hands over

🛑 **The same systemAttribute arrives in a different shape depending on which chain fired you, and
nothing in the types says so** — every fire point declares `Record<string, unknown>`.

| chain | fire point | SINGLE_SELECT | RELATIONSHIP |
| --- | --- | --- | --- |
| system hook | `UnifiedCrudHandler.runPreHooks` | `'issued'`, sometimes `['issued']` | `'defId:instId'` |
| field pre-hook | `fireFieldPreHooks`, after `validateAndConvertValue` | `{type:'option', optionId}` | `{type:'relationship', recordId}` |
| **capture** | `captureEventData` — feeds pre-delete hooks, post-delete hooks **and** the door-2 lifecycle payload | **`['issued']`** | **`['defId:instId']`** |

The capture chain reads through `getValues`, which arrays every `ARRAY_RETURN_FIELD_TYPES` member
(`SINGLE_SELECT`, `MULTI_SELECT`, `TAGS`, `RELATIONSHIP`, `FILE`) **regardless of how many values
are stored** — a to-one relation is still an array of one. A create/update threads the caller's own
input instead, where the same field is a bare string. Scalars (NUMBER, CURRENCY, TEXT, CHECKBOX)
are bare everywhere; DATETIME is a **string**, not a `Date`; ACTOR is an object.

⚠️ **Never test a captured value with `typeof value === 'string'`.** On a SINGLE_SELECT or
RELATIONSHIP it is always false, so the reader matches nothing — it does not throw, it silently
does nothing, and it passes any unit test built from a hand-written string fixture. That has
shipped twice: once on the field pre-hook chain (#1940) and once on the capture chain (#1995,
where a delete guard was inert in production and a delete that should have been refused cascaded
9 stock movements).

**Read through `resources/events/captured-values.ts`** — `unwrapStatusValue`,
`unwrapRelationId`, `unwrapRelationIds` — which handle all three chains. The shape itself is
pinned by `resources/events/captured-shape.test.ts`; guard fixtures build it with
`field-hooks/__tests__/support/captured.ts` so a test cannot pass against a shape production never
sends.

### 7.2 The three write lanes and the hook chain

The doors above carry *rules*. The field-change **post-hook** chain is a separate fan-out over the
same writes, and it reaches all three lanes. See `plans/events/10-replay-hooks-from-the-committed-scope.md`.

| Lane | Entered by | mark | derive | react + `field:updated` |
| --- | --- | --- | --- | --- |
| Inline | drawer, dialogs, API, Kopilot | yes | yes | yes |
| Buffered | the six `runInTxWrite` composers below | yes | yes | yes |
| Sync | connectors (sink and relationship pass), CSV import, seeders | yes, from `touched` keys and mirrors | only with a `batch` core | no |

The buffered lane is every write inside a `TxWriteScope`: `accounting/money/commands/run-money-command.ts`,
`accounting/sales/gather.ts`, `accounting/sales/billing/commands.ts`, `accounting/sales/orders/fulfill.ts`,
`accounting/purchasing/bill-intake/fold.ts`, `accounting/money/payouts/sync.ts`. Their writes are
suppressed in-transaction and replayed after commit.

A `quiet` session (`quietSession(reason)`) is on none of the three: its bus event, rules, triggers
and post-hooks are off, and the writer discharges what it needs after commit (builds and relief
recalculate QoH themselves). `coveredBy` on it changes realtime only, not rules or marks: see the
realtime guide §5.

Money's evidence triggers are mark hooks on all three lanes, not record rules: the five in
`accounting/money/customer-money/record-marks.ts` mark the order-evidence and payout reconcilers.

One function serves both post-commit lanes: `dispatchFieldChanges` (`field-hooks/dispatch.ts:108`).
The flush calls it from the committed scope's buffered changes (`resources/crud/tx-write-flush.ts:91`);
the sync finalize calls it from the manifest's `touched` keys, with ids-only records passed as
`degraded` (every system-attribute field on the def becomes a valueless change, which only a mark —
or a sync-lane batch derive — can consume). It resolves defs and fields from the org cache only, runs
the whole pass inside one `runWithDirtyParents` so marks coalesce into a single drain, and guards
every handler call so one failure cannot starve the rest. The sync finalize opens that scope with
`{ lane: 'sync' }`, which reaches `rebuildBatch` so a drain can announce its batch as one
`records:changed` (the fulfillment-totals stamp does).

Sync-lane changes are valueless, with one exception: re-pointed single-valued relationships in
`REPOINT_DELTA_ATTRS` (`line_item_order`, `fulfillment_line_fulfillment`) always capture `{o, n}`,
and finalize hands them to the marks, so the parent a line left is marked too.

What a handler may do on a lane falls out of its **kind**, declared at registration (§13) and
typed in `field-hooks/types.ts:255-305`. A `MarkHandler` sees a `FieldChangeRef` — values are
present inline and buffered, **absent on sync** — so a mark must produce a correct (if wider)
marking without them. `skipOnCreate` is honoured on every lane.

Every dispatch logs one structured line, `field hooks dispatched` under
`scope: 'field-hooks:dispatch'`, with `lane`, `attemptId` (the flush's `scope.attemptId`) and
per-handler `{ fired, skipped, failed }`, and returns the same `DispatchReport`. A derivation
that stops firing shows up in OpenObserve as a zero rather than in the next retest.

---

## 8. The Sync-Change Manifest (B2)

### Why it exists
The connector sink (`data-connectors/sinks/entity-sink.ts`) and the CSV importer write with
`skipEvents: true` → `publishEvents: false`, which kills the **entire** per-write fan-out: inline
field hooks, activity touch, timeline, the BullMQ event bus (`Event` rows, workflows, agents,
webhooks, analytics), and realtime. So synced data changes are invisible to the reactive system.
(A second gate compounds it: post-hooks also require `ctx.userId`, which system writes lack.)

Rather than un-suppress per-write events (a 50k-record sync would enqueue hundreds of thousands of
jobs into concurrency-1 event workers), B2 **batches**: one aggregate event per run.

The manifest carries a second consumer: the field-change hook chain, replayed from the same
`touched` keys at finalize (§7.2). Rules go through door 3; derivations go through
`dispatchFieldChanges`.

### The collector
`record-rules/sync-manifest-collector.ts` builds a `SyncChangeManifest`
(`sync-manifest-types.ts`):

```
SyncChangeManifest {
  version: 2
  detailTruncated: boolean                                  // tier-2 cap hit; membership still complete
  membershipTruncated: boolean                              // membership cap hit; forces the large lane
  touched: Record<RecordId, outputKey[] | 1>                // every record a sync write changed (1 = keys shed)
  deltas: Record<RecordId, Record<outputKey, {o?, n}>>      // subscribed fields + REPOINT_DELTA_ATTRS, old→new
  mirrors?: Record<RecordId, outputKey[]>                   // other side of a relationship the run wrote
  createdRecordIds: RecordId[]                              // every created record
  archivedRecordIds: RecordId[]                             // every archived record
  createdValues?: Record<RecordId, Record<sysAttr, raw>>   // raw create values for native handlers
}
```

The sink captures at its update/create/archive sites (`entity-sink.ts` ~`:661–790`), **gated by
`ctx.manifest.subscriptionsFor(defId)`** — only fields/lifecycles some enabled rule watches
(`record-rules/subscriptions.ts` derives the set from the cached rules). Old values come from
`capture-field-changes.ts` (`captureUpdateFieldChanges`), which reads the pre-write DB value; this
module is shared by the sink and the import job.

**Mirrors.** A relationship is stored on both records. When a sync session writes one side,
`relationship-sync.ts` records the other side in `mirrors` instead of announcing it. Finalize feeds
mirrors to realtime, the integrity dispatch and record rules (as `changed` with no old value, so a
list the run emptied fires nothing). Workflows, timeline and the activity touch skip them, matching
the inline lane, where an order edit never fires "contact updated".

### Persist → publish → consume
- **Bulk sync is sliced.** The collector is **per-slice** (each slice is a separate BullMQ job), so
  each slice folds its fragment into `DataConnectorRun.manifest` (jsonb) via `foldRunManifest`
  (`data-connectors/service.ts`) — a row-locked read-`mergeManifests`-write, race-safe across
  sibling stream chains. (Persisting only at `finalizeRun` would capture nothing for a bulk sync —
  that path closes via the ledger.)
- **One pointer event per run.** At finalize, `sync:records:changed` publishes with pointers only —
  `{ source: 'connector'|'import', organizationId, runId? | importRef? }`. The manifest lives on the
  run/job row, not in the event.
- **Consumer** `handle-sync-record-rules.ts`: resolves the manifest, **claims it once-only**
  (`claimRunManifestConsumed` — both a re-entered finalize and a BullMQ redelivery can duplicate),
  then fires. Field firings do smart snapshot planning: a **partial** snapshot built from the
  manifest's changed values when the rule's condition refs all resolve within the changed keys,
  else **one bulk fetch** (`fetchResourceSnapshots`) for records needing a full snapshot.

### Second producer: CSV import
`jobs/import/execute-plan-job.ts` captures at both `skipEvents` sites and publishes an **inline**
manifest (1000-record hard cap) via the same event.

### At-most-once — the load-bearing caveat
The manifest event is **at-most-once by design**: the consumer claims the manifest *before* firing,
so a crash mid-fire loses the remainder rather than double-notifying on retry. **Consequence for
ledger-like consumers** (inventory deduction): a lost firing = a lost reaction, and the manifest
won't re-fire it (the cell is already written; the next sync sees no change). Such consumers must
keep their own **cursor** (a watermark advanced only when the reaction lands) *and* a **reconcile**
that re-derives from absolute state on every sync — never rely on the event alone. See the inventory
plan (`plans/data-connectors/v9/inventory-record-rule-plan.md`) and
`data-connectors-architecture-guide.md`.

The finalize **integrity passes** (totals, relief, shipment posting) are the exception: idempotent,
so at-least-once. The claim sets `integrityPendingSince`, `integrityDoor` clears it under a per-run
advisory lock, a delivery that loses the claim goes through the same door, and
`syncIntegrityRecoveryJob` replays any claim pending over 10 min from the stored manifest.

---

## 9. System Rules (the trigger unification)

The compile-time `FIELD_TRIGGERS` and `ENTITY_TRIGGERS` registries were **deleted** (B2 §7–9) and
re-expressed as code-declared system rules on the same engine. The strongest reason wasn't
uniformity — it's that code triggers rode the same `publishEvents` gate, so a vendor price or
subpart quantity arriving via connector sync **silently skipped** its recalc. Unification gives them
B2's sync visibility for free.

- **Declaration:** `declareSystemRules([...])` (`record-rules/system-rules.ts`). A
  `SystemRuleDeclaration` has a `key` (`system:<key>`), a `defSlug` (or systemAttribute), an `on`,
  and all-`native` actions. At cache-compute the union resolver maps each to the org's real def/row
  ids (def by slug or entityType; field by systemAttribute within the def) and drops unresolvable
  ones. **No declarations ⇒ zero extra work / byte-identical cache.**
- **The manufacturing rules** live in `field-hooks/system-record-rules.ts` (7 field rules — cost,
  preferred, subpart qty, reorder point) and `field-hooks/system-entity-rules.ts` (7 lifecycle
  rules — BOM cost on vendor-part/subpart create/delete, stock-movement **explode → QoH** [order
  matters], company enrichment). Their native handlers are thin wrappers that lazy-import and call
  the **unchanged** trigger functions, adapting the batch event to the legacy per-record shape.
- **Why the inventory rule can't be a system rule:** system rules key off a **stable** `defSlug`
  (`stock-movements`, `vendor-parts` — auxx's own defs, same in every org). An inventory source
  (`shopify_variants`) is a **per-org, per-connector owned def** with a different id everywhere, so
  its rule must be a **DB row** referencing that org's real def+field. This is why the planned
  inventory feature introduces a `managed` marker on `RecordRule` (a DB row that may carry a native
  action and is UI-locked) rather than a code declaration. *(Planned — not yet built.)*

---

## 10. Cache & Invalidation

- **`recordRules` org-cache key** (`cache/providers/`) — the derived union of DB rows + resolved
  system rules (+ future workflow-derived rules). The hot path uses `getCachedRecordRules(orgId)`;
  the table is only queried by the tRPC `list` (which reads DB rows, so system rules never leak into
  the settings list).
- **Invalidation edges** (`cache/invalidation-graph.ts`): `record-rule.changed` (every rule
  mutation), plus `custom-field.created` / `custom-field.updated` / `custom-field.deleted` — a newly
  provisioned/edited subscribed field must recompute the system-rule union.
- **⚠ Deploy staleness (known open issue).** The cached union has a 1-day TTL and is **not** versioned
  by the declaration set. A deploy that adds/changes **system-rule declarations** serves the stale
  union (missing the new rules) for up to a day — this silently no-ops the new triggers (Bug 1).
  **Mitigation today:** run `packages/lib/scripts/flush-record-rules-cache.ts` after changing system
  declarations. **Real fix (unbuilt):** hash the declaration keys into the cached value and recompute
  on mismatch, or flush on boot. DB-row rule changes are fine — they invalidate correctly.

---

## 11. tRPC & UI Surface

- **Router** `apps/web/src/server/api/routers/record-rules.ts` — `list` (DB rows enriched with a
  UI-friendly `fieldRef`/`fieldLabel`), `runs` (per-rule debug history), `create` / `update` /
  `setEnabled` / `delete` (**adminProcedure**; field refs normalized to row ids; `record-rule.changed`
  busted after every mutation). The `actionSchema` deliberately omits `native` — native rules are
  server-declared only.
- **Settings UI** `apps/web/src/app/(protected)/app/settings/rules/` + components under
  `~/components/record-rules/{ui,hooks}` (ListCard grid, create/edit dialog with the shared
  `ConditionContainer` + ordered action editor, a runs dialog). Condition types come from
  `@auxx/lib/conditions/client`.

---

## 12. End-to-End Flows

**Interactive: a ticket's priority changes to urgent → notify + set SLA**
Cell write → field-value mutation fires the `'*'` seam → door 1 (`hook-handler`) looks up cached
rules for that field → `matchesFieldTransition('changed', old, new)` → `evaluateConditions`
(assignee empty?) → ordered actions (`notify`, `set-field`) inline → `RecordRuleRun` logged
(`source: 'interactive'`).

**Sync: a synced `shopify_order.financial_status` becomes `refunded` → enqueue workflow**
Connector sink writes the field `skipEvents` but, because a rule subscribes it, records
`{o:'paid', n:'refunded'}` into the slice collector → slice folds into `DataConnectorRun.manifest`
→ finalize publishes `sync:records:changed {source:'connector', runId}` → door 3 resolves + claims
the manifest → transition-matches → `fireRecordRulesBatch(source:'sync')` → `enqueue-workflow`.

**Bulk interactive: CSV import creates 500 vendor parts → recalc part cost once per part**
Import job captures created records + raw values into an inline manifest → `sync:records:changed
{source:'import', importRef}` → door 3 lifecycle path → the `mfg-vendor-parts-created` **system
rule** (native) → `recalculatePartCostForEntityBatch` invoked once across the batch (1 lookup for
misses + 1 deduped recalc, not 500×).

---

## 13. Gotchas & Invariants

- **A captured value is not the shape a create event sends.** `RELATIONSHIP` and `SINGLE_SELECT`
  arrive as one-element arrays on the capture chain and as bare strings on create. Unwrap through
  `resources/events/captured-values.ts`; a `typeof === 'string'` test is silently always false.
  See §7.1 — this has shipped as a live defect twice.
- **`skipEvents` suppresses the per-write fan-out, not the hook chain.** Sync/import writes still
  fire no per-write events, hooks or realtime *as they land*, and rules still react only through
  the sync-change manifest (door 3). But the registered field-change chain IS replayed once at
  finalize, from the manifest's `touched` keys, through `dispatchFieldChanges` — marks on every
  key, derives only through a `batch` core, reacts never (§7.2). So do not add a per-write hook on
  the sync thread; register the derivation by kind and it is covered.
- **The manifest is at-most-once.** Lost firing = lost reaction, not retried. Ledger consumers need
  a cursor + a reconcile (see §8). For cosmetic reactions, at-most-once is fine.
- **Direction is on the rule, not in conditions.** Use `on: increased|decreased|set|cleared`, never
  try to express old→new in a `ConditionGroup`.
- **Native actions are server-only; rules are all-native or native-free.** The tRPC schema and
  `assertRuleShape` enforce this; `hasNativeAction` routes the two doors as exact complements.
- **One `:updated` event per record write, not one per field.** A write through `updateEntity`
  collects its per-field changes and publishes ONE record-level `:updated` event carrying
  `changes[]`; the per-field `<prefix>:field:updated` event is published only by doors that have
  no record-level event (the panel's `fieldValue.set`, bulk edits, add/remove). A write that
  changed nothing publishes nothing. `createTimelineEvent` writes one FIELD_UPDATED row per entry
  of `changes[]` and no summary row. Creates publish `:created` only; their field writes emit no
  per-field events. Native field triggers declared `skipOnCreate` are left to the def's lifecycle
  `created` rule, and every native trigger now runs OFF the request through the `field:trigger`
  bus event (`FIELD_TRIGGERS_ASYNC`). `publishLater` enqueues ONE `publishEventJob` (which persists
  the `Event` row and captures analytics inline) plus `processWebhookJob` only for
  `WEBHOOK_EVENTS` types. See `plans/field-values/update-path-and-events.md`.
- **Hooks inherit the write's connection.** A handler, service or field-value context built with
  no `db` inside a write takes the ambient connection of the write in flight
  (`getAmbientWriteDb`, `resources/crud/write-session-als.ts`), so a hook inside a
  transaction-scoped write joins that transaction instead of opening a second pool connection
  that cannot see its rows and can deadlock against it. A field-change event carries
  `isCreate` so a hook that derives a sibling field can stand down on a create.
- **The userId gate.** Door 1 requires `ctx.userId`; deliberate system writes without an actor skip
  interactive field hooks. (This gate was left in place; relaxing it is an audited, unshipped
  change.) It is no longer the last word on derivation: the buffered and sync lanes replay the
  chain post-commit regardless of the gate, so a write that skips inline still derives (§7.2).
- **Register a post-hook by kind.** `registerMarkHooks` / `registerDeriveHooks` /
  `registerReactHooks` (`field-hooks/registry.ts:216-241`); a mark runs on every lane, a derive
  reaches sync only with a `batch` core, a react never does. A derive with no `batch` is dead on
  connector/import writes — say so in its registration comment or add the core.
- **Order matters in action arrays.** `[explodeBomMovement, recalculatePartQoH]` must stay ordered
  — explosion writes child movements before the parent QoH is recomputed. QoH correctness also
  depends on the **threaded original create values** (`eventData`), never a refetch.
- **Cache staleness on deploy.** New/changed **system-rule declarations** need a cache flush (§10)
  — otherwise they silently don't fire for up to a day.
- **`RecordRuleRun` has no FKs** on `ruleId`/`entityInstanceId` (system rules aren't rows; deleted
  records must still log). Don't add them back (migration `0258` dropped the `ruleId` FK for exactly
  this reason).
- **Lazy-import across boundaries.** The record-rules ↔ data-connectors ↔ cache ↔ field-hooks
  barrels break `vi.mock`; the doors and handlers lazy-import everything but types/logger. Follow
  the pattern in `handle-sync-record-rules.ts`.
- **New lib subpath ⇒ dev-server restart.** Adding a `@auxx/lib/record-rules*` export requires a
  Turbopack dev-server restart (touch-invalidation doesn't refresh the exports map); the web app
  500s until then.

---

## 14. Key Files

| Concern | Path |
| --- | --- |
| Schema | `packages/database/src/db/schema/record-rule.ts` |
| Types + routing predicate | `packages/lib/src/record-rules/types.ts` (`hasNativeAction`) |
| Engine | `packages/lib/src/record-rules/engine.ts` (`fireRecordRules`, `fireRecordRulesBatch`) |
| Transitions | `packages/lib/src/record-rules/transitions.ts` |
| Actions + native registry | `packages/lib/src/record-rules/actions.ts` (`registerNativeRuleHandler`) |
| Store + shape invariant | `packages/lib/src/record-rules/store.ts` (`assertRuleShape`) |
| System-rule declarations | `packages/lib/src/record-rules/system-rules.ts` (`declareSystemRules`) |
| Manufacturing system rules | `packages/lib/src/field-hooks/system-record-rules.ts`, `system-entity-rules.ts` |
| Manifest types | `packages/lib/src/record-rules/sync-manifest-types.ts` |
| Manifest collector + subscriptions | `packages/lib/src/record-rules/sync-manifest-collector.ts`, `subscriptions.ts` |
| Old-value capture | `packages/lib/src/record-rules/capture-field-changes.ts` |
| Payload capture (delete/lifecycle) | `packages/lib/src/resources/events/extract-event-data.ts` (`captureEventData`) |
| Payload unwrappers + the three-chain table (§7.1) | `packages/lib/src/resources/events/captured-values.ts` |
| Retention | `packages/lib/src/record-rules/run-retention-job.ts` |
| Door 1 (interactive field) | `packages/lib/src/record-rules/hook-handler.ts`, `field-hooks/register-hooks.ts` |
| Post-hook kinds + registration (§7.2) | `packages/lib/src/field-hooks/types.ts`, `field-hooks/registry.ts` |
| The one lane dispatch (§7.2) | `packages/lib/src/field-hooks/dispatch.ts` |
| Buffered-lane caller | `packages/lib/src/resources/crud/tx-write-flush.ts` |
| Sync-lane caller | `packages/lib/src/events/handlers/finalize-integrity-passes.ts` |
| Door 1b (native field-trigger) | `packages/lib/src/field-hooks/collect-triggers.ts`, `field-hook-job.ts` |
| Door 2 (lifecycle bus) | `packages/lib/src/events/handlers/handle-record-rules.ts` |
| Door 3 (sync manifest) | `packages/lib/src/events/handlers/handle-sync-record-rules.ts` |
| Sink capture sites | `packages/lib/src/data-connectors/sinks/entity-sink.ts` (~`:661–790`) |
| Run manifest fold/claim | `packages/lib/src/data-connectors/service.ts` (`foldRunManifest`, `claimRunManifestConsumed`) |
| Cache union + invalidation | `packages/lib/src/cache/providers/` (`recordRules`), `cache/invalidation-graph.ts` |
| Cache flush (deploy staleness) | `packages/lib/scripts/flush-record-rules-cache.ts` |
| tRPC | `apps/web/src/server/api/routers/record-rules.ts` |
| Settings UI | `apps/web/src/app/(protected)/app/settings/rules/`, `~/components/record-rules/{ui,hooks}` |
