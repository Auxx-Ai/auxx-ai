// packages/lib/src/field-hooks/register-hooks.ts

import { registerInventoryDeductionRule } from '../data-connectors/inventory-bridge-rule-action'
import { ensureVisitOnWorkOrderCreate, geocodeOnAddressChange } from '../dispatch/visit-hooks'
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
import {
  recomputeOnInvoiceBillingChange,
  recomputeOnLineChange,
  recomputeOnQuoteBillingChange,
} from '../money/totals-hooks'
import { handleRecordRulesOnFieldChange } from '../record-rules/hook-handler'
import {
  enrollInvoiceReminderOnSent,
  enrollJobFollowUpOnCompletion,
  reanchorInvoiceOnDueDateChange,
} from '../sequences/field-change-hooks'
import { invalidateInboxCacheOnFieldChange } from './post/inbox-cache-invalidation'
import { publishFieldChangeEvent } from './post/publish-field-change-event'
import { touchActivityOnFieldChange } from './post/touch-activity-on-field-change'
import { guardInboxDefaultLens } from './pre/inbox-lens-guard'
import { guardInboxPersonalFields } from './pre/inbox-personal-guard'
import { guardInvoiceDelete } from './pre/invoice-delete-guard'
import { guardQuoteConvertedDelete } from './pre/quote-delete-guard'
import { guardQuoteDraftReturnWithPaidDeposit } from './pre/quote-deposit-guard'
import {
  dropUnauthorizedSystemFlag,
  rejectDeleteIfSystemTag,
  rejectIfSystemTag,
} from './pre/tag-system-guard'
import { guardWorkOrderDelete } from './pre/work-order-delete-guard'
import {
  registerEntityFieldChangeHooks,
  registerEntityPostDeleteHooks,
  registerEntityPreDeleteHooks,
  registerFieldPreHooks,
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

  // v9 inventory→part deduction: the `deductInventory` native action fired by the managed
  // inventory rule(s). Registered here so both web + worker resolve the handler once the
  // field-hooks bootstrap runs (the engine self-inits this on a first handler miss).
  registerInventoryDeductionRule()

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
  registerEntityFieldChangeHooks('inboxes', [invalidateInboxCacheOnFieldChange])

  // Dispatch (plans/dispatch §H.1): auto-create the unscheduled WorkOrderVisit row the
  // instant a work order is created, on every create path. Keyed off the first write of
  // work_order_number (§F.4a's hook is the only writer, fires exactly once per create).
  //
  // Money MI2 build spec §E (Q3a+Q3i): generate an `on_completion` draft invoice the instant
  // `work_order_status` lands on `completed`/`ended` — catches the visit roll-up, M2c's
  // `endEngagement`, kanban drags, and manual drawer edits, all through this one hook.
  //
  // Route planner build contract item 8 (09-route-planner.md §B): geocode the work order's
  // address the instant it's set (create AND update), writing straight onto its visit row(s) —
  // unscheduled backlog jobs need pins too, not just scheduled ones.
  //
  // `registerEntityFieldChangeHooks` appends per-call (registry.ts:137-144), so this could
  // also be a second/third call — combined into one array here since all three handlers share
  // the 'work-orders' slug and read more naturally listed together.
  //
  // Client-notifications plan §4.3: enroll the seeded `job_follow_up` sequence on the same
  // completion door (`enrollJobFollowUpOnCompletion` — independent handler, no recursion risk,
  // never writes `work_order_status` itself).
  registerEntityFieldChangeHooks('work-orders', [
    ensureVisitOnWorkOrderCreate,
    generateDraftOnCompletion,
    geocodeOnAddressChange,
    enrollJobFollowUpOnCompletion,
    syncBillingOnWorkOrderChange,
  ])

  // Money totals engine (money MQ1 build spec §F.2, generalized to invoices in MI1 build
  // spec §G.1): recompute the mirrored subtotal/tax_total/total whenever a line's
  // qty/unitPrice/taxable/discount or its quote/work_order/invoice rel changes, or whenever
  // the quote's or invoice's own billing fields (discount type/value, tax rate) change.
  // Keyed by apiSlug — line_item's is 'line-items', quote's is 'quotes', invoice's is
  // 'invoices'.
  registerEntityFieldChangeHooks('line-items', [recomputeOnLineChange, syncBillingOnLineChange])
  registerEntityFieldChangeHooks('quotes', [recomputeOnQuoteBillingChange])
  //
  // Client-notifications plan §4.3: enroll the seeded `invoice_reminders` sequence on the
  // draft→sent transition (`enrollInvoiceReminderOnSent` checks the PREVIOUS value so a
  // payment-deletion paid→sent reversal does NOT re-enroll, decision #12), and re-anchor any
  // parked reminder wait when `invoice_due_date` changes (`reanchorInvoiceOnDueDateChange` —
  // required, not just an accelerator: it's the only path that can move an already-parked wait).
  registerEntityFieldChangeHooks('invoices', [
    recomputeOnInvoiceBillingChange,
    enrollInvoiceReminderOnSent,
    reanchorInvoiceOnDueDateChange,
    syncBillingOnInvoiceChange,
  ])

  // ---------------------------------------------------------------------------
  // PRE-WRITE HOOKS
  // ---------------------------------------------------------------------------

  // System tag guard — makes seeded tags read-only for end users.
  // - is_system_tag: drop any write that isn't bypassed by the seeder.
  // - title / description / emoji / color / parent: reject edits when the
  //   record's is_system_tag is true.
  // - pre-delete: reject deletes of system tags.
  // Inbox floor wall (mail-permissions §7.1) — only managers may change the
  // floor, and sub-`full` floors are enterprise-gated. This hook is the
  // actual enforcement; the inbox form / InboxService are just ergonomics.
  registerFieldPreHooks('inboxes', 'inbox_default_lens', [guardInboxDefaultLens])

  // Personal-inbox marker wall (§11) — system paths stamp these; user writes
  // are admin-only (claim/convert).
  registerFieldPreHooks('inboxes', 'inbox_is_personal', [guardInboxPersonalFields])
  registerFieldPreHooks('inboxes', 'inbox_owner_user_id', [guardInboxPersonalFields])

  // Return-to-draft wall (money MP2 §B.10) — `rejectManualLifecycleStatus`
  // (`resources/hooks/quote-hooks.ts`) is dead for real client writes to
  // `quote_status` (the generic records path never runs the system-hook
  // chain), so the deposit guard lives here instead, on the field-pre-hook
  // chain that actually runs.
  registerFieldPreHooks('quotes', 'quote_status', [guardQuoteDraftReturnWithPaidDeposit])

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

  registerFieldPreHooks('tags', 'is_system_tag', [dropUnauthorizedSystemFlag])
  registerFieldPreHooks('tags', 'title', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_description', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_emoji', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_color', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_parent', [rejectIfSystemTag])
  registerEntityPreDeleteHooks('tags', [rejectDeleteIfSystemTag])

  // Money delete-safety (plans/dispatch/money/12-delete-safety.md §A/§C/§F) — moves the
  // invoice/work-order guard+cleanup logic out of the client-only drawer branch and into the
  // sanctioned hook point, so generic `record.delete`/`bulkDelete`, the drawer, and any future
  // Kopilot/API caller all get the same safety net.
  registerEntityPreDeleteHooks('invoices', [guardInvoiceDelete])
  registerEntityPreDeleteHooks('line-items', [guardAllocatedLineDelete])
  registerEntityPreDeleteHooks('work-orders', [guardWorkOrderDelete])
  registerEntityPreDeleteHooks('quotes', [guardQuoteConvertedDelete])

  // Billing projections after deletes (plan 24 §4.6) — deletes fire no field-change hooks, so
  // these are the explicit post-cleanup projector calls for every delete path (generic
  // `record.delete`, bulk delete, Kopilot/API), not just the money lifecycle commands.
  registerEntityPostDeleteHooks('invoices', [syncBillingAfterInvoiceDelete])
  registerEntityPostDeleteHooks('line-items', [syncBillingAfterLineDelete])
  registerEntityPostDeleteHooks('work-orders', [syncContactAfterWorkOrderDelete])
}
