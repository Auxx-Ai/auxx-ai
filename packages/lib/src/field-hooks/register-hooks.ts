// packages/lib/src/field-hooks/register-hooks.ts

import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import { registerAutoBuildRules } from '../builds/auto-build-rule'
import {
  stampOrderAfterLineDelete,
  stampOrderOnLineChange,
  stampOrderOnOrderChange,
} from '../builds/drift-hooks'
import { registerOrderDriftReconcilers } from '../builds/drift-reconciler'
import {
  ensureVisitOnWorkOrderCreate,
  syncVisitPinsOnAddressNormalized,
} from '../dispatch/visit-hooks'
import {
  normalizeAddressOnChange,
  registerAddressNormalizedListener,
} from '../geocoding/address-normalize-hook'
import { generateDraftOnCompletion } from '../money/auto-invoice'
import {
  BILLING_PROJECTION_ATTRS,
  guardAllocatedLineDelete,
  guardAllocatedSourceLineChange,
  guardBillingConfiguration,
  guardBillingProjectionWrite,
  syncBillingAfterInvoiceDelete,
  syncBillingAfterLineDelete,
  syncBillingOnInvoiceChange,
  syncBillingOnLineChange,
  syncBillingOnWorkOrderChange,
  syncContactAfterWorkOrderDelete,
} from '../money/billing-hooks'
import { registerBillingReconcilers } from '../money/billing-reconciler'
import {
  pauseMarkupOnPriceEdit,
  recomputePriceOnMarkupChange,
  syncCatalogCostOnPartChange,
} from '../money/catalog-pricing'
import {
  recomputeOnInvoiceBillingChange,
  recomputeOnLineChange,
  recomputeOnOrderBillingChange,
  recomputeOnPurchaseOrderBillingChange,
  recomputeOnPurchaseOrderLineChange,
  recomputeOnQuoteBillingChange,
} from '../money/totals-hooks'
import { registerMoneyTotalsReconcilers } from '../money/totals-reconciler'
import { derivePhoneGeoOnChange, warmPhoneGeo } from '../phone-geo'
import {
  rematchAfterBillLineDelete,
  rematchOnBillChange,
  rematchOnBillLineChange,
} from '../purchasing/match-hook'
import { registerMatchReconcilers } from '../purchasing/match-reconciler'
import { handleRecordRulesOnFieldChange } from '../record-rules/hook-handler'
import {
  enqueueQuickbooksInvoiceSyncOnSent,
  enrollInvoiceReminderOnSent,
  enrollJobFollowUpOnCompletion,
  reanchorInvoiceOnDueDateChange,
} from '../sequences/field-change-hooks'
import { invalidateInboxCacheOnFieldChange } from './post/inbox-cache-invalidation'
import { stampPartOnCatalogItemChange } from './post/line-item-part-stamp'
import { publishFieldChangeEvent } from './post/publish-field-change-event'
import { prefillContactOnVendorChange } from './post/purchase-order-contact-prefill'
import { touchActivityOnFieldChange } from './post/touch-activity-on-field-change'
import { guardManualBuildLifecycleStatus } from './pre/build-status-guard'
import { guardInboxOwnerField } from './pre/inbox-owner-guard'
import { guardInvoiceDelete } from './pre/invoice-delete-guard'
import {
  guardManualInvoiceLifecycleStatus,
  guardManualQuoteLifecycleStatus,
} from './pre/lifecycle-status-guard'
import { cascadeOrderLinesOnDelete } from './pre/order-delete-guard'
import {
  EVIDENCE_LOCKED_LINE_ATTRS,
  guardEvidenceLockedLineFields,
} from './pre/purchase-order-line-evidence-lock'
import { guardManualPurchaseOrderIssued } from './pre/purchase-order-status-guard'
import { guardQuoteConvertedDelete } from './pre/quote-delete-guard'
import { guardQuoteDraftReturnWithPaidDeposit } from './pre/quote-deposit-guard'
import { rejectDeleteIfTagInUse } from './pre/tag-in-use-guard'
import {
  dropUnauthorizedSystemFlag,
  rejectDeleteIfSystemTag,
  rejectIfSystemTag,
} from './pre/tag-system-guard'
import { dropUnauthorizedTemplateKey, rejectDeleteIfTemplateTag } from './pre/tag-template-guard'
import { guardWorkOrderDelete } from './pre/work-order-delete-guard'
import {
  registerEntityFieldChangeHooks,
  registerEntityPostDeleteHooks,
  registerEntityPreDeleteHooks,
  registerFieldPreHooks,
  registerFieldTypeChangeHooks,
} from './registry'
import { registerEntitySystemRules } from './system-entity-rules'
import { registerFieldSystemRules } from './system-record-rules'

