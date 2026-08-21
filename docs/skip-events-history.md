<!-- docs/skip-events-history.md -->

# `skipEvents`, Biography of a Flag

**Last Updated:** 2026-08-21
**Scope:** The history, contract, call-site inventory, and failure record of the
`skipEvents` CrudOptions flag, the single boolean that suppresses the entity write
fan-out. §11 covers the **sibling lane**: channels/mail, which solves the same problem
with three *different* flags and has its own incident record.

> **This document is the history, not the mechanism.** How the reactive layer works
> (record rules, dispatch doors, the B2 sync-change manifest) is documented in
> `entity-events-architecture-guide.md`, especially §7 (Doors) and §8 (the manifest).
> Read that first if you want to know *how*. Read this if you want to know *why it
> looks like that*, what it has broken, and what the rules are before you add another
> call site.

> **Two lanes, one problem.** "Don't let a backfill fan out per-record" was solved
> twice, independently, with no shared vocabulary:
>
> | | Entity CRUD lane | Channels/mail lane |
> | --- | --- | --- |
> | Flag(s) | `skipEvents` (one coarse boolean) | `isInitialSync`, `backfillCutoffAt`, `inSyncBatch` (three, orthogonal) |
> | Granularity | all-or-nothing | automations vs realtime separated |
> | Contract | B2 manifest, written down | per-mechanism invariants in the channels guide |
> | Classic failure | **under**-suppression (floods) then silent **loss** of rules/realtime | **over**-suppression (real mail vanished) and windows that never close |
>
> `packages/lib/src/{ingest,channels,email,messages}` contains **zero** occurrences of
> `skipEvents`. If you are working in mail, §11 is your section, not §1–§10.

---

## 1. The one-sentence version

`skipEvents: true` was added so bulk writers would not enqueue hundreds of thousands
of jobs onto the events queue (a 50k-record sync at one event per record). Every
capability it silenced has since had to be rebuilt as a separate, batched
"compensation door", realtime, record rules, and duplicate detection each took their
own PR, spread across 2026, and the codebase's current position is that **silencing
without compensating is a bug**.

> **Correction to an older doc:** `entity-events-architecture-guide.md:253` describes
> the destination as "concurrency-1 event workers". That is stale, the events worker
> runs at `concurrency: 10`
> (`apps/worker/src/workers/worker-definitions/events-worker.ts:70`), and
> `publish-event-job.ts:73` notes the same. The batching argument stands on job volume,
> not on a serial worker.

---

## 2. What it is, and why it is coarse

`CrudOptions` (`packages/lib/src/resources/crud/unified-handler-mutations.ts:44-62`)
has exactly **two** fields:

| Field | Controls |
| --- | --- |
| `skipEvents?: boolean` | The entire per-write fan-out (§3). |
| `suppressPostDeleteHooks?: boolean` | Only `deleteEntity:724`, skips post-delete hooks for parent-driven child cleanup. |

There is **no** `skipRealtime`, `skipTimeline`, `skipRules`, or `skipHooks`. Two finer
knobs exist one layer down but are **unreachable from `CrudOptions`**:

- `publishEvents`, the field-value layer's name for the same idea
  (`field-value-mutations.ts:2084`, `:2347`); `setFieldValues` derives it at
  `unified-handler.ts:1209`.
- `skipInverseSync`, `field-value-mutations.ts:400`; real, orthogonal, and never set
  by the CRUD path (so inverse relationship sync always runs, even under `skipEvents`).

A third, `CrudContext.skipEvents` (`resources/crud/types.ts:27`), is **dead** nothing
reads it.

So "just suppress the timeline entry" is not something the API can express. It is
all-or-nothing, and that coarseness is the root of every incident below.

---

## 3. The suppression map

### Turned OFF by `skipEvents: true`

Entry point: `updateEntity:501-504` / `createEntity:387-391` set
`publishEvents: !options.skipEvents`, which flips the `willFirePostHook` gate at
`field-value-mutations.ts:2178-2181`.

