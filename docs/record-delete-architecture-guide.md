<!-- docs/record-delete-architecture-guide.md -->

# Record Delete & Relationship Ownership Guide

What happens to the other side of a relationship when a record is hard-deleted,
where that answer is declared, and how the delete engine executes it without
touching rows one at a time.

Built from `plans/relationships/01-delete-semantics.md` on 2026-09-08. Archive
(soft delete) is a separate question and is deliberately not covered here.

---

## 1. The model in one paragraph

A relationship in auxx is two mirror `FieldValue` rows, one on each record, with
no foreign key between them. Nothing in the database cascades. So every
has_many / has_one relationship field in the registry declares, on the
**owning side**, what the delete engine does to the records on the other side:

| `onDelete` | meaning | example |
| --- | --- | --- |
| `cascade` | the related records die with this one, collected set-based, children first | `order_line_items`, `credit_memo_lines`, `part_subparts` |
| `unlink` | only the mirror rows are swept; the related records survive with an empty cell | `contact_orders`, `part_line_items` |
| `restrict` | the delete is refused while any related record exists | `invoice_payments`, `purchase_order_bills`, `tag_threads` |

A `belongs_to` never declares anything: deleting a line item always unlinks its
order. Stored user-created relationship fields default to `unlink`. Anything the
enum cannot express (a refusal conditional on accounting state, status, a
Drizzle table or a permission) stays a registered pre-delete hook.

---

## 2. Where it is declared

- **Type:** `RelationshipConfig.onDelete` in `packages/types/custom-field/index.ts`
  (`RELATION_DELETE_BEHAVIORS`). The registry narrows it to
  `RegistryRelationshipConfig` in `packages/lib/src/resources/registry/field-types.ts`,
  where a `belongs_to` gets `onDelete?: never`.
- **Registry:** the has_many field's `relationship` block in
  `packages/lib/src/resources/registry/resources/*-fields.ts`. Self-relations
  that carry only the seeder block (`relationshipConfig`) declare it there.
- **Storage:** the seeder copies it into each org's `CustomField.options.relationship`
  (`buildFieldOptions` in `seed/entity-seeder/utils.ts`). Entity migration 136
  stamps it onto the stored fields of existing orgs. The engine reads the stored
  copy through the org cache, never the registry, so a user field and a system
  field are handled the same way.
- **Seed-only pairs:** the six self-relation fields that carry only
  `relationshipConfig` (build reversal, movement parent/child, movement
  reversal) used to be stored with no `relationship` block at all, so nothing
  could act on them. The seeder's Pass 3 now resolves their inverse by
  `(relatedEntityType, inverseSystemAttribute)` and migration 136 links them for
  orgs that already have the rows. Their values were always written on the
  child side only, which is one reason the engine reads that side.

### 2.1 Only actionable edges declare it

`onDelete` is meaningful only where the engine can act: both ends are
`EntityInstance`-backed defs (listed in `SYSTEM_ENTITIES`) and the belongs_to
side is a `FieldValue`, not a `dbColumn`. Registry entries that describe Drizzle
tables (`user`, `participant`, `message`, `dataset`, `kb`, `visit`) and column-backed
parent links (`ticket.parentTicket`, `ticket.contact`, `article.parent`, `tag.parent`) omit it.
Those edges are owned by the table's own delete path: `Message.threadId` cascades
in the database, `deleteKnowledgeBase` and `deleteArticle` handle their trees.

`packages/lib/src/resources/registry/__tests__/relationship-on-delete.test.ts`
enforces both directions: every actionable owning edge declares a value, every
non-actionable one omits it, and no belongs_to carries one. Adding a new owned
child def without a declaration fails this test. That is the whole point.

---

## 3. How the engine executes it

`bulkDeleteEntities` in `packages/lib/src/resources/crud/unified-handler-mutations.ts`
runs three phases. `deleteEntity` is the same three phases with a one-record
input, rethrowing the original error.

1. **Collect** (`resources/crud/delete-closure.ts`). Starting from the requested
   records, follow every `cascade` field breadth-first: one query per
   (definition, field) per level, reading the **child-side** row
   (`FieldValue.relatedEntityId IN (parents) AND fieldId = the child's
   belongs_to field`) joined to `EntityInstance` for the child's definition.
   The parent's mirror row is never trusted: mirror rows are the ones that
   historically dangled, and the self-relation pairs only ever wrote the child
   side. Archived children are included.
   The result is the closure, grouped by definition and tagged with depth
   (requested = 0), deepest first. A record reached twice keeps its maximum
   depth, so a batch holding an order and its own lines deletes each once.