/**
 * Register all field and entity hooks (pre + post).
 * Called once at startup (e.g., from the worker entry point).
 */
export function registerAllHooks(): void {
  // ---------------------------------------------------------------------------
  // POST-WRITE TRIGGERS
  // ---------------------------------------------------------------------------

  // BOM cost / stock-status FIELD triggers migrated onto the record-rules engine as
  // server-declared system rules with native actions (B2 §8). Declared + handlers
  // registered here so both web and worker see them once the bootstrap runs.
  registerFieldSystemRules()

  // BOM cost / stock explode+QoH / company enrichment ENTITY triggers migrated onto the
  // record-rules engine as lifecycle system rules with native actions (B2 §9). They now
  // dispatch through door 2 (`handleRecordRules`) + the manifest consumer, so they gain
  // sync/import visibility for free. Replaces the deleted ENTITY_TRIGGERS registry.
  registerEntitySystemRules()

  // The order-triggered build (plans/products/12-order-triggered-build.md, AB2/AB6): two
  // more code-declared system rules on the NATIVE `orders` def — one lifecycle rule that
  // raises a `planned` build per ordered part on create, and one field rule that cancels or
  // REVERSES those builds when `order_cancelled_at` is set. Nothing is ever deleted (AB6).
  // Both handlers swallow their own failures; the module's top-level imports stay light and
  // everything heavy is lazy-imported inside the wrappers.
  registerAutoBuildRules()

  // The totals engine's six drains (plan 08 phase 2). The hooks registered below
  // only MARK; without this nothing recomputes a document, so these two must stay
  // in the same bootstrap.
  registerMoneyTotalsReconcilers()

  // The three-way match's two drains. Same rule as above: the bill and bill-line
  // hooks only MARK, so without this nothing re-matches.
  registerMatchReconcilers()

  // The billing projectors' four drains. Same rule again: the six billing hooks
  // below only MARK, so without this nothing rebuilds a projection.
  registerBillingReconcilers()

  // The order-demand drift stamp's two drains (plans/products/13 Model A+). The
  // hooks below only MARK, so without this an order's fingerprint goes stale —
  // which is a drift signal that lies. Writes one field on the ORDER and never
  // touches a build.
  registerOrderDriftReconcilers()

  // Field-change post-hook — fires `<prefix>:field:updated` after every field
  // write. Registered globally so contacts, tickets, companies, and custom
  // entities all produce timeline entries.
  // handleRecordRulesOnFieldChange dispatches org-configured RecordRules (it
  // no-ops fast when the org has none and lazy-imports its own internals).
  registerEntityFieldChangeHooks('*', [
    publishFieldChangeEvent,
    touchActivityOnFieldChange,
    handleRecordRulesOnFieldChange,
  ])

  // Inbox cache coherence (mail-permissions §7.1): the generic records path
  // (form edits, Kopilot record tools, workflow CRUD) bypasses InboxService
  // and emitted no cache events — any inbox field write now busts
  // `org:inboxes`, and lens changes recompute every member's visibility.
  //
  // Registered by apiSlug, so the `personal_inbox` def (plan 40 §3, apiSlug
  // `personal-inboxes`) needs its own line — personal mailboxes feed the same
  // `org:inboxes` cache and the same per-member `userInstanceGrants`. Only this
  // POST hook is shared: the `inbox_default_lens` PRE hook below is deliberately
  // NOT registered for `personal-inboxes`, because the new def has no lens field
  // (personal inboxes have no floor — 40a §1.2).
  registerEntityFieldChangeHooks('inboxes', [invalidateInboxCacheOnFieldChange])
  registerEntityFieldChangeHooks('personal-inboxes', [invalidateInboxCacheOnFieldChange])

  // Dispatch (plans/dispatch §H.1): auto-create the unscheduled WorkOrderVisit row the
  // instant a work order is created, on every create path. Keyed off the first write of
  // work_order_number (§F.4a's hook is the only writer, fires exactly once per create).
  //
  // Money MI2 build spec §E (Q3a+Q3i): generate an `on_completion` draft invoice the instant
  // `work_order_status` lands on `completed`/`ended` — catches the visit roll-up, M2c's
  // `endEngagement`, kanban drags, and manual drawer edits, all through this one hook.
  //
  // `registerEntityFieldChangeHooks` appends per-call (registry.ts:137-144), so this could
  // also be separate calls — combined into one array here since all these handlers share
  // the 'work-orders' slug and read more naturally listed together.
  //
  // Client-notifications plan §4.3: enroll the seeded `job_follow_up` sequence on the same
  // completion door (`enrollJobFollowUpOnCompletion` — independent handler, no recursion risk,
  // never writes `work_order_status` itself).
  //
  // (Route planner item 8's visit-pin geocode used to be a third handler here — it now rides
  // the ADDRESS_STRUCT normalize hook via `registerAddressNormalizedListener` below.)
  registerEntityFieldChangeHooks('work-orders', [
    ensureVisitOnWorkOrderCreate,
    generateDraftOnCompletion,
    enrollJobFollowUpOnCompletion,
    syncBillingOnWorkOrderChange,
  ])

  // Money totals engine (money MQ1 build spec §F.2, generalized to invoices in MI1 build
  // spec §G.1): recompute the mirrored subtotal/tax_total/total whenever a line's
  // qty/unitPrice/taxable/discount or its quote/work_order/invoice rel changes, or whenever
  // the quote's or invoice's own billing fields (discount type/value, tax rate) change.
  // Keyed by apiSlug — line_item's is 'line-items', quote's is 'quotes', invoice's is
  // 'invoices'.
  // ⚠️ `stampPartOnCatalogItemChange` is the SECOND door for the 08 §6.2 stamp. The system
  // hook in `resources/hooks/line-item-hooks.ts` only fires for writes through
  // `UnifiedCrudHandler` — how the LineBuilder ADDS a line. Every EDIT goes through
  // `fieldValue.set` → `FieldValueService`, which never reads the system-hook registry, so
  // re-pointing a line at another catalog item reaches only this handler. Verified against
  // the running app: without it, a re-point left `line_item_part` NULL.
  registerEntityFieldChangeHooks('line-items', [
    recomputeOnLineChange,
    syncBillingOnLineChange,
    stampPartOnCatalogItemChange,
    // Model A+ (plans/products/13): a line's part, quantity or parent order
    // moved, so what the order asks production for may have moved with it.
    stampOrderOnLineChange,
  ])
  registerEntityFieldChangeHooks('quotes', [recomputeOnQuoteBillingChange])
  registerEntityFieldChangeHooks('orders', [recomputeOnOrderBillingChange, stampOrderOnOrderChange])

  // Buy-side totals engine (plans/purchasing/01-build-plan.md §4.1/§4.2). Same engine, a
  // different line entity and a different header shape — both named in
  // `DOCUMENT_TOTALS_SPECS` rather than branched on. `purchase_order_subtotal`,
  // `purchase_order_total` and `purchase_order_line_line_total` are all `creatable: false`,
  // so these two registrations are their ONLY writers.
  // 🛑 `vendor-bills` is deliberately absent: a bill's totals are TRANSCRIBED from the
  // supplier's document (01 §5.4b). Recomputing them would silently correct the vendor's
  // arithmetic — the exact discrepancy the three-way match exists to surface.
  registerEntityFieldChangeHooks('purchase-order-lines', [recomputeOnPurchaseOrderLineChange])
  // ⚠️ `prefillContactOnVendorChange` is the SECOND door for the vendor -> contact default
  // (purchasing plan 07). The `purchase_order_vendor` system hook in
  // `resources/hooks/purchasing-hooks.ts` fires only for writes through
  // `UnifiedCrudHandler`, which is how an order is first drafted; re-pointing an existing
  // order at a different supplier goes through `fieldValue.set` and reaches only this
  // handler. It is also the only one of the two given `oldValue`, so it owns the rule that
  // replaces this hook's own prefill without ever discarding a human's pick.
  registerEntityFieldChangeHooks('purchase-orders', [
    recomputeOnPurchaseOrderBillingChange,
    prefillContactOnVendorChange,
  ])

  // The three-way match (plans/purchasing/01-build-plan.md §6.2). `vendor_bill_status`,
  // `_match_variance` and `_match_notes` all declare the match hook as their only writer,
  // so these registrations are what make the exception queue anything other than empty.
  // The bill's own totals are NOT recomputed here — they are transcribed (01 §5.4b).
  registerEntityFieldChangeHooks('vendor-bills', [rematchOnBillChange])
  registerEntityFieldChangeHooks('vendor-bill-lines', [rematchOnBillLineChange])
  //
  // Client-notifications plan §4.3: enroll the seeded `invoice_reminders` sequence on the
  // draft→sent transition (`enrollInvoiceReminderOnSent` checks the PREVIOUS value so a
  // payment-deletion paid→sent reversal does NOT re-enroll, decision #12), and re-anchor any
  // parked reminder wait when `invoice_due_date` changes (`reanchorInvoiceOnDueDateChange` —
  // required, not just an accelerator: it's the only path that can move an already-parked wait).
  //
  // QuickBooks invoice sync (plans/dispatch/37e-quickbooks-invoice-sync.md §3, P3):
  // `enqueueQuickbooksInvoiceSyncOnSent` rides the same draft→sent door, enqueuing the mirror
  // job (gated by `quickbooks.syncInvoices`) rather than syncing inline.
  registerEntityFieldChangeHooks('invoices', [
    recomputeOnInvoiceBillingChange,
    enrollInvoiceReminderOnSent,
    reanchorInvoiceOnDueDateChange,
    enqueueQuickbooksInvoiceSyncOnSent,
    syncBillingOnInvoiceChange,
  ])

  // Part cost sync + markup pricing (money plan 17 §3) — the three interactive
  // triggers: linking/unlinking a part syncs (or clears) `cost`; setting a markup
  // recomputes `price`; hand-editing `price` clears markup (the pause switch). All
  // writes go through the hook-free writer in `catalog-pricing.ts`, so these can never
  // recurse into each other. The bulk-recalc ripple (vendor price / BOM composition
  // changes) chains in separately at the end of `recalculateAllPartCosts` /
  // `recalculateAffectedParts` (`bom/cost-calculator.ts`), not through this door.
  registerEntityFieldChangeHooks('catalog-items', [
    syncCatalogCostOnPartChange,
    recomputePriceOnMarkupChange,
    pauseMarkupOnPriceEdit,
  ])

  // Address field (plans/address-field/01-single-input-address-field.md §5 items 2-3,
  // decision #5/#13): field-type-keyed (NOT entity-scoped) so it runs for every ADDRESS_STRUCT
  // field on every entity without flipping `hasEntityFieldChangeHooks` on for entities that have
  // no address fields.
  registerFieldTypeChangeHooks(FieldTypeEnum.ADDRESS_STRUCT, [normalizeAddressOnChange])

  // Phone geo derivation — same field-type-keyed reasoning as the address hook above: one
  // registration covers every PHONE_INTL field on every entity, so SMS ingest, panel edits, CSV
  // import, connector sync and Kopilot all get it from a single door. Fills only BLANK
  // city/region/country/timezone (chat's visitor-IP geo and human input both outrank an area
  // code), and no-ops on entities that have no such fields. Unlike the address hook this needs
  // no fire-and-forget — the lookup is an in-memory table read, not a MapTiler call.
  registerFieldTypeChangeHooks(FieldTypeEnum.PHONE_INTL, [derivePhoneGeoOnChange])
  // Deserialize the geocoding tables now rather than on the first phone write. Co-located with
  // the registration so the warm can never drift away from the hook that needs it; the worker
  // additionally calls this at boot. Idempotent and never throws.
  warmPhoneGeo()

  // Route planner build contract item 8 (09-route-planner.md §B): pin the work order's visit
  // row(s) whenever its address geocodes — unscheduled backlog jobs need pins too. Rides the
  // normalize hook's geocode via the listener seam instead of an entity-scoped hook making its
  // own MapTiler call, retiring the v1 double-geocode on `work_order_address` writes
  // (plans/address-field §9 follow-up 2).
  registerAddressNormalizedListener(syncVisitPinsOnAddressNormalized)

  // ---------------------------------------------------------------------------
  // PRE-WRITE HOOKS
  // ---------------------------------------------------------------------------

  // System tag guard — makes seeded tags read-only for end users.
  // - is_system_tag: drop any write that isn't bypassed by the seeder.
  // - title / description / emoji / color / parent: reject edits when the
  //   record's is_system_tag is true.
  // - pre-delete: reject deletes of system tags.
  // Personal-inbox OWNER wall (§11) — system paths stamp it; user writes are
  // org-admin only. Registered on BOTH defs: `inbox_owner_user_id` survives on
  // `personal_inbox` (40a §1.2), and the fieldValue router's
  // `assertAdminInstance` is not a substitute there — the mailbox's owner holds
  // the `admin` row by construction, so that gate passes for exactly the person
  // this wall stops.
  //
  // Plan 40 phase 4 removed two sibling registrations here:
  //  - `inbox_is_personal` — the field is gone; personal-ness is `personal_inbox`
  //    def membership, which no field write can flip.
  //  - `inbox_default_lens` (`guardInboxDefaultLens`) — the field is gone; the
  //    floor is a `role:org_member` row and its two gates travelled with the
  //    write (`inbox.setAccessFloor` → `requireInboxManageAccess`, and
  //    `assertInboxFloorFeature` for the Enterprise sub-`full` paywall). That
  //    hook's `hasAnyManager` carve-out existed because `createInbox` wrote the
  //    floor BEFORE granting the creator their Manager row; `createInbox` now
  //    writes the floor row AFTER `setInstanceAccess`, so the ordering problem
  //    is structural rather than papered over by a guard exemption.
  registerFieldPreHooks('inboxes', 'inbox_owner_user_id', [guardInboxOwnerField])
  registerFieldPreHooks('personal-inboxes', 'inbox_owner_user_id', [guardInboxOwnerField])

  // Lifecycle status walls for `quote_status` and `invoice_status`
  // (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §4). The system-hook twins
  // in `resources/hooks/quote-hooks.ts` / `invoice-hooks.ts` cover `record.create` /
  // `record.update`, the CSV importer and the SDK; these cover every interactive edit —
  // drawer, grid inline edit, kanban drag, Kopilot record tools — because those all write
  // through `fieldValue.set` -> `FieldValueService`, which never reads the system-hook
  // registry. Until these two registrations existed, an invoice could be typed to `paid` with
  // no payment behind it and a quote to `sent` without its request ever being mirrored.
  //
  // Every sanctioned writer names its attribute in `bypassFieldGuards`, which
  // `fireFieldPreHooks` honours before reaching these handlers: `markQuoteSent` /
  // `approveQuote` / `declineQuote` for the quote, and `markInvoiceSent` / `voidInvoice` /
  // `syncInvoicePaymentState` (the ledger projection — the only writer of `paid`) for the
  // invoice. 🛑 A new sanctioned writer means a new bypass, not a weaker guard.
  //
  // ⚠️ ORDER IS COST, not semantics. The two quote guards are disjoint by value — this one
  // walls `sent`/`approved`, the deposit wall walls `-> draft` — so either order behaves the
  // same; the in-memory membership test runs first so the deposit wall's query is only spent
  // on a write that could actually trip it.
  //
  // Return-to-draft wall (money MP2 §B.10): the deposit guard is here for the same reason,
  // and had been here alone — inert, because it compared the coerced option envelope to a
  // bare string (21 §2).
  registerFieldPreHooks('quotes', 'quote_status', [
    guardManualQuoteLifecycleStatus,
    guardQuoteDraftReturnWithPaidDeposit,
  ])
  registerFieldPreHooks('invoices', 'invoice_status', [guardManualInvoiceLifecycleStatus])

  for (const attribute of BILLING_PROJECTION_ATTRS) {
    const entitySlug = attribute.startsWith('work_order_')
      ? 'work-orders'
      : attribute.startsWith('invoice_')
        ? 'invoices'
        : 'contacts'
    registerFieldPreHooks(entitySlug, attribute, [guardBillingProjectionWrite])
  }
  registerFieldPreHooks('work-orders', 'work_order_pricing_model', [guardBillingConfiguration])
  registerFieldPreHooks('work-orders', 'work_order_invoice_timing', [guardBillingConfiguration])
  for (const attribute of [
    'line_item_qty',
    'line_item_unit_price',
    'line_item_discount',
    'line_item_work_order',
    'line_item_visit_id',
  ] as const) {
    registerFieldPreHooks('line-items', attribute, [guardAllocatedSourceLineChange])
  }

  // Manual-`issued` wall for `purchase_order_status` (§3.4). The system-hook twin in
  // `resources/hooks/purchasing-hooks.ts` covers `record.create`/`record.update`, the CSV
  // importer and the SDK; this one covers every interactive edit — drawer, grid inline edit,
  // kanban drag — because those all write through `fieldValue.set` -> `FieldValueService`,
  // which never reads the system-hook registry. Without this registration `issued` is
  // typeable by hand and the plan's claim that it is action-set is false.
  //
  // Both sanctioned writers of the `-> issued` transition pass
  // `bypassFieldGuards: ['purchase_order_status']`, which `fireFieldPreHooks` honours before
  // reaching this handler: `markPurchaseOrderSent` (Send) and `derivePurchaseOrderStatuses`
  // (§6.1's receipt pull-forward).
  registerFieldPreHooks('purchase-orders', 'purchase_order_status', [
    guardManualPurchaseOrderIssued,
  ])

  // Manual-`in_progress`/`completed`/`canceled` wall for `build_status`. The build subsystem
  // enforced its transitions inside `startBuild` / `completeBuild` / `cancelBuild` /
  // `reverseBuild` via `assertBuildStatus`, which is a DIFFERENT door: a drawer edit, a grid
  // inline edit, a kanban drag or a Kopilot record tool writes through `fieldValue.set` ->
  // `FieldValueService` and reaches none of them. Until this registration existed,
  // `build_status: 'completed'` was typeable by hand — a finished production run with no
  // movements, no costs and no variance, believed by every downstream read.
  //
  // All five sanctioned writers pass `bypassFieldGuards: ['build_status']` through their
  // `UnifiedCrudHandler`, which forwards it to the `FieldValueService` it owns: `createBuild`,
  // `startBuild`, `cancelBuild` (`builds/build-mutations.ts`), `completeBuild`
  // (`builds/complete-build.ts`) and `reverseBuild` (`builds/reverse-build.ts`).
  // 🛑 A new sanctioned writer means a new bypass, not a weaker guard.
  //
  // 🛑 NO system-hook twin, unlike the other three — see `resources/hooks/build-hooks.ts`.
  // System hooks do not consult `bypassFieldGuards`, and the three build writers that write
  // status on an UPDATE go through `UnifiedCrudHandler.runPreHooks`, so a twin would refuse
  // Start, Complete and Cancel while adding no coverage this registration lacks.
  registerFieldPreHooks('builds', 'build_status', [guardManualBuildLifecycleStatus])

  // Purchase order line evidence lock (plans/purchasing/07-purchase-order-send-and-status.md
  // §6.5) — a line's agreed quantity and price freeze once a receipt or a vendor bill line
  // has been booked against it, at ANY order status.
  //
  // 🛑 Registered on the FIELD pre-hook chain, not the system-hook registry, for the reason
  // `quote-deposit-guard.ts` already documents for `quote_status`: every real edit to these
  // fields goes through `fieldValue.set` → `FieldValueService` (the LineBuilder's
  // `useSaveFieldValue` is the only editing surface), which never reads the system-hook
  // registry. A `PURCHASE_ORDER_LINE_HOOKS` entry would have been a lock that never fires.
  // This chain covers the CRUD path too — `UnifiedCrudHandler.setFieldValues` writes through
  // `FieldValueService`, so the importer and Kopilot reach it as well.
  for (const attribute of EVIDENCE_LOCKED_LINE_ATTRS) {
    registerFieldPreHooks('purchase-order-lines', attribute, [guardEvidenceLockedLineFields])
  }

  registerFieldPreHooks('tags', 'is_system_tag', [dropUnauthorizedSystemFlag])
  registerFieldPreHooks('tags', 'title', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_description', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_emoji', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_color', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_parent', [rejectIfSystemTag])
  // Seeded mail-category guard (plans/mail-filter/06-mail-categories-rework-plan.md §3.2).
  // A `tag_template_key` marks a shipped category: undeletable, but fully editable —
  // deliberately NO `rejectIfSystemTag`-style freeze on title/description/emoji/color/parent,
  // because the description is the classifier's instruction (D4/D5).
  // The drop hook is what actually enforces invariant 2 (the field's
  // `capabilities.updatable: false` is not read by the write path).
  registerFieldPreHooks('tags', 'tag_template_key', [dropUnauthorizedTemplateKey])
  // ⚠️ ORDER IS THE MESSAGE. The two "never, by anyone" guards run first and throw
  // 403; only then does the in-use check throw 409. A system tag that also carries
  // 500 threads must be refused as a system tag, not told to untag itself first —
  // clearing the references would not make it deletable.
  registerEntityPreDeleteHooks('tags', [
    rejectDeleteIfSystemTag,
    rejectDeleteIfTemplateTag,
    rejectDeleteIfTagInUse,
  ])

  // Money delete-safety (plans/dispatch/money/12-delete-safety.md §A/§C/§F) — moves the
  // invoice/work-order guard+cleanup logic out of the client-only drawer branch and into the
  // sanctioned hook point, so generic `record.delete`/`bulkDelete`, the drawer, and any future
  // Kopilot/API caller all get the same safety net.
  registerEntityPreDeleteHooks('invoices', [guardInvoiceDelete])
  registerEntityPreDeleteHooks('line-items', [guardAllocatedLineDelete])
  registerEntityPreDeleteHooks('work-orders', [guardWorkOrderDelete])
  registerEntityPreDeleteHooks('quotes', [guardQuoteConvertedDelete])
  // Orders own their lines outright (08 §5.4) — no guard, just the cascade.
  registerEntityPreDeleteHooks('orders', [cascadeOrderLinesOnDelete])

  // Billing projections after deletes (plan 24 §4.6) — deletes fire no field-change hooks, so
  // these are the explicit post-cleanup projector calls for every delete path (generic
  // `record.delete`, bulk delete, Kopilot/API), not just the money lifecycle commands.
  // Deleting a bill line removes the reason the bill was an exception; without this the
  // bill sits in the queue forever for a line that no longer exists.
  registerEntityPostDeleteHooks('vendor-bill-lines', [rematchAfterBillLineDelete])
  registerEntityPostDeleteHooks('invoices', [syncBillingAfterInvoiceDelete])
  registerEntityPostDeleteHooks('line-items', [
    syncBillingAfterLineDelete,
    stampOrderAfterLineDelete,
  ])
  registerEntityPostDeleteHooks('work-orders', [syncContactAfterWorkOrderDelete])
}