**Bus events** (`unified-handler-mutations.ts:405`, `:424`, `:516`, `:537`, `:597`,
`:611`, `:671`, `:780`), `entity:created` / `entity:updated` / `*:deleted` are not
published. Per `events/handlers/publish-event-job.ts:154-174` that costs the whole
handler chain: `createTimelineEvent`, `triggerResourceDispatch` (workflows, agents,
webhooks), and `handleRecordRules` lifecycle firing.

**Realtime** `record:created`, `record:updated`, `record:archived`, `record:deleted`,
and `fieldValues:updated` frames (`field-value-mutations.ts:2231-2258`, `:2304-2325`)
never reach an open grid.

**Every registered field-change hook.** The three global `'*'` ones
(`field-hooks/register-hooks.ts:100-104`):

| Hook | Lost |
| --- | --- |
| `publishFieldChangeEvent` | `entity:field:updated` → no per-field timeline entry |
| `touchActivityOnFieldChange` | `EntityInstance.lastActivityAt` never advances, stated verbatim in the schema comment at `entity-instance.ts:182-184` |
| `handleRecordRulesOnFieldChange` | org-configured record rules do not evaluate |

…plus every scoped one: inbox cache invalidation, work-order visit/draft-invoice/
sequence hooks, **quote & invoice total recomputation** (`money/totals-hooks.ts`),
QuickBooks mirror enqueue, catalog markup pricing, `ADDRESS_STRUCT` normalization +
geocoding, and `PHONE_INTL` geo derivation.

**Native field triggers** (`field-value-mutations.ts:2287-2296`), the door carrying
system record rules with native actions: BOM cost recalc, stock status, the v9
inventory→part deduction.

**Dedup enqueue** `enqueueDuplicateScan` sits inside the guard
(`unified-handler-mutations.ts:443-448`, `:558`).

### Still ON under `skipEvents: true`

This half matters as much as the first, and is routinely forgotten:

- **All pre-hooks.** `runPreHooks` (`:361`, `:486`) and `fireFieldPreHooks`
  (`field-value-mutations.ts:2157-2166`) are ungated. Auto-numbering, normalization,
  defaults, and every guard (`guardInboxOwnerField`, `rejectIfSystemTag`,
  `guardBillingProjectionWrite`, …) still fire and can still reject the write.
- **Required-field and uniqueness validation.**
- **Pre- and post-delete entity hooks** `deleteEntity:718-722` reads them regardless;
  only `suppressPostDeleteHooks` turns post-delete off.
- **`displayName` / `secondaryDisplayValue` / `avatarUrl` recompute** and the
  dependent-display-name cascade.
- **`searchText` reindex** `field-value-helpers.ts:1117`, `:1138`, `:1231`, ungated.
- **Inverse relationship sync** gated on `skipInverseSync`, which `CrudOptions`
  never sets.
- **Duplicate-pair cleanup on archive** deliberately placed *outside* the guard
  (`unified-handler-mutations.ts:622-636`) with a regression test at
  `resources/crud/__tests__/archive-duplicate-pair-cleanup.test.ts:79-80`.
- **One realtime frame leaks.** `publishRecordColumnUpdate`
  (`field-value-helpers.ts:1045`) is called from `maybeUpdateDisplayValue` at `:1126`
  and `:1242` with **no `publishEvents` parameter at all**. Any `skipEvents` write that
  touches a display / avatar / name-source field still pushes `record:updated` to
  `rooms.orgRecords`. `skipEvents` is not as total as its name suggests.
- **`EntityInstance.updatedAt`, subtle.** `$onUpdate`
  (`entity-instance.ts:25-28`) moves it whenever the *instance row* is written
  (archive/restore, or a display-column write). A pure non-display field write does
  **not** move it. This is exactly why the dedup scanner keys off
  `GREATEST(ei."updatedAt", max(fv."updatedAt"))` (`entity-instance.ts:100-108`).
- **`managedByConnectorId`** is not a CRUD concern, the connector sink stamps it
  itself after the write (`sinks/entity-sink.ts:562-600`).