2. **Refuse, before any write.** Over the whole closure: `restrict` violations
   (one grouped count per (definition, field)) and the per-record pre-delete
   hooks. A refusal prunes that record, its subtree (still owned by a survivor)
   and its ancestor chain up to the requested root, which is what lands in
   `errors[]` with the error's status code. So a refused line item still saves
   its order, exactly as the thrown error did before.
3. **Write, survivors only,** deepest group first, in chunks: comments,
   `deleteEntityInstances` (one transaction per chunk, which sweeps both halves
   of every relation), duplicate pairs, one lifecycle bus event and one
   `record:deleted` frame per record. Post-delete hooks run for requested records
   only: every registered one re-projects the record's parent, and a cascaded
   record's parent is in the closure and dying.

Cost for N orders with their lines, credit memos, credit memo lines and tax
lines: four closure queries regardless of N, then about four statements per 500 rows per
definition. The quiet lane (connector teardown, seeds) skips capture, events and
frames entirely. The one remaining per-record read on the event lane is
`captureEventData`, which feeds the event payload.

The wave order is derived from the cascade edges, so nothing lists child
definitions by hand anymore.

---

## 4. What stays imperative, and why

| hook | keeps | reason the enum cannot say it |
| --- | --- | --- |
| `guardPartDelete`, `guardBuildDelete`, `guardPurchaseOrderDelete`, `guardVendorBillDelete`, `guardOrderDelete` | refuse when a movement, receipt, bill date or fulfillment posting sits in a settled period | conditional on accounting state |
| `guardVendorBillDelete` | refuse when the bill is posted or paid | status |
| `guardBuildDelete` | refuse when the build IS a reversal | read off the belongs_to side, which declares nothing |
| `guardQuoteConvertedDelete` | refuse while an unfinished work order came from the quote | status of the related record |
| `guardWorkOrderDelete` | refuse when an `InvoiceLineAllocation` names the job | a Drizzle table, not a relation |
| `guardInvoiceDelete` | refuse on a succeeded charge whose allocation is still in flight, or a live posting | `PaymentTransaction` is a Drizzle table; the `payment` mirror only exists once allocated |
| `guardInvoiceDelete`, `guardWorkOrderDelete` | permission gate | authorization |
| `guardAllocatedLineDelete`, `guardJournalEntryDelete` | unchanged | status and ledger state |
| `rejectDeleteIfSystemTag`, `rejectDeleteIfTemplateTag` | unchanged | not relational |

`guardOrderDelete` refuses only a settled-period posting. An order with a live
posting in an open month still deletes and leaves that entry with a dangling
`sourceId`, which is the documented append-only posture. The invoice guard is
stricter and refuses any live posting; if orders should match, that is a
one-line change in the guard.

Everything a guard used to cascade by hand is gone from the guards. Every static
"refuse while related rows exist" check (invoice payments, vendor bill
allocations, purchase order bills, work order invoices, tariff code offers, tags
in use, reversing builds) is now a `restrict` declaration and its guard code was
deleted.

`suppressPostDeleteHooks` survives for one caller, `deleteInvoiceLine`, a command
that runs the follow-up itself. Cascades never need it.

---

## 5. Gotchas

- **The engine reads stored options, not the registry.** A registry edit
  reaches no existing org until an entity migration stamps it. Migration 136
  did that for every field present in 2026-09; a later registry change needs
  its own stamp.
- **`bank_account_transactions` is declared `cascade` for completeness but
  `deleteBankAccount` owns the actual teardown**, because it also removes the
  connector and the credential and refuses when any transaction is posted.
- **Post-delete hooks do not fire for cascaded records.** If you need a roll-up
  on a SURVIVING record after a cascade (a part's rolled cost after its subpart
  goes, a purchase order line's received quantity after a receipt goes), that is
  a system entity rule on the `deleted` lifecycle event, which still fires per
  record. See `docs/entity-events-architecture-guide.md` §9.
- **Orphans that predate this change are not purged automatically.**
  `packages/lib/scripts/audit-orphaned-children.ts` reports them per org and
  deletes them only with `--purge --as <userId>`, through the engine on a quiet
  session.
- **A closure is not one transaction.** Writes commit per chunk, children first,
  so a crash mid-way leaves a parent whose children are already gone. Pressing
  delete again finishes it.