> **Correction (2026-08-21, D-7 / #1805):** the `EntityInstance.updatedAt` bullet above
> describes the pre-D-7 world. `$onUpdate` has been **removed** from
> `EntityInstance.updatedAt`; nothing auto-bumps it anymore. Content changes (including
> archive/restore and handler-mediated field writes) now stamp `updatedAt` explicitly,
> while bookkeeping writes (watermark stamps, `lastSuggestionScanAt`,
> activity/interaction touches) deliberately do not. Raw writers that bypass the handler
> still only move `FieldValue.updatedAt`, so the dedup scanner's
> `GREATEST(ei."updatedAt", max(fv."updatedAt"))` arm remains load-bearing — see the
> schema comment at `entity-instance.ts` (`lastDuplicateScanAt`).

---

## 4. The contract

The docblock at `unified-handler-mutations.ts:47-53` is the governing rule:

> **B2 CONTRACT** (see `plans/events/b2-sync-change-manifest-plan.md`, D9): suppression
> and delivery are two halves of one contract. Every NON-SEED bulk writer that sets
> `skipEvents: true` MUST feed `sync-manifest-collector` (via `capture-field-changes`)
> so record rules still see the writes and fire with `source: 'sync'`. Seed writers are
> the ONLY documented exemption (they stay silent forever). **"Silent skipEvents"
> therefore means seed-only, anything else is a bug.**

Read that as three obligations, not one:

1. **Record rules** feed the manifest.
2. **Realtime** publish a coarse `records:invalidated` per touched def, in place of
   the per-record frames you suppressed.
3. **Dedup** reachable via the manifest (`handle-sync-duplicate-scan.ts`), so
   obligation 1 discharges this one too, *provided* the manifest carries `recordIds`.

Only #1 is written down in the docblock. #2 and #3 are equally real and were each
learned the hard way, see §5.

---

## 5. Chronology

| Date | PR | What happened |
| --- | --- | --- |
| 2025-12-28 | `8abb4b8ce` (initial commit) | **The flag predates recorded history.** `skipEvents` already exists at the repo's first commit, in the pre-unified per-resource handlers (`resources/crud/handlers/{contact,entity,ticket}-handler.ts`, `resource-crud-service.ts`), and **the CSV importer is already using it** (`jobs/import/execute-plan-job.ts`). So the importer is the flag's first consumer, and it will wait ~8 months for its realtime compensation. |
| 2026-01-19 | `44630cc29` | **Consolidation.** The per-resource handlers collapse into `UnifiedCrudHandler`; `skipEvents` becomes the single `CrudOptions` field it is today, documented with a one-liner, `/** Skip event publishing (for bulk imports) */`. Scope is still **narrow**: the guard wraps only the `publishEvent` bus call. `setFieldValues` takes no options, so field-value realtime and field triggers still fire under `skipEvents`. No compensation exists, and none is needed yet. |
| 2026-04-23 | #480 `3270a3a13` | **The arg-slot bug is introduced.** "enhance multi-value field handling" inserts `modes` as the **4th** parameter of `updateEntity`, pushing `options` to 5th, but leaves `bulkUpdateEntities` calling the old 4-arg form. From here, every bulk update silently drops `skipEvents`. Nobody notices for 98 days. |
| 2026-06-23 | #945 `4c723e4bc` | **Compensation 1 (realtime), connector only, and the blast radius widens.** This is the pivotal commit: it introduces the connector-sink call sites *and* threads `skipEvents` → `publishEvents` → `skipPublishEvents` all the way down, so it now kills per-record field-value realtime and field triggers too. The trigger was an incident: per the PR, backfill-scale per-record frames "floods Pusher (403s), the proximate cause of the worker crawling in the recent incident." The fix is coarse `records:invalidated`, one per touched def per slice (`realtime/events.ts:139-148`, `connector-sync-source.ts:242`). **The CSV importer does not get it.** |
| 2026-07-01 | #1038 `b531429d2` | **A bespoke post-sink pass.** The v9 inventory→part bridge runs *after* the sink because "the sink writes with `skipEvents`, so field-change hooks never fire on sync writes" (`inventory-bridge-pass.ts:10`, `connector-sync-source.ts:389`). A whole pass exists because a hook could not. |
| 2026-07-02 | #1044 `db266ded1` | **Compensation 2 (record rules), the B2 manifest.** The sync-change manifest engine lands, plus the field-hook unification that folded the old compile-time `FIELD_TRIGGERS`/`ENTITY_TRIGGERS` registries onto the same engine. This is where the B2 CONTRACT docblock is written. One `sync:records:changed` per run instead of O(records) events. |
| 2026-07-30 | #1430 `06819abfb` | **The arg-slot bug is fixed, after 98 days.** And note *how* it was found: the PR is "drop the `packages/services` project reference and fix the 50 errors it hid." A stale project reference had been suppressing typecheck coverage; restoring it surfaced the bug. **Nobody noticed the event flood in production** for over three months every `bulkUpdateEntities` call defeated the #945 Pusher compensation, and it took a type error to reveal it. |
| 2026-08-10 | #1522 `258732369` | Mail-category rework; data migration 076 adopts `SEED_OPTS = { skipEvents: true }`, "Every tag write here is a reshape: no realtime fan-out, no notifications." A legitimate seed-class use. It also adds the **first regression tests pinning the argument positions**: `expect(call.modes).toBeUndefined()` / `expect(call.options).toEqual({ skipEvents: true })`. |
| 2026-08-14 | #1621 `01ebfa1dc` | **Compensation 2 repaired for a new write shape.** Row-level sink semantics (B1) adds a fourth connector call site (`row-level-writes.ts:338`), an `'add'`-mode append. The manifest had to be taught to feed the **projected resulting array** into `captureSubscribedChanges`, otherwise a rule subscribed to a multi-value field would see a nonsense `{o, n}` pair under an append. |
| 2026-08-14 | #1640 `b8f06b4e0` / #1648 `b7cdace53` | **Compensation 3 (dedup).** The duplicate-detection engine has to route around `skipEvents` twice: `enqueueDuplicateScan` sits inside the event guard, so sync/import reach the scanner only via `handle-sync-duplicate-scan.ts` on the manifest event; and because `skipEvents` writers leave **both** `EntityInstance.updatedAt` and `lastActivityAt` untouched, the scan watermark had to key off `GREATEST(ei.updatedAt, max(fv.updatedAt))`, "`FieldValue.updatedAt` is the only timestamp that always moves." Archive pair-cleanup is deliberately moved outside the guard. |
| 2026-08-20 | #1784 `b208e58d5` | **Compensation 1 finally extended to the importer, ~8 months after it started using the flag, two months after the connector got the same fix.** "no `record:created` / `record:updated` / `fieldValues:updated` frame ever reaches an open grid… Without it the grid stays stale until a manual reload" (`execute-plan-job.ts:153-157`). The fix also had to canonicalize the room key: `ImportMapping.entityDefinitionId` holds either keyspace, so publishing the raw value addressed `…-records-part` while every browser sat on `…-records-<cuid>`, "the frame was delivered to nobody." |

The shape of that table is the lesson: **each capability was rediscovered
independently, in production, months apart.** Nobody set out to break realtime or
dedup, the flag silently withdrew them and no one noticed until a user did.

---

## 6. Compensation-door inventory

| Suppressed | Door that restores it | Where | Covers |
| --- | --- | --- | --- |
| Record rules (field + lifecycle) | B2 sync-change manifest → `sync:records:changed` | `record-rules/sync-manifest-collector.ts`, consumed by `events/handlers/handle-sync-record-rules.ts` | connector sink, CSV import |
| Realtime grid updates | coarse `records:invalidated` per touched def | `connector-sync-source.ts:242`; `jobs/import/execute-plan-job.ts:172-181` (throttled) | connector sink, CSV import |
| Duplicate scan enqueue | manifest `recordIds` → `handle-sync-duplicate-scan.ts` | `dedup/enqueue-scan.ts:142` | connector sink, CSV import |
| Duplicate-pair cleanup on archive | placed *outside* the guard | `unified-handler-mutations.ts:622-636` | all callers |
| Inventory→part deduction | bespoke post-sink pass | `data-connectors/inventory-bridge-pass.ts` | connector sink only |
| Timeline entries | **nothing** |, | not restored; sync/import writes are invisible in the record timeline by design |
| `lastActivityAt` | **nothing** |, | not restored; documented as expected at `entity-instance.ts:182-184` |

Two rows have no door. That is a deliberate accepted loss, not an oversight, but it
means **the timeline is not a complete audit log** and any feature that assumes it is
will be wrong for every synced or imported record.

---

## 7. Current call-site inventory

Every non-test `skipEvents: true` at HEAD, with contract status.

### Compliant, bulk writers that feed the manifest

| Site | Write | Compensation |
| --- | --- | --- |
| `data-connectors/sinks/entity-sink.ts:1054` | `update` | manifest captured at `:1046-1052`; `records:invalidated` at finalize |
| `data-connectors/sinks/entity-sink.ts:1062` | `create` | lifecycle captured at `:1073+` |
| `data-connectors/sinks/entity-sink.ts:1202` | `archive` | `manifest.recordArchived` at `:1210` |
| `data-connectors/sinks/row-level-writes.ts:338` | `'add'` append | covered by the sink's manifest |
| `jobs/import/execute-plan-job.ts:197` | `create` | manifest at `:147-151`; throttled `records:invalidated` at `:172-181` |
| `jobs/import/execute-plan-job.ts:280` | `update` | same |

### Caller-controlled, mirrors an inbound flag, not hard-coded

| Site | Note |
| --- | --- |
| `money/gather.ts:305`, `:405` | `skipEvents: input.publishEvents === false` |
| `money/payments/ledger.ts:292` | `skipEvents: params.publishEvents === false` |

These inherit the contract from whoever passes `publishEvents: false`. If a caller
ever sets it on a bulk path, that caller owes the manifest. Nothing enforces this.

### Seed / reshape, the documented exemption

`seed/organization-seeder.ts:447`, `seed/ai-category-tags.ts:347` & `:518`,
`packages/seed/src/domains/crm.domain.ts:643` & `:747`,
`packages/seed/src/domains/ticket.domain.ts:162`,
`packages/seed/src/domains/organization.domain.ts:135`,
`data-migrations/migrations/076-mail-category-rework.ts:65`.

Rationale on record: "no active users to notify, and each invalidation attempt costs
5s on Lambda when Redis is slow."

### Explicitly NOT passing it (documented contrast)

`dispatch/create-work-order.ts:59` and `dispatch/create-from-ticket.ts:92` both carry a
comment saying events are ON *because* the write is user-triggered. Copy that habit:
say why in a comment, in both directions.

---

## 8. Known open defects

**D1, `skipEvents` silently dropped in two seed writes.**
`packages/seed/src/domains/crm.domain.ts:897-901` and `:911-915`:

```ts
await handler.update(recordId, { contact_employer: … }, { skipEvents: true })
```

Three arguments, but the signature is `update(recordId, values, modes?, options?)`
(`unified-handler.ts:455-459`). The options object lands in the **`modes`** slot,
`skipEvents` is dropped, and these link writes fire the full fan-out during seeding.

This is the **third** recorded occurrence of the same mistake. Its history:

| | |
| --- | --- |
| Introduced | #480 `3270a3a13`, 2026-04-23, added `modes` at slot 4, pushed `options` to 5, left `bulkUpdateEntities` on the old 4-arg form |
| Latent | **98 days** defeating the #945 Pusher compensation for every bulk-update caller |
| Found by | a *typecheck* pass (#1430) restoring coverage a stale project reference had hidden, **not** by anyone observing the flood |
| Guarded by | arg-position assertions added in #1522 (`076-mail-category-rework.test.ts`) |
| Still broken | the two `crm.domain.ts` sites above |

The in-repo comment is at `unified-handler-mutations.ts:859-862`. Fix is
`…, undefined, { skipEvents: true }`.

The lesson worth generalizing: **a silently-dropped `skipEvents` is invisible.** It
fails toward *more* events, so nothing errors, nothing logs, and the only symptom is
load. Assert the argument position in tests wherever you pass it.

Note the trap is specific to `update`: `create(defId, values, options)`,
`archive(recordId, options)`, and `bulkCreate(slug, values, options)` all take options
third and are correct at every seed site.

**D2, the relationship two-pass writes with events ON and no manifest.**
`data-connectors/relationship-pass.ts:78` calls
`ctx.crud.update(parentRecordId, { [rel.fieldKey]: targetRecordId }, undefined, {})`,
an empty options object, so events fire, while the file never touches the manifest.
Combined with the pass re-asserting already-correct edges on every run, this produced
~1,200 no-op `entity:field:updated` timeline rows/day on one dev org, each attributed
to the human in `DataConnector.createdById`.

The fix is **not** to add `skipEvents` (that would make it a non-compliant silent
writer per §4) but to stop writing when nothing changed. See
`plans/data-connectors/v10/relationship-pass-idempotency-plan.md`.

**D3, no equality guard on the field-value `set` path.** Independent of
`skipEvents`, an identical write is a DELETE+INSERT (`field-value-mutations.ts:459`,
`:505`) and fires the post-hook chain unconditionally (`:2284`), `oldValue` and
`newValue` are never compared. The `'add'` path *does* dedupe and early-return
(`:1523-1542`); inverse sync *does* diff (`relationship-sync.ts:157-170`). Only the
forward `set` is unguarded. This is what makes D2 expensive rather than merely
redundant.

---

## 9. Before you add another `skipEvents: true`

A checklist, in the order the incidents happened:

1. **Is this a bulk writer?** If you are writing one record in response to a user
   action, you almost certainly want events ON. Say so in a comment, like
   `create-work-order.ts:59` does.
2. **Is it seed/reshape?** Seed writers are the only exemption. A data migration that
   reshapes rows for an org with no live users qualifies. A background job that touches
   live user data does not.
3. **Otherwise, you owe three doors:** manifest capture (record rules + dedup), a
   coarse `records:invalidated` per touched def (realtime), and an explicit decision
   about the timeline gap. Write down which ones you built and why the others don't
   apply.
4. **Check the argument slot.** `update` takes options **fifth** (fourth positional
   after `modes`). Everything else takes it third. This has silently mis-fired at
   least three times (D1, and the two fixed in `unified-handler-mutations.ts:859`,
   `:893`).
5. **Ask whether you need the flag at all.** In D2 the real defect was a write that
   should never have happened. Suppressing the event would have hidden the symptom and
   kept the wasted work, and would have broken genuine changes. *Don't suppress the
   event; suppress the write.*

---

## 10. The dangling contract reference

The B2 CONTRACT docblock cites `plans/events/b2-sync-change-manifest-plan.md, D9`.
**That file is unrecoverable.** `/plans` is gitignored (`.gitignore:25`),
`git ls-files plans/` is empty, and `plans/events/` on disk holds only
`00-event-catalog-review.md` and `01-expose-hidden-events.md`. The plan was never
committed and no blob for it exists in history.

Four other tracked files carry the same dangling reference:
`packages/database/src/db/schema/data-connector-run.ts:71`,
`record-rules/sync-manifest-collector.ts:6`, `record-rules/sync-manifest-types.ts:4`,
`events/types.ts:930`.

The surviving authority is `docs/entity-events-architecture-guide.md` §8, whose header
explicitly says it supersedes the `plans/events/` docs. **Cite the guide, not D9, in
new code.** (#1648's own commit message names this failure mode: design rationale
"lived only in `plans/`, which is gitignored, it existed on one machine and in no PR.")

---

## 11. The sibling lane: channels & mail

Mail solved the same problem, *don't let a backfill fan out per message*, with a
completely separate vocabulary. Nothing here goes through `CrudOptions`.

### The three mechanisms

| Flag | Suppresses | Declared | Consumed |
| --- | --- | --- | --- |
| `ctx.isInitialSync` | the `message:received` publish, i.e. **automations** | `ingest/context.ts:40` | `ingest/store-message.ts:1045` |
| `ctx.backfillCutoffAt` | same, but by **received time** rather than by code path | `ingest/context.ts:41-49` | `store-message.ts:1020-1023` |
| `ctx.inSyncBatch` | **realtime only** (`message:created`/`thread:created`), never automations | `ingest/context.ts:65-81` | `store-message.ts:864-865` |

Suppressing `message:received` alone takes out five subscribers:
`triggerMessageWorkflows`, `enqueueMailClassification` (the only billed one),
`ingest-bounce-message`, `applyMailFilters`, `deriveMessageSignals`.

`inSyncBatch`'s compensation is one `inbox:syncCompleted` per touched inbox plus
`markMailCountsStaleForOrgMembers` (`ingest/batch-store-messages.ts:103-118`), the
same coarse-signal pattern as `records:invalidated`, invented independently.

Adjacent but distinct: `suppress-automations` is a *user-facing mail-filter action*
(`mail-filters/engine.ts:133`), deliberately limited to the automation door,
"a filter must not be able to make mail disappear from the timeline or break bounce
handling", and it holds handler **function references, not string literals** "so a
rename can never silently stop suppressing."

### Incidents

| Date | PR | What happened |
| --- | --- | --- |
| 2026-05-26 | #683 `44a60dcce` | `inSyncBatch` + `inbox:syncCompleted` introduced. "A 5000-message backfill must not fan out 5000 socket events." |
| 2026-08-13 | #1581 `46e7c32a0` | **Over-suppression, the worst failure in either lane.** Loop guards used to *veto* the `message:received` publish, which "took out the four subscribers that have nothing to do with loops (timeline, mail filters, bounce ingest, signals) as collateral, and, worse, the own-address arm could not tell a cross-channel echo from a teammate mailing the shared inbox off their own connected mailbox, **so real human mail vanished**." Fixed by always publishing and carrying loop signals *on* the event, enforced at the dispatcher. |
| 2026-08-13 | #1585 `f9f1db180` | `backfillCutoffAt` introduced, the received-time mechanism that makes suppression independent of which walker ran. Also fixed an Outlook expired-cursor path where a full re-walk flipped initial-sync mode, causing "a silent `message:received` **blackout** for genuinely new mail arriving during recovery." |
| 2026-08-13 | #1587 `5fed80d30` | **A suppression window that never closed.** The polling scanner excluded webhook-mode rows, stranding a backfill at `MESSAGES_IMPORT_PENDING` forever, so `stampInitialBackfillCompleted` never ran and that channel's `message:received` stayed suppressed **indefinitely**. |
| 2026-08-13 | #1589 `8efddbcf5` | **The `importMessages` fix, and note what it did *not* do.** The flag is still hard-coded `false` there (`google-provider.ts:1036-1047`, `outlook-provider.ts:1765-1776`), because two-phase polling backfill routes through the same method as live import. Rather than flip a flag whose meaning is "which code path ran", the fix made suppression depend on received time. This is now **invariant 25**: *"Never gate historical-mail suppression on the ingest walker."* |
| 2026-08-18 | #1721 `ed9854856` | **Fail-open → fail-closed.** Meta DM backfill: the old `backfillCutoffAt && !initialBackfillCompletedAt` test failed *open*, so a channel connected before the stamp existed never acquired one, "backfilling it would publish `message:received` for 500+ conversations back to 2021." Now: no cutoff and no completion stamp ⇒ suppress. |
|, | migration `080` | Stamps **both** `backfillCutoffAt` and `initialBackfillCompletedAt`, because "leaving `initialBackfillCompletedAt` unset would suppress `message:received` for this channel **forever**." |

### Open gaps in this lane

- **G1, IMAP has no suppression at all.** `providers/imap/imap-provider.ts` calls only
  `setOwnIdentities` (`:133`) and `storeMessage` (`:177`), never `setInitialSyncMode`
  or `setBackfillCutoff`, and `channels/provisioning-hook.ts` stamps `backfillCutoffAt`
  only for `google`/`outlook`. A first IMAP folder scan therefore fires
  `message:received` per historical message **and** fans out one realtime publish per
  message (it never enters `inSyncBatch`).
- **G2, a manual "sync last N days" is silently treated as a backfill on Gmail.**
  `providers/google/messages/sync-messages.ts:150-152` sets initial-sync mode for
  "first-ever sync **or an explicit `since` re-list**", and `channels/sync.ts:70-78`
  takes exactly that path, so nothing an admin manually pulls in fires triggers or
  classification.
- **G3, the backfill fence has an entity-shaped hole.** `ingest/contacts/find-or-create.ts:142`
  and `ingest/companies/find-or-create.ts:31` call `handler.create` / `findOrCreate`
  with **no** `skipEvents`. So a first-connect backfill fires the full `record:created`
  fan-out, record rules, `RECORD_CREATED` workflow triggers, realtime, for every
  contact mined from historical mail, while `message:received` for that same mail is
  suppressed. **This is where the two lanes meet, and neither one owns it.** No comment
  in either file acknowledges the asymmetry.
- **G4, `thread:reopened` is not gated.** `store-message.ts:1029-1043` publishes
  unconditionally, outside the cutoff check at `:1045`, reaching realtime and outbound
  webhooks. Narrow in practice (needs a personal inbox, an ARCHIVED thread, an INBOX
  label) but a real hole.
- **Stale doc:** `docs/channels-mail-architecture-guide.md:539-540` says "only Outlook
  wires it so far, Gmail's polling path still has the walker-based hole." Gmail was
  wired ten minutes after that doc commit landed (`provisioning-hook.ts:355-370`,
  `google-provider.ts:181-182`) and the line was never updated.

---

## 12. Key files

| What | Where |
| --- | --- |
| The flag + B2 contract docblock | `packages/lib/src/resources/crud/unified-handler-mutations.ts:44-62` |
| Where it becomes `publishEvents` | `packages/lib/src/resources/crud/unified-handler.ts:1209` |
| The post-hook gate it flips | `packages/lib/src/field-values/field-value-mutations.ts:2178-2181` |
| Global `'*'` hooks it silences | `packages/lib/src/field-hooks/register-hooks.ts:100-104` |
| Manifest collector | `packages/lib/src/record-rules/sync-manifest-collector.ts` |
| Manifest consumers | `packages/lib/src/events/handlers/handle-sync-record-rules.ts`, `handle-sync-duplicate-scan.ts` |
| Coarse realtime event | `packages/lib/src/realtime/events.ts:137-150` |
| Mechanism reference | `docs/entity-events-architecture-guide.md` §7–§8 |
| Connector sync path | `docs/data-connectors-architecture-guide.md` §"Applies per-field merge strategy" |
| Dedup interaction | `docs/duplicate-detection-architecture-guide.md` §379, §629-631, §714 |

### Mail lane (§11)

| What | Where |
| --- | --- |
| The three flags | `packages/lib/src/ingest/context.ts:40`, `:41-49`, `:65-81` |
| Where they're honored | `packages/lib/src/ingest/store-message.ts:1020-1023`, `:1045`, `:864-865` |
| Batch realtime + compensation | `packages/lib/src/ingest/batch-store-messages.ts:44-49`, `:103-118` |
| Cutoff stamping at connect | `packages/lib/src/channels/provisioning-hook.ts:321`, `:366` |
| Window close | `packages/lib/src/jobs/polling/messages-import-job.ts:39-55` |
| User-facing suppression action | `packages/lib/src/mail-filters/engine.ts:133`, `events/handlers/apply-mail-filters.ts:34-63` |
| Mechanism reference | `docs/channels-mail-architecture-guide.md`, **invariant 25** |
