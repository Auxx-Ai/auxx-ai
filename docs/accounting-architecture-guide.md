<!-- docs/accounting-architecture-guide.md -->

# Accounting Architecture Guide

**Last Updated:** 2026-09-22

**Scope:** Everything under `packages/lib/src/accounting/` — the general ledger and the pipeline
that writes it, account roles and the chart, periods and the close, the statements, the money
model, source evidence, the export batch and the provider mirror, the payment rails, and the bank
feed, the buy side in `accounting/purchasing/`, the sell side in `accounting/sales/`, and the
edit-in-place lane in `accounting/documents/`. The one document flow outside it (`returns/`) is
described where it touches the books and nowhere else.

> **This guide is the mechanism. It is not the status.**
> What is merged, what is open and what the counts are lives in
> [`plans/accounting/STATE.md`](../plans/accounting/STATE.md). What was decided and what was
> reversed lives in [`plans/accounting/decisions.md`](../plans/accounting/decisions.md) and
> [`plans/money/decisions.md`](../plans/money/decisions.md) (the `G*`/`P*`/`T*` register).
> [`plans/accounting/TARGET.md`](../plans/accounting/TARGET.md) is the statement of intent this
> mechanism was built to; where the two disagree, **the code is the truth** and this guide
> follows the code.
>
> **Companion — inventory and costing.** How a movement is valued, what GRNI holds, the
> three-way match and the one entry per inventory document live in
> **[`inventory-costing-architecture-guide.md`](./inventory-costing-architecture-guide.md)**.
>
> **Companion — records.** `gl_account`, `journal_entry`, `bank_account`, `payment_gateway`,
> `invoice`, `order` and `fulfillment` are `EntityInstance`s. How records and fields work is
> **[`entity-architecture-guide.md`](./entity-architecture-guide.md)**.
>
> **Companion — connectors.** How Shopify facts arrive at all is
> **[`data-connectors-architecture-guide.md`](./data-connectors-architecture-guide.md)**.
>
> **Companion — module shape.** Why `accounting/` has no `index.ts` and how a child is written is
> **[`lib-module-guide.md`](./lib-module-guide.md)** §5.1.

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [The Tree](#2-the-tree)
3. [Vocabulary](#3-vocabulary)
4. [The Ledger: Data Model](#4-the-ledger-data-model)
5. [The Posting Pipeline](#5-the-posting-pipeline)
6. [Roles and the Chart of Accounts](#6-roles-and-the-chart-of-accounts)
7. [Periods, the Lock and the Close](#7-periods-the-lock-and-the-close)
8. [The Money Model](#8-the-money-model)
9. [Source Evidence](#9-source-evidence)
10. [The Rails](#10-the-rails)
11. [The Export: Outbound](#11-the-export-outbound)
12. [The Mirror: Inbound](#12-the-mirror-inbound)
13. [Statements and Reports](#13-statements-and-reports)
14. [Surfaces: Routers, Routes, Workers, Settings](#14-surfaces-routers-routes-workers-settings)
15. [Gotchas and Invariants](#15-gotchas-and-invariants)
16. [The Scenarios a Change Here Must Survive](#16-the-scenarios-a-change-here-must-survive)

---

## 1. Executive Overview

**auxx.ai keeps its own double-entry general ledger.** An external accounting system is an
optional register on a seam, not the system of record. An organization with nothing connected
runs the entire path below unchanged — entries are built, balanced, claimed, persisted and
reported — and the only difference is that the last step has nowhere to push. That is a
supported configuration, not a degraded one (`accounting/ledger/post/post-entry.ts`, decision
`P1`).

The path money takes, in one picture:

```
  a business event                    an external feed
  (ship, pay, refund, bill)           (Shopify, Stripe, a bank)
          │                                    │
          ▼                                    ▼
  ┌───────────────────────────────────────────────────────┐
  │ MoneyCommand → MoneyTransaction / MoneyApplication     │  money actually moved
  │ FinancialSourceObservation → FinancialSourceAcceptance │  what a provider said
  └───────────────────────────────────────────────────────┘
          │  a builder: roles + integer minor units (PURE)
          ▼
  ┌───────────────────────────────────────────────────────┐
  │ resolveRoles → GlRoleAssignment → gl_account           │  this org's own accounts
  │ GlPostingSource: the subject row IS the claim          │  the double-post defence
  │ GlPosting + GlPostingLine                              │  the books
  └───────────────────────────────────────────────────────┘
          │                                    ▲
          ▼ export batch (one provider object) │ the mirror (a raw copy, re-read)
  ┌───────────────────────────────────────────────────────┐
  │ AccountingProvider  ←→  the connected accounting system│
  └───────────────────────────────────────────────────────┘
```

Six properties hold the whole thing up:

1. **Builders are the accounting; the poster is the plumbing.** A builder is a pure function
   returning roles and amounts. It never touches the database, never names an account number
   and never knows a provider exists.
2. **A double post is unrepresentable, not merely detected.** The claim is a partial unique index
   on `GlPostingSource`: one live `subject` row per `(sourceKind, sourceId, occurrence)`.
3. **Correct by reversal, never by edit.** `GlPostingLine` has no `updatedAt` and the module
   exposes no update. A reversal is a second, opposite entry with its own row.
4. **One posting lane.** Every builder feeds `postEntry`. There is no second acceptance boundary
   and no compensating-entry undo.
5. **The ledger's question and the export's question are different columns on different tables.**
   `GlPosting.status` is `posted | reversed` — the ledger has no drafts (§5.5). What a provider
   did lives on `ExportBatch.state`.
6. **Provider-agnostic above the seam.** Nothing outside `accounting/providers/` imports a
   specific accounting system. One display-label map in `accounting/mirror/client.ts` spells the
   word "QuickBooks"; there is no import.

---

## 2. The Tree

### 2.1 Two parents, and the documents they serve

`packages/lib/src/accounting/` and `packages/lib/src/inventory/` are **containers, not modules**.
Neither has an `index.ts`; you import a child.

```
packages/lib/src/
  accounting/
    ledger/      the books: chart/ roles/ builders/ post/ periods/ reads/ setup/
    reports/     trial balance, P&L, balance sheet, GL, aging, 1099, pdf/
    journals/    entries/ (manual) and recurring/
    opening/     the opening trial balance, its baseline and its fill plan
    export/      export batches, payloads/, send, retry, release, rollback, sweep
    mirror/      the raw copy of the provider's ledger, and the translation off it
    providers/   the AccountingProvider seam, book connections, quickbooks/
    rails/       payment rails, rail accounts, rail fee status
    connect-and-go/  headless setup steps over rails, banking and the book connection (brief 105)
    money/       MoneyTransaction / MoneyApplication, invoice payments, deposits,
                 payouts, checkout, stripe-connect, and the two evidence
                 reconcilers (customer-money/order-evidence-reconciler.ts,
                 payouts/payout-reconciler.ts)
    work-items/  AccountingWorkItem: the parked-work codes, writes, wakes, reads, sweep (§8.4c)
    banking/     feed/ import/ review/ rules/
    purchasing/  POs, the three-way match, bills, vendor credits, landed cost,
                 both intake lanes
    sales/       quotes, orders, fulfillments, invoice issuance, credit memos, billing, totals
    documents/   what the three posting families share: edit-in-place/, the
                 generation on `metadata.ledger`, the document entry key
  inventory/     movements/ costing/ receiving/ builds/ relief/ bom/ tariffs/
  returns/       returns, salvage, the evidence pack, intake
  documents/     PDF rendering
```

**`purchasing/` sits under `accounting/` because it talks to the ledger and not to stock.** Its
whole output is postings and payables; measured before the move it held 33 imports into
`accounting/` and none at all into `inventory/`. Under `accounting/` it sits with what it uses,
and the back-edges the ledger and the money model had into it stop being exceptions and become
sibling imports.

**`sales/` followed it down (74 D9).** It had 77 imports into `accounting/` against 20 back-edges
the money side held into it; under `accounting/sales/` those 20 are sibling imports and the cut is
the same argument one module over. `returns/` stays top level and is not expected to follow — it is
stock and customer facing — and top-level `documents/` is the PDF renderer, unrelated to
`accounting/documents/`.

**The line runs through the record, not through the table a function writes.** An invoice's
issuance and lifecycle are `accounting/sales/invoices`; recording a payment against that invoice
writes a `MoneyTransaction`, so it is `accounting/money/invoice-payments`. Credit memos are whole
in `accounting/sales/credit-memos` because the record is a sales document — and `apply.ts` /
`settle.ts` call into `accounting/money` from there.

**A subfolder keeps the barrel it already has; a new one gets none by default.** Forty-one
`index.ts` files sit under `accounting/` — every `ledger/` child, `money/`'s
`bank-deposits` / `checkout` / `commands` / `customer-money` / `payouts`, `banking/`'s four,
`journals/`'s two, `sales/`'s three, and `documents/`'s two (`accounting/documents` and its
`edit-in-place` child are both export subpaths). `accounting/money/invoice-payments` and
`accounting/sales/{quotes,invoices,billing,totals}`
have none, because nothing imports them as a unit; `export/payloads` has one because the
discriminated `parseExportPayload` is the unit (§11.3). A subfolder is a filing decision first and
an export surface only when a consumer wants the subpath, which `generate:exports` then picks up
for free. Client code imports `<module>/client`, never a barrel.

### 2.2 Direction, and the edges that go the other way

The sanctioned direction is:

```
returns  →  accounting/*, inventory/*
accounting/{money,banking,rails,export,mirror,providers,purchasing,sales,documents}  →  accounting/ledger
inventory/*  →  accounting/ledger        (to post)
documents  →  everything                 (a renderer; only accounting/reports imports it, for the PDF theme)
```

Everything below runs the other way. They are **listed so nobody "fixes" them, and so a
thirty-first is noticed.**

**`accounting/ledger` → outside the ledger — 12**, and since 74 D9 not one of them leaves
`accounting/`:

| Site | Symbol | Why it is honest |
| --- | --- | --- |
| `ledger/periods/read-close-blockers.ts` | `countUnissuedChannelCreditMemos` ← `accounting/sales/credit-memos/reads` | A close blocker asking a document module a question |
| `ledger/post/verify-balance.ts` | `countUnissuedChannelCreditMemos` ← `accounting/sales/credit-memos/reads` | The same question, from the after-the-fact sweep |
| `ledger/periods/read-close-blockers.ts` | `readTrialBalance` ← `accounting/reports/trial-balance` | The inventory-balance blocker is a trial-balance read |
| `ledger/post/post-entry.ts` | `buildExportBatches`, `sendExportBatch` ← `accounting/export` | `exportPostedEntry` — the after-commit half of the poster, §5.4 |
| `ledger/chart/chart-import.ts` | `resolveAccountingProvider` ← `accounting/providers/provider` | Importing the chart is a provider read by definition |
| `ledger/roles/source-scope.ts`, `ledger/roles/role-map.ts` | `listPaymentGateways` / `getPaymentGateway` ← `accounting/rails/reads` | The rail scope axis is named by `payment_gateway` records |
| `ledger/reads/list-postings.ts` | `type PostingSummary` ← `accounting/journals/entries/client` | Type-only, erased |
| `ledger/builders/payment.ts` | `type PaymentRoute` ← `accounting/money/bank-deposits/client` | **Type-only, erased.** A second copy of the union is the thing that drifts |
| `ledger/builders/payout.ts` | `type PaymentGatewayFeeTreatmentValue` ← `accounting/rails/client` | Type-only, erased |

**`accounting/money` → `sales` (14) and `accounting/purchasing` → `sales` (4) are no longer
exceptions.** They are the reason `sales/` moved (74 D9): the money side's document reads —
`loadInvoiceForIssuance`, the credit-memo reads, the quote public tokens — and purchasing's
`roundCents` and `MoneyMutationInput` are sibling imports inside `accounting/` now, listed
nowhere because there is nothing to list.

**What the purchasing move deleted, and the one edge it added.** The four back-edges that used to run
`accounting/ledger` and `accounting/money` → `purchasing` — `ledger/builders/entry.ts` for
`allocateCapitalisedCost` and the allocation types, and `money/vendor-payments/`'s three into
`expense-bill/writes`, `vendor-credit/reads` and `vendor-credit/accounting` — are now sibling
imports inside `accounting/` and are not exceptions to anything. In their place there is **one
new `accounting/purchasing` → `inventory` edge**: `vendor-credit/stock-return.ts`, which writes
the `return_out` movements a flagged credit line implies. It is honest — a supplier return is
the one buy-side document that moves stock — but it is the first, and purchasing measured 0
edges into `inventory` before it.

**`inventory` → `accounting/sales` — 1**: `inventory/relief/backfill.ts` →
`accounting/sales/fulfillments` (`readFulfillmentsForOrders`, `isLiveFulfillment`). The live
relief path has no such edge — `accounting/sales/orders/fulfill.ts` calls *into*
`inventory/relief`.

---

## 3. Vocabulary

| Term | Means |
| --- | --- |
| **Posting** | One journal entry. A `GlPosting` row plus its `GlPostingLine`s |
| **Posting type** | What produced it — `fulfillment`, `payment`, `inventory_movement`, … (§5.1) |
| **Role** | A provider-neutral account key a builder emits, e.g. `'grni'`. Never a number |
| **Period key** | The entry's identity within its type: a day (`'2026-08-18'`), a month, a record's own number, a payout id, or a hash of a row id |
| **Claim** | The one live `subject` row on `GlPostingSource` for `(sourceKind, sourceId, occurrence)` |
| **Occurrence** | Which pass over one source this is: `'original'`, `'reversal'`, `'inventory'`, `write_off:<n>`, an application id |
| **The built envelope** | `GlPosting.built` (jsonb): the entry verbatim as it was posted, with its resolved lines, its reasons and its sources. **Every symbol that reads it is still named `*Draft*`** |
| **Draft** | **Not a ledger state** (91 D5). The word survives on documents — a `journal_entry`, bill or credit memo with no posting yet — and in the `built` envelope's `*Draft*` symbol names (§5.5) |
| **Work item** | One `AccountingWorkItem` row: a source a poster refused or skipped, named by a reason code (§8.4c) |
| **Avenue** | The export lane a posting type belongs to — `fulfillment`, `receipt`, `payout`, `journal`, … or `null` for the three that never leave |
| **Batch** | One `ExportBatch`: one provider object, its frozen payload, its state, and the detail postings it rolls up |
| **The mirror** | `ProviderLedgerEntry` / `ProviderLedgerLine` — a raw copy of the provider's own ledger, verbatim, in its own tables |
| **Rail** | A `payment_gateway` record carrying its own clearing account. The second scope axis of the role map |

---

## 4. The Ledger: Data Model

All schema under `packages/database/src/db/schema/`.

### 4.1 `GlPosting` — one journal entry

| Column group | What it carries |
| --- | --- |
| Identity | `id`, `organizationId`, `postingType`, `avenue`, `periodKey`, `revision` |
| Dates | `txnDate` (a Postgres `date`, already in the org's book timezone), `postedAt` |
| State | `status` (`posted` \| `reversed`), `docNumber`, `reversesId` |
| Grouping | `storeId` (`FinancialSourceAccount`, `set null`), `railId` (a `payment_gateway` record id, so no FK), `payoutId` (the provider's payout id, text, indexed, no FK — drizzle `0391`; null until brief 94 stamps it, §13.3) |
| Money | `currency`, `totalMinor` (`bigint({ mode: 'number' })`) |
| Provenance | `built` (jsonb) |

🛑 **Why this is a table and not an `EntityInstance`.** `FieldValue` carries exactly two unique
indexes — the primary key and `(entityId, fieldId, sortKey)` — so composite uniqueness across
two *fields* of an instance is not merely unimplemented, it is **unexpressible**: a unique index
constrains within a row, and two fields are two rows. Nothing on the entity route can express the
claim (decision `G6`). The retired `gl_posting` / `gl_posting_line` entity definitions were
deleted in entity migration 114; do not recreate them, and `gl_posting` is deliberately not an
`EntityRefKind`.

🛑 **`status` is `posted | reversed`, and nothing else.** `pending` and `failed` were
never ledger states — they described a push, wearing this column's name, and a provider refusal
that moved this field took a real, balanced entry out of every report. `draft` went with brief
91 D5 (drizzle `0392`, §5.5). What the export did lives on `ExportBatch`. `reversed` is terminal
and belongs to the **original** of a reversal pair; the reversal itself is an ordinary `posted`
entry (decision `G4`).

Four CHECKs are worth knowing because they decide the *shape of an insert*, not just its
validity: `GlPosting_reversal_check` (`revision = 0 AND reversesId IS NULL`, or `revision > 0 AND
reversesId IS NOT NULL`) makes insert-then-link impossible, and `GlPosting_posted_check`
(`postedAt IS NOT NULL` — every row is posted or reversed) is why `postedAt` rides in the same INSERT. Plus
`totalMinor >= 0` and `revision >= 0`. `GlPosting_org_docNumber_key` is a full unique index and
is **not** swallowed by the claim's `ON CONFLICT` (§5.4).

### 4.2 `GlPostingLine` — one leg

Append-only. **There is no `updatedAt` column and no update function.** On the entity route
`updatable: false` is advisory — read by the grid cell and the connector catalog and by nothing
on the write path — so a later `fieldValue.set` could rewrite one line's amount on a posted entry
and silently unbalance the books. Here immutability is **structural**.

Each line carries: `lineNumber` (1-based, unique per posting), `glAccountId` (**no FK,
deliberately**: a ledger line must outlive the chart row, so `cascade` would destroy history and
`restrict` would block an archive), `accountCode` and `accountName` (snapshots, nullable — a
snapshot of nothing is null), `accountRole` where one drove it (plain text, because this column
*stores* a role and does not define the set), `direction` (`debit` \| `credit` — the **only**
carrier of sign, decision `G2`), `amountMinor` as a positive `bigint`, `memo`, `sourceType` /
`sourceId`, `counterpartyType` / `counterpartyId` (**frozen at post time**, so a retry exports
under the attribution the ledger asserted rather than the current record), and `dimensions`.

⚠️ **`dimensions` is written by nothing.** It exists so that adding a dimension later is a builder
change and not a table migration over history. It is never a lookup key.

🔑 **The line id is the row identity.** Composing a key out of `(glAccountId, glPostingId,
txnDate, docNumber)` collides, because none of those four vary between lines of one posting on
one account — a fulfillment credits sales tax once **per jurisdiction**, all to the same account
(`ledger/builders/split-tax-by-jurisdiction.ts`).

### 4.3 `GlPostingSource` — the claim and the index, in one table

```
GlPostingSource
  glPostingId, sourceKind, sourceId, linkRole, occurrence
  linkRole: 'subject' | 'parent' | 'counterparty' | 'member'
  occurrence: 'original' by default

  GlPostingSource_claim_key
    unique (organizationId, sourceKind, sourceId, occurrence)
    WHERE linkRole = 'subject'
```

🛑 **The `subject` row IS the claim**, and it is the whole double-post defence. Two concurrent
posts of one source contend on one index tuple; the loser gets no row back, reads the winner's
posting and answers `already_posted`. It depends on nothing — not on a provider, not on a
network, not on our own code getting the ordering right.

`parent` lets an order list its fulfillment, receipt and refund postings in one query. `member`
names what a posting summed: the movements behind an inventory entry, the receipts inside a bank
deposit. `occurrence` is the fourth column of the claim, which is what makes a **second write-off
against one invoice representable and a second issuance not**, and what lets a fulfillment's
inventory entry claim `'inventory'` beside the revenue entry's `'original'`.

🛑 **A reversal DELETES the original's subject row** (`markReversedInTx`), which is what frees the
source to post again. A reversal is an undo, not a correction. The reversal writes its own subject
row, `(gl_posting, <original id>, occurrence 'reversal')`.

**The per-record `*_gl_posting` stamp fields are gone** — `fulfillment_gl_posting`,
`payout_gl_posting_id`, `bank_transaction_gl_posting_id`, `bank_deposit_gl_posting_id`,
`credit_memo_gl_posting`, `order_payment_gl_posting` — each with a tombstone comment in its
registry file. A record's ledger card is one query through `listPostingsForSource`.

✅ **One survivor, deliberately.** `journal_entry_gl_posting_id` is a TEXT pointer (not a
RELATIONSHIP — `GlPosting` is a table with no `EntityDefinition`) stamped when the entry is
**posted**. Since 91 D5 the record is a document like a bill: its lines are `journal_entry_line`
child records (data migration 187: `gl_account` id pointer, side, amount, memo, optional
counterparty, sort order; `journal_entry.lines` is a cascading has-many), and its status is
derived — `draft` until the pointer is set, then that posting's status (§5.5).

### 4.4 `GlRoleAssignment` — this org's role map

`G19` needs **directional** uniqueness: each role resolves to exactly one account (required,
enforced); each account may serve many roles (permitted, common). Neither a `SINGLE_SELECT` nor a
`MULTI_SELECT` field on `gl_account` can express that.

Since brief 47 the map is **scoped**, and brief 58 added a second axis: **three** partial unique
indexes, never one three-column unique, because Postgres treats NULLs as distinct and a single
composite would happily admit two org defaults for one role.

| Index | Predicate | Axis |
| --- | --- | --- |
| `GlRoleAssignment_org_role_default_key` | `sourceAccountId IS NULL AND paymentGatewayId IS NULL` | the org-wide default |
| `GlRoleAssignment_org_role_source_key` | `sourceAccountId IS NOT NULL` | **store** |
| `GlRoleAssignment_org_role_rail_key` | `paymentGatewayId IS NOT NULL`, keyed on `(role, gateway, coalesce(currency, ''))` | **rail** |

The `coalesce` is what makes a currency-less rail row and a currencied one two rows, and two
currency-less rows for one rail a conflict. A row is scoped to a source XOR a rail, never both
(`GlRoleAssignment_scope_exclusive_check`), and only a rail row may carry a `currency`
(`GlRoleAssignment_currency_rail_check`). Manual is a **real `FinancialSourceAccount` row**
(`providerKey: 'auxx'`, `externalAccountId: 'manual'`), not a null: 🛑 `sourceAccountId IS NULL`
means "no override", and nothing else.

`markedUnused` says "we don't use this"; an **absent row** says "nobody has looked yet". The two
are different answers and the wizard renders them differently.

🔑 **A partial index and the queries that mirror its predicate change together, or they drift.**
Widening `GlRoleAssignment_org_role_default_key` without widening every read that assumed the old,
narrower predicate is exactly the mistake §15 item 6 records: it is what happened building 58.

`ledger/roles/role-assignments.ts`'s `readRoleAssignments(db, orgId)` is the one door onto this
table: every row for the org, unfiltered and **never joined to `gl_account`** — the moment it
joins the chart it carries the archive flag inside it, which is the precondition a future cache
key needs. Eight production readers wrote their own `select` before it existed.

---

## 5. The Posting Pipeline

### 5.1 Posting types

Declared in `ledger/types.ts` (`POSTING_TYPES`, 21 values) and mirrored by the `GlPostingType`
Postgres enum. **Two copies on purpose** — `types.ts` is client-safe and `@auxx/database` is not
— and there must never be a third. `__tests__/types.test.ts` pins them to each other.

| Enabled (18, in `ENABLED_POSTING_TYPES` order) | Not enabled |
| --- | --- |
| `inventory_movement`, `manual_journal`, `opening_balance`, `bank_deposit`, `fulfillment`, `payment`, `vendor_payment`, `refund`, `vendor_refund`, `payout`, `write_off`, `bank_transaction`, `invoice_issued`, `credit_memo`, `vendor_credit`, `recurring_journal`, `vendor_bill`, `landed_cost_clear` | `provider_sync`, `month_end_deferral`, `month_end_reversal` |

`deposit_application` is gone (91 §4.3; the enum value was dropped in drizzle `0392`): applying
held money to an invoice posts nothing, because the receipt already credited A/R (§8.3). The two
`month_end_*` types are still declared and still have no writer.

🛑 **`vendor_bill` is the ONE type for a supplier invoice, with or without a purchase order.**
`expense_bill` was a second type for the second kind — same record, same lines, same A/P line,
told apart only by whether `vendor_bill_purchase_order` was set — and one record cannot have two
entries. It is retired along with its `EXB` document prefix and its policy row. The builder is
the superset: a line linked to a purchase order line debits `grni` at billed × agreed with the
difference to `ppv`; a line that is not debits the account it was coded to; the header's
shipping, tax and discount take one leg each; `Cr accounts_payable` at the bill total, refusing
by name when the lines and the header do not tie.

**The trigger is the Post action, never the match.** The three-way verdict moved to
`vendor_bill_match_status`, where it recomputes on every line write and every receipt with no
ledger effect. `vendor_bill_status` is `draft | posted | void` and is written only by Post,
Save and Void. A posted bill is locked by a field pre-hook until somebody presses Edit; the
amendment itself is the generic lane, §5.10. Void refuses unless the
bill is unpaid, reverses every live `vendor_bill` posting, and returns the order lines to
billable.

**The shipment entry is a function of its own stamp** (91 D2, D8; `ledger/builders/fulfillment.ts`):

```
Dr accounts_receivable      the box's stamped total
Dr discounts_given          list − net on the shipped lines (store-scoped)
    Cr revenue_product        the shipped lines at list
    Cr gift_card_liability    gift card lines (line_item_category = 'gift_card'), at net
    Cr sales_tax_payable      by jurisdiction, cumulative by box sequence
    Cr revenue_shipping       on the first box
```

The discount is `line_item_line_total − line_item_net_total`, split across boxes by the net's
cumulative allocation — never `line_item_discount`, which no connector writes. A gift card is
recognised as a liability on the shipment because the receipt carries no gift-card fact; through
A/R the net is the same. Nothing is read from a receipt, an allocation or a deposit, and no box
reads another box's posting. A $0 box is `skipped`; a cancelled box is reversed (§5.6).

🛑 **The existence of a builder does not mean a type is live**, and neither does the absence of one
mean it is dead. `buildReceiptEntry` is named by `regime.ts` and does not exist; the two `month_end_*`
types have policies, an avenue and no writer. The `enabled` flag on the policy is what tells you.

🛑 **`enabled: false` means "no close of ours emits this", not "this never posts".**
`provider_sync` is the one posting type **auxx does not author** (§12) — the inbound translation
writes it on the accountant's own schedule — so it can never sit in `ENABLED_POSTING_TYPES`, and
`NEVER_CLOSE_EMITTED` subtracts it before the completeness banner reads the disabled list (§13).
Its avenue is `null`, and that declaration is the loop guard: pushing the accountant's own entries
back at them would double every one, and both copies would balance.

### 5.2 `policy.ts` — one declared record per type

`POSTING_POLICY` declares, per posting type: the trigger, the entry as a role template, which
settings change it, the ON-state and OFF-state sentences, the constants a person should know, and
the record pages it reads its by-id accounts from — plus `enabled`, `exportRoute` and
`singleWriterRoles`.

Four tables that used to answer four questions separately — `ENABLED_POSTING_TYPES`,
`EXPORT_ROUTE_BY_POSTING_TYPE`, `SINGLE_WRITER_ROLES_BY_POSTING_TYPE` and the disabled-state
sentences — are now **derived views** of it (`ledger/roles/regime.ts`,
`accounting/reports/completeness.ts`). Edit the policy, not the derived table. To enable a type,
flip `enabled`; do not add a list.

🔑 **Declared, never derived.** Nothing in `policy.ts` is computed from a builder, a worker
schedule or a settings catalog. If the code and the declaration disagree, the declaration is the
bug report — a table derived from the builders would simply move with them and tell nobody.

`ENABLED_POSTING_TYPES` is derived in **declaration order** and `__tests__/policy.test.ts` pins
that list byte for byte.

### 5.3 Builders — pure, and they throw

`ledger/builders/`, one file per posting type plus `entry.ts` for the generic core. Every builder
is a total function of its arguments: no database, no provider, no clock, no I/O. It returns a
`BuiltEntry` of roles and positive integer minor units.

**Failures here are programmer error**, so builders throw `AuxxError` subclasses rather than
returning a `Result`. A builder that cannot balance its own arithmetic is a bug, not a runtime
condition. The house split is a pure builder beside a `gather-*`/`reads.ts` that reads and returns
a `Result`.

`doc-number.ts` mints `AUXX-<TYPE>-<key>[-R<revision>]`, deterministic, **whether or not a
provider exists**. 🛑 **`DOC_NUMBER_MAX_LENGTH = 21` and over-length is a REFUSAL, not a
truncation.** `INI` is `invoice_issued` because `INV` is `inventory_movement`'s and cannot be
reused; the prefix table is pinned to `POSTING_TYPES` by exact-key equality, or a new type would
mint `AUXX-undefined-…`.

⚠️ **`builders/basis-hash.ts` and `builders/basis-dimension.ts` are not builders**, and only the
first is load-bearing. `basis-hash` is canonical JSON plus the two USD minor-unit converters;
nothing in `ledger/` imports it and roughly twenty modules outside it do — every `money/`
sub-module, `rails/settlement-discovery`, `providers/book-connections`,
`resources/crud/financial-record-binding`, and `export/payloads/journal.ts`, whose
`hashExportPayload` is what freezes a batch's payload and derives its idempotency key (§11.2).
`basis-dimension` is a reserved `'accrual' | 'cash'` enum, exported and used by nothing.

### 5.4 The poster — `post-entry.ts`

Resolve → balance → claim → persist → delegate → record.

**This function never throws.** Every refusal — a closed period, an unmapped role, an imbalance, a
provider fault — resolves to a typed `PostResult`, so a tRPC mutation or a BullMQ job can persist
the outcome without a try/catch of its own. `postEntryInTx` is the on-a-caller's-transaction
variant and *does* throw, so the caller rolls back; a refusal is still a `PostResult`.

`prepareEntry` runs four stages and is **best-effort, not fail-fast** — a preview that refuses on
a closed period should still show the bookkeeper the lines it would have posted, so each stage
records its refusal and the caller reads the first one in the poster's own order:

1. **The period.** A malformed key is `error`, not `period_closed` — reporting the second sends a
   bookkeeper to reopen a month that was never the problem.
2. **Every role, in one batch, BEFORE the claim.** Lines are sorted first, so the row numbers in a
   refusal message match the rows a bookkeeper is looking at. Then `findInventoryAccountRefusal`
   for the five `CODE_ENTRY_TYPES`, keyed on `glAccountId` and never on the code.
3. **Balance, re-asserted in integer minor units.** The builder already refused to build an
   unbalanced entry; it is re-asserted anyway because the cost of being wrong is a ledger that
   does not tie, and because the message is user-facing.
4. **The deterministic document number.**

🛑 **The claim's `ON CONFLICT DO NOTHING` swallows a conflict on `GlPostingSource_claim_key` and
no other.** A violation of `GlPosting_org_docNumber_key` still raises SQLSTATE 23505 out of a
statement that looks defended, so `postEntryInTx` re-raises non-claim unique violations as an
`UnprocessableEntityError`. If the claim insert writes nothing *and* the re-read finds no
conflicting subject, it **throws**: that is not a conflict, it is a defence that has stopped
running.

🛑 **The poster does not push.** A network call inside an open transaction holds the claim's index
tuple for the length of an HTTP round trip. `postEntryInTx` returns a `pendingExport` the caller
hands to `exportPostedEntry` **after** commit.

🛑 **`cash` is deliberately not refused** by the inventory guard, and `opening_balance` is not
checked at all: an opening entry must name all three inventory accounts, and it is not a second
writer because it is measured from the `accounting.opening*` settings rather than read back.

### 5.5 No drafts in the ledger

🛑 **`GlPosting.status` is `posted | reversed`** (91 D5). A generated entry posts the moment its
event is final; review is the export gate (§11.2), before anything leaves. Gate 1 went with its
eight `accounting.autoPost.*` settings, `auto-post.ts`, `draft-lines.ts`, `postDraft` /
`postDraftInTx` / `exportApprovedDraft`, `findPendingDraftPostings`, the `pending` link role, the
`drafted` post status and the Outbox Drafts tab. Drizzle `0392` discarded every remaining draft
and every `deposit_application` row, never promoted: a draft was built by the order timeline and
need not be the entry the per-event posters write (91 §8.10).

**The manual journal is a document, like a bill** (`journals/entries/writes.ts`). Its lines are
`journal_entry_line` children (§4.3):

- `createJournalEntry` writes the record and its lines — an unposted document, no posting.
  Balance is checked at Post and in the preview, never at save.
- `updateJournalEntry` keeps, creates and deletes lines by line id. The web editor creates the
  record on first Save and matches the returned line ids by position.
- `postJournalEntry` builds the entry from the lines (`ledger/builders/manual.ts`), calls
  `postEntry` and stamps `journal_entry_gl_posting_id`.
- **Void** reverses the posting; **Discard** deletes an unposted record and its lines.
- A posted **manual** entry is amended through edit-in-place (§5.10). An opening, recurring or
  template entry refuses Edit and is corrected by reversal.
- Recurring journals **post directly** when they materialise (reverses decision 21-A). The key
  is `hashedPeriodKey('RJE', '<ruleId>:<occurrenceDate>')`, so a raced duplicate converges to
  `already_posted`.
- The opening flow finds its journal by the document's own status (`opening/reads.ts`).

`prepareEntry` is still the pure preview behind `previewJournalEntry` and `previewFulfillment`.

⚠️ **The column is `built`; every symbol is named `*Draft*`.** `draft.ts`, `PostingDraftV1`,
`buildPostingDraft`, `parsePostingDraft`, `POSTING_DRAFT_VERSION`. The names outlived the
`draft` *status* and were not swept: a `*Draft*` symbol in `ledger/post/` is about the envelope.
`built.sources` is the audit copy; the claim is the subject row written at insert.

`buildPostingDraft` is the **single construction site** — one place the version is stamped.
`parsePostingDraft` **throws** rather than returning a `Result`, deliberately: a draft that does
not parse means a row this code wrote cannot be read by this code, and the only honest response is
to stop. Reads that merely want a display string (`readBuiltMemo`, `readDraftReasons`) are lenient
on purpose, so a legacy envelope cannot make a list unopenable.

### 5.6 Reversal

`reverse-entry.ts`. A reversal is a second, opposite entry with its own `GlPosting` row, at
`revision + 1`, pointing at the original through `reversesId`. The pair is distinguished by
`revision` and **never by a suffix on `periodKey`** — `parsePeriodKey` throws on `'2026-08:rev'`.

🛑 **It reverses by `glAccountId`, not by role or code.** A reversal must land on the same account
as the entry it backs out; re-resolving would credit an account the money never entered if the
chart moved, and both halves would balance either way.

🛑 **The original flips to `reversed` inside the reversal's own transaction**, not when its export
succeeds — an original left `posted` beside its reversal is double-counted by every report until a
push that may never succeed says otherwise.

🛑 **A return never reverses the shipment entry** (91 D8). The credit memo reverses revenue for the
returned lines that had shipped (§8.4); reversing the shipment as well would reverse the same goods
twice. A shipment entry is reversed only when its fulfillment is cancelled — the box never left —
by `reverseFulfillmentPosting` from the totals reconciler, idempotent (no live posting is a no-op).
If a memo on that order had already posted, the same hook reverses and reposts it
(`sales/credit-memos/repost.ts`) so its lines re-read `line_item_fulfilled_qty` and the pair nets.
That is the one correction coupling left between two entries, and it fires only from the cancel
hook.

`reverseEntries` is deliberately sequential, one entry at a time: a batch transaction around forty
of them would hold the commit lock for the length of the slowest, and a row that refuses lands the
rest. The lock is resolved once by the caller so a close cannot land halfway through a selection.

### 5.7 `didLedgerAccept` — the one answer

🛑 **`ledger/post/ledger-accepted.ts` is the ONE answer to "did the ledger take it?"** Before it
there were ~12 hand-written arrays of status strings across money, banking, postings and the web
hooks; adding one status silently broke two of them and **typecheck could not see either**. The
`switch` and the `never` at the bottom are the point — do not replace it with a `Set`, however
tidy. It reads `status` and never an export state.

`didLedgerAccept` is true for `posted` and `already_posted` only, and false for every refusal,
for `nothing_to_recognise` and for `not_enabled`. It is the only predicate: `isExpectedPostOutcome`
and the `drafted` status went with drafts (91 D5). A caller that treats `not_enabled` or
`nothing_to_recognise` as an ordinary skip checks that status itself.

### 5.8 `withAccountingCommitLock`

Re-exported from `@auxx/database` via `ledger/post/accounting-commit-lock.ts` — that two-line file
is the whole module. An org-scoped advisory lock taken **inside** the transaction by `postEntry`,
`reverseEntry`, `setLockedThrough` and `runMoneyCommand`.

⚠️ Writing a setting row directly, or purging cache keys by hand, **skips this lock.** Harmless
when nothing is posting; not the same path as a click.

⚠️ The lock is why the `providerSync.` settings prefix exists: the lock is taken for every key
starting `accounting.`, and the sync's per-slice progress blob would grab the org-wide accounting
lock on every write.

### 5.9 `verify-balance.ts` and `duplicate-movements.ts` — the after-the-fact sweeps

Postgres does not enforce `SUM(debit) = SUM(credit)` and there is no trigger precedent in this
repo, so the guarantee is deliberately **three-part, in depth**: the builder refuses to build one;
the poster re-asserts in-transaction before commit; `verifyBooksBalance` proves it afterwards
across every posted entry. **Only the third survives a bug in the first two**, which is the entire
reason it exists.

`duplicate-movements.ts` closes the gap the single-writer guard cannot see. `SINGLE_WRITER_ROLES`
can only ever declare a table over **roles**, and a bank account is named by `glAccountId`. So one
read over the posted ledger asks: has more than one door written the same bank account, by the
same amount, in the same direction, within `WINDOW_DAYS = 2`? Both entries balance and the trial
balance balances; nothing downstream can tell "the payout landed and was coded twice" from "two
unrelated deposits of the same size two days apart" except a human reading both doc numbers. 🛑 It
is **never resolved automatically** — a detector that resolves a duplicate has guessed which one
was real.

### 5.10 Edit in place — an amendment is a reversal plus a repost

`accounting/documents/edit-in-place/` (74 D2). A finalized document is amended by editing it and
pressing Save; **Save is where the ledger is touched**, in one transaction under the commit lock
that rebuilds the entry from current values, compares it to the live posting's built lines, and
reverses-then-reposts only if they differ. §5.6's rule is not bent: the correction is still a
second, opposite entry, and both halves are dated today in the book time zone rather than in the
document's original month.

**The repost needs a new key.** `GlPosting_org_docNumber_key` is unique per org and the reversed
original keeps its number, so `documentEntryKey` (`accounting/documents/document-entry-key.ts`)
keys generation 2 and up on the internal number's DIGITS plus `G<n>` — `0002G2` → `AUXX-BIL-0002G2`
— falling back to a six-digit hash (`BGN` bill, `IGN` invoice, `CGN` credit memo) when that will not
fit in `DOC_NUMBER_MAX_LENGTH`. 🛑 **Generation 1 is the internal number verbatim and must stay so**,
or every document already in a ledger re-keys. The counter lives on
`EntityInstance.metadata.ledger` (`document-ledger-state.ts`); the draft pointer that sat beside it
is gone.

**`spec.ts` is the only file that knows a family.** One row each for `vendor_bill`, `invoice` and
`credit_memo`: the content children, the poster and the posting type, the statuses Edit refuses
(`draft` and `void` for all three, plus `written_off` for an invoice), and the **floor** — what has
already been settled against the document, below which Save refuses. The floors are read from the
money model, never from the projected header fields: paid + credited + discounted for a bill,
applied payments + applied credits for an invoice, applied + reserved refunds for a credit memo —
which is exactly what `voidCreditMemo` reads before it reverses. A fourth row, `journal_entry`
(91 D5), admits **manual** entries only; its live posting is the record's own pointer, and nothing
is ever settled against a journal, so it has no floor.

**The flag is a row, not a jsonb key.** `EntityInstanceEditSnapshot` holds one row per record under
edit — the snapshot, who opened it, when — and its existence *is* "an edit is open" (74 D1). The
lock hooks (`field-hooks/pre/{vendor-bill,invoice,credit-memo}-lock.ts`) and the front end ask an
indexed key lookup rather than detoasting `EntityInstance.metadata` on every autosaved line write.
Cancel restores the snapshot through `UnifiedCrudHandler`, so the match reconciler, the totals
engine and the PO billed roll-up all run on the way back. The row is deleted by Save and by Cancel,
so the table never grows. The `edit` stamp rides `RecordPickerItem` beside `_access` — same batch,
same "absent means unknown" rule — and `record:updated` carries it, so a second tab sees the lock
lift without a refetch.

⚠️ **The totals freeze lifts while an edit row exists.** `totals-hooks.ts` normally refuses to
recompute a document past its editable statuses; during an edit it must, or the header total the
Save floor reads would be the pre-edit one.

🛑 **Cancel restores the derived totals itself** (75 D4). Restoring the lines does not bring the
header back with them: the reconciler drains post-commit, by which time the edit row is gone and
the freeze above is back on. So the snapshot's skip list is two lists — fields owned by a
projection whose input is outside the edit are left alone (`PROJECTED_ATTRIBUTES`: the statuses,
the paid/credited/refunded amounts, `vendor_bill_paid_at` — a payment landing mid-edit must
survive Cancel), while the content-derived ones are written back from the snapshot through
`setValueWithType`, after the children and **before** the row is dropped, in the same transaction.
Which ones those are is named per family as `derivedTotalAttrs` on `spec.ts`, never inferred: the
invoice's and the memo's subtotal, tax, total and balance, and the bill's balance alone — a bill's
totals are transcribed from the vendor's document, `updatable`, and come back through the ordinary
path.

**Save re-projects payment state** (75 D5). `spec.ts`'s `afterSave` runs post-commit on `reposted`
and `not_posted` — `syncVendorBillPaymentState`, `syncInvoicePaymentState`, `settleCreditMemo` — because
an edit that moves a total moves what is still owed, and the projection is the only writer of the
status that gates Record payment.

`routers/document-edit.ts` carries `readState`, `open`, `save` and `cancel`, all four gated on
**`ledgerPost`** for every family: an edit reverses and reposts, so it belongs with Void and
the write-off, not with the desk mutations that move a description.

---

## 6. Roles and the Chart of Accounts

### 6.1 Why roles exist

The chart is an **editable seeded default** (`G7`) — US GAAP mandates no numbering, and charts
vary by country, industry and taste. Once the chart is editable the number cannot carry the
meaning: a customer renumbering GRNI from `2160` to `2155` would silently break posting, and the
entry would still balance. So builders emit roles (`G8`).

There are **34 roles**, all in `ledger/builders/entry.ts` (`ACCOUNT_ROLES`), with
`ROLE_ACCOUNT_TYPES`, `ROLE_ACCOUNT_SUBTYPES`, `ACCOUNT_ROLE_LABELS`, `ROLES_WITHOUT_DEFAULT`,
`SCOPABLE_ROLES` and `roleScopeAxis` beside them. That is the **only** copy of the vocabulary.

`CASH` was removed in brief 13: *a bank account is not a role* — for an **org-wide** map. A payout
settling into one bank and the bank feed's own line for the same money could land in two different
accounts and still balance, with nothing comparing them. ⚠️ **That argument is false once the map
has a rail scope.** `BANK` is admissible precisely because it can never be unscoped:
`ROLES_WITHOUT_DEFAULT` refuses an org-wide `bank` row, so the role only ever answers "which bank
*this rail* pays into". `bank`, `clearing` and — since 91 — `accounts_receivable` are the three
roles with a subtype pin in `ROLE_ACCOUNT_SUBTYPES`, checked by `setRoleAssignment` before it
writes and by `resolveRoles` on every read. The A/R pin is what lets aging and the statement split
find every receivable account, per-store ones included, by subtype (§13.2).

The four newest are the buy side's: `cogs_direct_labor` (`5010`, the labour share of a relieved
unit, beside `cogs_product_cost` and `applied_overhead`), `purchase_tax` (`5040`, tax a vendor
charges on a goods bill — it is never in the landed standard, so it is a period cost and never
inventory), `build_variance` (`5091`, scrap and a run that did not close to standard) and
`inventory_revaluation` (`5092`, the other leg of a `revalue` movement). ⚠️ `build_variance` sits
at `5091` rather than at `ppv`'s `5090`: a role is unique per account in the seed, so two roles
cannot share one code even where an org would happily see them in one place.

The two newest are 91 D8's: `discounts_given` (revenue, contra, seeded at `4080` in core,
store-scoped; the QuickBooks import matches *Discounts given*) and `gift_card_liability`
(liability, `2360` in the `prepayments` pack, unscoped, and **not** subtype-pinned — the obvious
subtype, `STORED_BALANCES`, is an asset classification). A new role reaches an existing org
through the wizard's pack picker or the Roles tab's Add, never a data migration.

`SCOPABLE_ROLES` has exactly eight entries: `revenue_product`, `revenue_shipping`,
`revenue_returns_allowances`, `discounts_given` and `accounts_receivable` on the **store** axis;
`clearing`, `payment_processing_fees` and `bank` on the **rail** axis. A/R on the store axis
(91 D3) keeps a channel's prepaid receivable apart from the dealer receivable in our books. ⚠️ A
QuickBooks Invoice and Payment always post to the company's default A/R, so a store-scoped A/R
account reaches QuickBooks through journal entries only; the Mapping tab's store row says so.

🔑 **The vocabulary stays closed.** No role is added by scoping and no builder changes.
🛑 **Fees are not a store axis** — a store using two rails would pool both rails' fees, and two
stores sharing one Stripe account would split fees that arrive on a single statement.
🛑 **A gateway does not get a named role and a channel does not get an account**; a channel is a
`dimensions` entry, never a second revenue role.

🛑 **Forward events resolve through the mapping; mirrors freeze from the original.** A
fulfillment, a receipt, a refund, a credit memo or a payout asks `GlRoleAssignment` what the
account is *now* — since 91 D4 the memo's and the refund's A/R legs are roles, not an account read
off another entry. A reversal, a void or an edit-in-place reversal copies the account the original
**posted to** (§5.6). Both halves balance either way, so re-resolving a mirror after the chart
moved would credit an account the money never entered and leave the other overstated with nothing
able to detect it.

### 6.2 `resolveRoles` — a batch, and it fails closed

```
ACCOUNT_ROLES  →  GlRoleAssignment  →  gl_account  →  ResolvedPostingLine
 builder emits    THIS org's map       code, name,     what a line stores
 'grni'                                type, active
```

🔑 **A scoped role walks a chain before it reaches that diagram:**

```
axis 'store', scope.store set    ->  (role, that id)         ->  (role, null)
axis 'store', scope.store null   ->  (role, manual id)       ->  (role, null)
axis 'rail',  scope.rail set     ->  (role, rail, currency)  ->  (role, rail, null)  ->  (role, null)
```

The org-wide default is always the last stop — **except `bank`**, whose `(role, null)` cannot
exist, so a miss on the rail leaves it unresolved rather than reaching a row that is illegal to
begin with. An org with no scoped rows runs the byte-identical query it ran before either scope
existed; `resolveScopeIds` does nothing at all unless the org actually holds a scoped row.

🛑 **A scope miss falls back; it does not fail** (except `bank`). Connecting a second store must
never stop the books, so an unmapped source posts to the org default and is surfaced by the
settings screen (decision `D6`). This is in deliberate tension with the fail-closed rule below,
and the boundary between them is §15 item 14.

**It is a batch.** An entry touching six unmapped roles fails **once**, naming all six. A
bookkeeper fixing a close needs the list, not a treasure hunt.

**It fails closed on five distinct conditions with five distinct messages**: no assignment row ·
`markedUnused` · the account is missing or archived · `isActive = false` · `accountType`
incompatible. A sixth branch catches a role outside `ACCOUNT_ROLES` — the vocabulary is closed.
"You never mapped this", "you marked this unused and the books disagree" and "the account you
mapped it to was archived" call for three different actions by three different people.

⚠️ The refusal's `unresolvedRoles` / `unresolvedReasons` are **parallel arrays, index for index**,
and must stay that way — `describeUnmappedRoles` refuses to render any row if the lengths
disagree. Two arrays rather than one array of objects because `AuxxErrorDetails` values may only
be `string | string[]`.

🛑 **There is no default account and no "take the first".** That is the one behaviour that would
put money in an arbitrary account: the entry would still balance, nothing downstream could detect
it, and it would surface at a close as a number nobody can reconstruct.

⚠️ **Not cached, deliberately.** `gl_account` is an `EntityInstance` and there is no per-record
event for a rename or an archive, so a cached key would be correct for an hour and then fail
**open** — the entry still balances. `role-map.ts` reads the same rows through the same door and
inherits the rule. Do not add a cache key until `gl_account` create/update/archive have events of
their own.

### 6.3 The write side validates against the same facts

`setRoleAssignment` refuses, **before writing**, a role outside `ACCOUNT_ROLES` and an account
whose `accountType` is incompatible — the same `ROLE_ACCOUNT_TYPES` table the resolver checks.
Pointing `grni` at a revenue account produces an entry that balances, so nothing downstream can
detect it; catching it at assignment time is the difference between a validation message and a
restatement. A mapping that only fails at a close fails on the night of the close.

`listRoleMap` returns one row for **every** role, mapped or not. It is a checklist, not a table
dump: a screen rendering only existing rows could never show what is missing, which is the single
question the setup wizard exists to answer.

🛑 **A row is scoped to a source XOR a rail, never both**, and `setRoleAssignment` refuses before
either scope branch runs — caught as a validation message, not as a constraint name in a stack
trace. `ROLES_WITHOUT_DEFAULT` (`bank`) is the one write it always refuses unscoped.

Each row also says whether the account it names is **linked** to a provider account (89 D9):
`linked` comes from `provider.listAccountMappings` — one local read, never `accountMap`'s provider
round trip, which the Mapping tab must not pay for — and an unlinked account gets a *Not linked*
badge and a Link button into the Chart tab's editor. Null when nothing is connected.

### 6.4 The chart

| File | Owns |
| --- | --- |
| `ledger/chart/default-chart.ts` | The seeded default, declared as opt-in **packs** (`card_rail`, `prepayments`, `inventory`, `purchasing`, `payroll`, `fixed_assets`, `debt`). Pure data |
| `ledger/chart/chart-accounts.ts` | How this codebase reads one org's chart. **Exactly once** — it serves both the resolver and the role-map screen |
| `ledger/chart/chart-write.ts` | Create / update / remove / restore. Until it existed there was no writer but the seed |
| `ledger/chart/chart-import.ts` + `chart-import-plan.ts` | One `gl_account` per active provider account, with the provider identity stamped at import. The plan half is pure; its two tables are **declared, not derived**, and the role-match list is short on purpose (revenue is the person's call) |
| `ledger/chart/next-account-code.ts` | 🛑 A band is a range, not a cursor — under "highest plus one" you walk straight out of it |
| `ledger/chart/gl-account-pointers.ts` | Every registry field holding a `gl_account` id **as TEXT** (no `references()`), and the read that finds what points at one account. The archive path needs it to warn |
| `ledger/chart/resolve-cash-account.ts` | The GL account a `bank_account` record points at, or a refusal naming which link is missing. 🔑 A pointer lookup and not a role, because `bank` is rail-scoped |
| `ledger/chart/account-label.ts`, `source-account-label.ts`, `account-subtype.ts` | The pure string forms, shared server- and client-side |

### 6.5 Single-writer roles

`ledger/roles/regime.ts` exists for one assertion: the three inventory accounts may be driven by
at most one enabled role-emitting writer. The two regimes are not additive and the conflict is
undetectable downstream — a monthly assertion moves each inventory account *to* the value the
subledger computes, silently reversing every perpetual posting made during the month and dumping
the residual into COGS, where it reads exactly like consumption. Both entries balance. Both claim
cleanly. `findWriterConflicts` returning non-empty means the ledger is running two regimes at
once; empty is the healthy answer.

---

## 7. Periods, the Lock and the Close

### 7.1 Period keys

`ledger/periods/periods.ts` is **pure**: `isPeriodLocked` and `assertPeriodOpen` take the lock as
an argument so the module stays exhaustively testable with no database.

🛑 **Period boundaries are instants derived from wall-clock midnights in
`accounting.bookTimeZone`, never UTC.** A `periodKey` / `txnDate` is derived **once**, at the
wall-clock boundary, and stored as a calendar date with no instant component left in it. That is
why report reads compare `txnDate <= to` as a plain date comparison and do **no** timezone
conversion of their own — re-deriving a boundary from a `Date` one level up is the classic bug
here. `periodKeyForDate` uses `Intl.DateTimeFormat` with `en-CA`, because that locale's short date
format *is* `YYYY-MM-DD` and hand-rolled offset arithmetic gets DST wrong roughly twice a year.

`ledger/setup/book-time-zone.ts` is the one reader of that setting. `readBookTimeZone` **refuses**
rather than defaulting to UTC; `readBookTimeZoneOrUtc` is the lenient counterpart for display
paths. An assumed zone posts a month's edge activity into the wrong period, invisibly, and
uncorrectably once the period is locked.

`ledger/periods/period-key.ts` mints a key from a row id when the entry is not date-keyed.
🛑 **A hash of the id, never a counted sequence.** `PMT-0001` counted off the existing postings is
the one shape that is actively dangerous: two concurrent rows read the same count, mint the same
key, and the claim converges the loser to `already_posted` — **a success status**. Two events
silently become one entry and the loser's money never appears. It is collision-*unlikely*, not
collision-proof: six base-36 digits is 2.2e9.

### 7.2 The lock

`ledger.lockedThroughMonth` is one value covering both ledger and subledger mode, because the
question is the same in both: *is this month still accepting entries*. What differs is who
**writes** it, and that difference belongs to the writer, not to every reader. The lock is
**soft**: it marks a month closed and refuses a post against it; reopening is a normal,
permissioned, audited act (`set-locked-through.ts`, under the commit lock, with the pre-write
value read in-transaction for the audit row).

### 7.3 The close is a check, not a post

⚠️ **There is no `posted` close state and no close entry.** The monthly inventory assertion was
deleted; every inventory document posts its own entry inside its own write's transaction, so a
close has nothing to build, nothing to preview and nothing to post. What it has is a blocker list.

`close-periods.ts` derives the period strip from three things that already exist —
`accounting.cutoffPeriod`, `ledger.lockedThroughMonth`, and the ledger itself. There is no table
and there does not need to be one.

`read-close-blockers.ts` is the check: is every movement in a posted entry, do the two sides tie,
and how many channel credit memos are still unissued. 🛑 **Reads only, and it never throws.** A
month that cannot be checked is reported as a month with no findings, not as a month that cannot
be closed — a broken read must not be able to hold an organization's books hostage.

`close-blockers.ts` is the pure, client-safe half. 🛑 **The sentence is a projection of the items,
never a parallel implementation.** The moment a screen hand-writes its own version of one of these
labels, the refusal an operator reads and the refusal the books recorded can disagree. The item
keys are `unposted_shipments`, `draft_channel_memos` (a memo *document* still in `draft`),
`unmapped_role`, `unmapped_account`, `invalid_mapping`, `inventory_unposted`, `inventory_balance`,
`inventory_standard_value`.

`settled-periods.ts` answers "is this date in a month the books are already closed to", and it is
**three predicates, each catching a case the others miss**: the period lock, *or* a posted entry
standing for that month, *or* at-or-before `accounting.cutoffPeriod`. 🛑 **Predicate 2 reads
`GlPosting` directly and must not use the close strip** — the strip answers "can I close this
month?", which is a different question with a different answer in the presence of an unfinished
attempt. It also owns `assertAccountingSetupUnfrozen`: once a posting exists, `accounting.opening*`,
`bookTimeZone` and `cutoffPeriod` refuse to change with a 409. The browser-side freeze is the
courtesy; this is the guard.

`month-activity.ts` answers "what posted in this month, per type" — **a fact per type, never an
alarm** — no status, no severity, no verdict. ⚠️ **Matched on `txnDate`, never on `periodKey`**,
because for `manual_journal`, `bank_deposit` and `write_off` the period key is the source record's
number, not a date.

---

## 8. The Money Model

### 8.1 The one write door

`accounting/money/commands/run-money-command.ts` is the single write door for `MoneyTransaction`,
`MoneyApplication` and everything hanging off them. It runs one command exactly once, inside the
accounting commit lock.

🔑 **Why the command row exists at all.** `MoneyTransaction` has no natural idempotency key — two
identical $170 receipts for one customer on one day are a legitimate pair, so the rows cannot
dedupe themselves. `MoneyCommand` carries the key the **caller** knows: a Stripe event id, a
checkout session, a request id. Every row written under it points back through `commandId`, which
is also what makes a partially-applied retry safe.

A retry with the same key **and the same payload hash** returns the first run's `resultIds`
without executing again; the same key with a **different** payload is a `409`, because two
different requests wearing one key is a caller bug, not a retry. ⚠️ **The lock is taken before the
read**, or two concurrent retries both miss, both insert, and the unique index turns a retry into
a 500.

### 8.2 The tables

| Table | Holds |
| --- | --- |
| `MoneyCommand` | The idempotency record: key, kind, payload hash, `resultIds`, actor snapshot |
| `MoneyTransaction` | A confirmed movement. `purpose` ∈ `customer_receipt` \| `customer_refund` \| `vendor_payment` \| `vendor_refund` |
| `MoneyApplication` | Append-only `apply` / `unapply` against an order, an invoice or a vendor bill |
| `MoneyTransfer` | A payout or transfer. **Never** a fifth money purpose |
| `MoneySourceLink` | Many immutable source observations → one movement |
| `MoneyRefundSettlement` | A refund settling a credit memo — a link written when both sides exist, never an input to the refund's entry (91 D4) |
| `PaymentAccount` | The org's Stripe Connect account. `money/stripe-connect/account.ts` is its ONLY writer |

`money/reads.ts` and `money/writes.ts` are the family's readers and writers: `readMovements` /
`readMovement`, `listMovementApplications`, `listLiveApplications` (apply rows minus the ones an
`unapply` names — the read a void or a refundable-receipt list wants), `sumAppliedByMovement`,
`sumAppliedToInvoice` / `sumAppliedToVendorBill` / `sumAppliedToOrder`, `listRefundSettlements`,
`findSourceLink`, and `insertApplication` beside `commands/insert-movement.ts`'s `insertMovement`.
`netApplied` in `money/client.ts` is the pure reducer over application rows.

**Dates model two precisions.** `datePrecision` is `'instant'` (with `occurredAt`) or `'date'`
(with `occurredOn`). A card charge is an instant; a hand-recorded payment is a date. Timezone
conversion applies only to instants.

**Requests are not movements.** Only a confirmed actual movement becomes a `MoneyTransaction` —
which is why `checkout/writes.ts` writes nothing to the money model when it creates a session.

✅ **The Dispatch-era `PaymentTransaction` / `PaymentAllocation` lane is gone**, deleted rather
than migrated. The only survivors are dead enum values in `packages/database/src/enums.ts`, a
constraint-name string in `apps/web`'s record router, and four stale `apps/worker/scripts/verify-money-*.ts`
probes that no longer compile — `@auxx/worker` has no `typecheck` script, which is why nothing
catches them.

### 8.3 One rule for every customer receipt, two posters

🛑 **An entry depends only on facts on its own record** (91 §4.0). It never waits for another
record to arrive or another entry to post; links to other records are written when both sides
exist and are never inputs to the lines.

**Every customer receipt posts `Dr <the cash endpoint> / Cr accounts_receivable` for the
movement's whole amount** (91 D1). Both lines are sourced on the movement (`money_transaction` /
its id); the counterparty is the customer, or the guest contact (`accounting.guestContactId`)
when there is none; `parent` names the order or invoice when one is known. No order timeline, no
tax leg, no deposits leg, no check that a sibling posted. Two posters write it:

- **`money/customer-money/accounting.ts`** — a channel receipt, and every receipt not applied to
  an invoice. `record-storage.ts` is the write door for financial records and their
  observations, and it owns the ordering rule: **source order is acquisition order; arrival time
  never grants authority**, so a verified prior beaten by an unverified next is a `conflict`.
- **`money/invoice-payments/receipt-accounting.ts`** — the invoice lane: the same two lines,
  parent the invoice when the live applications name exactly one.

`resolvePoster` (`money/blocked-movements.ts`) picks between them off the movement's own
`MoneyApplication` rows: an invoice application → the invoice poster, anything else → the
customer receipt poster.

🔑 **Applications are links, not entries.** Partial application, `unapply` and one receipt
across several documents are not refusals: the entry is the movement, and what it pays is a
`MoneyApplication` row that aging and the statement split read (§13.2). `apply-money`,
`unapply-money` and `move-payment` write applications only; `deposit_application` is deleted.

**An orderless receipt posts now and links later** (91 §8.6). A channel receipt whose order has
not arrived is accepted at ingest with an `ORDER_NOT_FOUND` work item at stage `evidence`
(§8.4c) and posts on the guest with no parent. When the order's `created` record event wakes
the row, the link step writes the `MoneyApplication`, the posting's `parent` link and the
movement's party. ⚠️ The frozen line counterparty stays the guest — the one thing link-later
cannot repair.

**`customer_deposits` has no writer.** The checkout quote deposit
(`money/checkout/deposit-accounting.ts`), the invoice lane's held money and the order receipt all
credit A/R: a paid, unshipped order is a credit in A/R until it ships, as QuickBooks shows an
unapplied payment. The role, its label and its seeded account stay for an org that hand-posts to
it. The statements show the credit side per document as a computed row (§13.2).

The eight `invoice-payments` files are one verb each: `record-payment`, `apply-money` (held money
onto an invoice — posts nothing), `unapply-money` (posts nothing), `move-payment` (unapply +
apply, links only), `void-payment` (a reversal, never a compensating entry), `receipt-accounting`,
`payment-state` (the projection onto the invoice's mirrors) and `payment-reads`.

🛑 **The receipt entry is never amended.** A later allocation is a link on its own day; it moves
what aging attributes the credit to and never touches the ledger.

A refusal is a work item with a code, never prose on the movement (§8.4c) — `GATEWAY_UNMAPPED`,
`ROLE_UNMAPPED`, `ENDPOINT_UNRESOLVED`, `CUSTOMER_UNRESOLVED`, `MISSING_AMOUNT`, `MISSING_DATE`,
`PERIOD_LOCKED`, `SETUP_INCOMPLETE`, `NO_DOCUMENT`, `OWNERSHIP_CONFLICT`, `EVIDENCE_PENDING` —
and `BEFORE_CUTOFF` is a skip, not a refusal.

### 8.4 The cash endpoint

Every `MoneyTransaction` says where the money physically sits, in one of three ways, and **one
function** — `resolveCashEndpoint` (`money/cash-endpoint.ts`) — turns that into a GL account:

```
paymentGatewayId set      → resolveRoles(['clearing'], { rail, currency })   the rail's clearing, fails closed
cashAccountInstanceId set → resolveBankAccountGlAccountInTx(...)              the bank account's GL pointer
neither                   → resolveRoles(['undeposited_funds'])               the unscoped role
both                      → refused when the movement is written
```

A receipt or a vendor refund **debits** that account; a customer refund or a vendor payment
**credits** it. Same function, same three refusals, same `GlPosting.railId` on every posting.
`method` (cash, check, card, bank, other) stays on the movement as a descriptive fact and decides
nothing.

⚠️ `undeposited_funds` is resolved **unscoped**, and that asymmetry is the point: a deposit run
groups across rails.

🛑 **`clearing` is reachable only through a named rail.** A clearing account exists to be drained
by a payout, and a rail is the only thing a payout arrives on.

**When the rail is written, per door.** A hand-recorded receipt, refund or vendor payment stamps
`paymentGatewayId` at record time from the dialog; the Stripe checkout and card-refund doors stamp
it from `resolveStripeRail`. A **channel** movement stamps it at post time, inside the posting
transaction, because the mapping is made by a person and may not exist when the movement arrives.

A channel receipt resolves its rail from the movement's own gateway **handle**, in four rules
(`customer-money/receipt-accounting.ts`):

1. The handle normalises to a RESERVED handle (`manual`, `bogus`, `gift_card`) → **no rail**.
   `manual` and `bogus` resolve through the "neither" shape and land in undeposited funds; the feed
   link is not consulted and its refusal does not apply. A manual Shopify payment is money in no
   processor. `gift_card` (`GIFT_CARD_GATEWAY_HANDLE`) is a redemption: its endpoint is
   `gift_card_liability` (91 D8).
2. The handle matches exactly one `payment_gateway` record through `matchGatewayRoute` → **that
   rail**, whether it is active or closed. The feed link is not consulted.
3. The handle is present but unmapped, or two rails claim it → **blocked** as `GATEWAY_UNMAPPED`
   with the handle as `externalRef`. No silent fallback: mapping a gateway wakes those rows.
4. The handle is absent → the feed's `FinancialSourceAccount.paymentGatewayId`, with the existing
   "no payment gateway linked" refusal when that is missing too.

A channel refund resolves its rail from **its own** handle by the same four rules
(`readCustomerReceiptAccountingSource(…, 'customer_refund')`, 91 D4), never from the receipt it
refunds.

🔑 **The credit memo and the refund meet in A/R, not in each other's entries** (91 D4).

- **The memo posts per line**, for the lines whose goods had shipped before the memo, read off the
  order's own line items: `line_item_fulfilled_qty` / `_at` null means the channel said nothing
  and the line reverses; qty 0, or shipped after the memo date, means not shipped; a native memo
  treats every line as shipped. `Dr revenue_returns_allowances` for goods, `Dr revenue_shipping`
  for a `credit_memo_line_disposition = 'shipping'` line, `Dr sales_tax_payable` for their tax,
  `/ Cr accounts_receivable`. A memo with no shipped line posts nothing and issues as
  `nothing_to_recognise`: there is no revenue to reverse, and the money is already a credit in A/R.
- **The refund posts `Dr accounts_receivable / Cr <the endpoint>`**, sourced on the movement,
  parent its own order, and waits for nothing — not the memo, its posting, nor the receipt's.
  Where a memo exists it still checks the total and that it is not dated before the memo;
  entitlement (applied + reserved against the memo) runs in the link step after posting
  (`linkRefundPostingToMemos`) and writes a `REFUND_EXCEEDS_MEMO` **warning** rather than
  refusing. Ingest writes the `MoneyRefundSettlement` when the memo already resolves;
  `linkImportedRefundsToMemo` writes it from the memo issuing pass when the memo arrives later.
  ⚠️ A channel refund whose **order** has not arrived still waits (`ORDER_NOT_FOUND`).

`readCreditMemoControlAccount`, the pre-shipment memo branch, the readiness gate (88 D2) and 88 D7's
mirror split are gone. `sweepChannelCreditMemos` (`sales/credit-memos/issue-pass.ts`) runs as the
recovery job's third posting sweep beside the movement and shipment sweeps.

🛑 **The bank deposit's debit is the bank account the operator picked, by `gl_account` id.**
Grouping posts nothing; only the bank run does, and it posts ONE line so it matches ONE bank line.
`listUndepositedPayments` is `purpose = 'customer_receipt' AND paymentGatewayId IS NULL AND
cashAccountInstanceId IS NULL AND bankDepositInstanceId IS NULL` — the movement's own columns, not
a settings table.

**A vendor payment may carry a third leg: the early-payment discount** (74 D3). `Dr
accounts_payable 100 / Cr <endpoint> 98 / Cr purchase_discounts 2` — one entry, so
`voidVendorPayment` unwinds both legs for free, and the A/P debit is money + discount. The amount
is typed in the Record payment dialog as **Discount taken** and lives on
`MoneyApplication.discountMinor`; it is **never computed from terms** — the vendor's remittance is
the truth, and there is no terms field on a bill to compute from. The cap is
`money + discount ≤ balance`, a zero discount posts no third line at all, and a payment of zero
money with a discount is **refused by name**: a settlement with no money in it is a vendor credit,
which is the vendor's own document. `purchase_discounts` is an `expense` role seeded at **5093**,
a contra-COGS beside `ppv` 5090 — discounts show in margin, not in other income. The bank-review
coding path passes zero; settling a remainder as discount from a bank line is not built.

🛑 **Both halves of that leg had to be provisioned per org, and neither is automatic.** Adding
5093 to `DEFAULT_CHART_OF_ACCOUNTS` gave it to nobody — the pack walk runs once, in the wizard, so
every account the catalogue gains afterwards is unreachable to an org that already ran it. Data
migration **181** closes that class for good by recomputing each org's `packState` and re-walking
every pack reading `partial`; `absent` packs are never walked, because provisioning `payroll` for
an org that never adopted it is worse than a missing row (75 D2). The mirror field
`vendor_bill_amount_discounted` is ensured by **182** (75 D3). Until both ran, a discounted payment
was refused on the unmapped role and the discount fell out of the balance in silence.

### 8.4a The vendor credit and the vendor refund

A supplier's credit note is a DOCUMENT, not an edit to a bill's total:
`accounting/purchasing/vendor-credit/`, the mirror of `accounting/sales/credit-memos/` with the parties swapped. The
`vendor_credit` entity carries lines, a status (`draft -> issued -> settled`, `void` off either),
attachments and a PDF, numbered `VC-0001` from its own `RecordSequence` scope. The supplier's own
reference lives beside it on `vendor_credit_vendor_reference` and is never the entry's key: two
suppliers may print the same string.

Issuing it posts `Dr accounts_payable (counterparty: vendor) / Cr <each line's account>` — the
vendor bill's coded-line arm with the sides flipped, and the entry ties to the stored total or it
does not post. A line names its account by **id**, like a `vendor_bill_line`, and a credit raised
against a PO-backed bill has its lines prefilled with the org's resolved `grni` account
(`resolveGrniAccountId`, never a hardcoded code), so the short-shipment case `Dr A/P / Cr GRNI` is
the same entry with that account on the line. One builder, no per-line roles. Its avenue is
`vendorCredit`, its own: the provider object is a Vendor Credit, not a Bill (task 92).

Applying a credit to a bill posts NOTHING — the issue entry already debited the payable. What
moves is `vendor_bill_amount_credited`, the bill's balance
(`total − paid − credited − discounted`, `vendor-bill-balance.ts`) and its
`vendor_bill_payment_status`. `vendor_bill_amount_discounted` is the discount's mirror on the same
projection, written by `syncVendorBillPaymentState`; `amount_paid` stays the money alone.

**A supplier return is a credit line that moved stock**, not a document of its own.
`vendor_credit_line_returns_stock` on a line makes issuing the credit write one `return_out`
movement at the part's current standard inside the same transaction, linked to the line's
purchase order line, and post a second `inventory_movement` entry of kind `return_to_vendor`:
`Cr <inventory role>` at the standard, `Dr grni` at the agreed price, the remainder — freight and
duty on goods no longer held — to `ppv`. The money entry above is unchanged and is what closes
GRNI for those units. Leaving the flag off is the right answer for a price adjustment and for a
short shipment, where there is no stock to move and the money entry clears GRNI on its own. The
receipt reversal stays the keying-mistake door and is never offered as a return.

A supplier paying the credit back is a `MoneyTransaction` with purpose `vendor_refund` and a
`MoneyRefundSettlement` at disposition `vendor_credit`. It posts `Dr <the cash endpoint> /
Cr <the credit's control account>` through the same `postMovementEntry` frame as its own
`vendor_refund` type on the `vendorPayment` avenue — money with a vendor, arriving instead of
leaving. The control account is
read off the credit's own posted lines (`readVendorCreditControlAccount`), never re-resolved, and a
refund may not precede the credit's issue date.

🛑 **A vendor credit does not touch inventory quantities.** A physical return to the supplier is a
`stock_movement` on its own document; this is the money side only, and a person raises both.

### 8.4b One frame, six posters

`money/post-movement.ts`'s `postMovementEntry` holds what every money poster shares: the
live-posting check, `isAccountingEnabled`, the finalized-setup gate, zone and cutoff, the movement
load and its three refusals, `resolveCashEndpoint`, the three link rows, the period lock,
`postEntry` and the `accepted | blocked | skipped` answer — writing the movement's work item on
`blocked` or `skipped` and deleting it on `accepted` (§8.4c). Each poster is a `prepare` callback
that returns only its LINES — the A/R credit, the A/R debit, A/P — because that is the accounting
and each differs by design. `commands/insert-movement.ts` is the same story for the six writers'
`MoneyTransaction` insert.

### 8.4c Parked work — `AccountingWorkItem`

One table for everything a poster refused or skipped (91 D6, drizzle `0390`). It replaced five
markers: `MoneyTransaction.postingBlockedReason/At`, the fulfillment and credit-memo marker
fields (their entity migrations 184 and 185 are deleted and retired; data migration 186 drops the
fields), `payout_blocked_reason`, and `FinancialSourceAcceptance`'s `attempts / nextAttemptAt /
reason`.

```
AccountingWorkItem
  organizationId, sourceKind, sourceId, occurrence, stage
  reasonCode, role, railId, glAccountId, periodKey, externalRef, detail (jsonb)
  attempts, nextAttemptAt, createdAt, updatedAt
  unique (organizationId, sourceKind, sourceId, occurrence, stage)
```

🛑 **One row per stuck thing; success deletes it.** A refusal is a row insert, never a
`setValueWithType` on the record, for entity-backed and table-backed sources alike. Movements,
shipments and payouts park at stage `post`, a credit memo at `issue`, an acceptance at `evidence`.
A pre-delete hook (`field-hooks/pre/accounting-work-item-delete.ts`) sweeps a deleted record's rows.

🔑 **Only the code is stored.** `work-items/codes.ts` is the closed, client-safe vocabulary; the
sentence, the severity (`info` · `warning` · `error`) and the status (`waiting` · `blocked` ·
`warning` · `skipped` · `rejected`) are functions of the code, and a test pins a sentence and a
severity on every one. `refusal.ts` maps a thrown error to a code: `details.workItemCode` (set at
the throw site with `withWorkItemCode`) → `unresolvedRoles` → `ROLE_UNMAPPED` → a `NotFoundError`
→ `SOURCE_NOT_FOUND` → `REFUSED`, which carries the thrower's words in `detail.message`.

**Severity decides the retry, not the stage** (`nextAttemptDelayMs`): `info` after an hour,
`error` after a day, transient codes (`TRANSIENT_ERROR`, `NOT_CONFIRMED`) doubling from a minute
to a six-hour cap. `skipped`, `rejected` and `warning` rows get no `nextAttemptAt` and are never
re-offered, so a skip (`NOTHING_TO_RECOGNISE`, `BEFORE_CUTOFF`) is a row a person can see that
the sweep excludes in SQL.

**A fix wakes exactly what it unblocks** (`wake.ts`: `nextAttemptAt = now()`): `setRoleAssignment`
→ `ROLE_UNMAPPED` for that role and rail; the totals stamp → `TOTALS_NOT_STAMPED` for those
fulfillments; `setLockedThrough` → `PERIOD_LOCKED` rows whose month is open again; an order's
`created` event → `ORDER_NOT_FOUND` rows carrying its external id; a gateway mapped or a feed
linked → `GATEWAY_UNMAPPED`; the guest contact minted → `CUSTOMER_UNRESOLVED`. The schedule is
the safety net, not the mechanism.

**One sweep frame** (`sweep.ts`'s `runWorkItemSweep`): never-tried sources first, then due rows,
until the limit or the time budget; a throw reschedules its own row, so a thousand refusals cannot
starve a postable source. The recovery job (`jobs/maintenance/accounting-recovery-job.ts`) visits
up to 25 finalized orgs per run, those with due work first, with no cursor, and runs for each the
evidence bridge, the imported-money ingest, the movement and shipment sweeps — in any order,
since no entry reads a sibling — and the export batch sweep.

### 8.5 Payouts

`money/payouts/` raises a `payout` record per settled payout a source reports, posts its entry and
links it. Provider-neutral behind `PayoutSource` (`source.ts`, a type-only contract), filled by
`sources.ts` at boot.

🛑 **Every process that runs the payout sync must call `registerPayoutSources()` at boot** — web
and the worker, beside `registerAccountingProviders()`. With an empty registry `syncPayouts` finds
no context for any org, lists nothing, and the clearing account keeps filling with nothing to say
so.

Three properties the module exists to keep:

- **A payout is posted at most once.** The **pair** (`payout_payment_gateway`,
  `payout_gateway_id`) is the idempotency key, checked before anything is written, because the
  sync is a *poll* and sees every payout again on every run. A watermark alone is not enough: it
  can be re-run, reset, or overlap a boundary, and a second posting would relieve clearing twice
  with both entries balancing. The webhook is a prompt; the nightly sweep is the guarantee, and
  both doors run the same idempotent `syncPayouts`.
- **A payout still in transit gets a record but no entry.** `PAYOUT_STATUSES` is
  `in_transit | paid | failed | reversed`; only `paid` carries a posting.
- **`depositedMinor` is transcribed** from the header, never summed from the items. Summing would
  silently correct the provider's arithmetic, and the cash leg must equal what the bank line
  shows.

Recognition is keyed on `ref.kind` — `stripe_charge`, `order`, `none` — 🛑 **never on a charge id
for everything**: a Shopify payout matched on a charge id recognises nothing and credits the whole
deposit to unidentified receipts. A source with no items posts recognition equal to gross and
marks the record `imported`, so the screen can say *"no itemisation"* rather than *"everything
recognised"*.

Since brief 58 **every leg is a role line** — `bank`, `payment_processing_fees`, `clearing`,
`unidentified_receipts` — each carrying `sourceScope: { rail, currency }`. The builder names no
account id at all, so a rail's sales debit and its payouts credit the same clearing account by
construction rather than by two builders agreeing. `bank` has no org-wide default, so a payout
whose rail has no mapped bank account is blocked before the entry is built, naming the rail and
the currency. ⚠️ `post-payout-entry.ts` **resolves nothing itself and must not start**.

⚠️ **The reported destination is a check, not a resolver.** The mapping is the authority, and a
destination that disagrees flags `payout_destination_mismatch` on a payout that still posts. Only
Stripe reports one.

**A chargeback is a refund** (91 D8). A `dispute` balance entry matches a `customer_refund`
movement (`MATCHABLE_ENTRY_TYPES`, `match-entries.ts` — admitted in code; the entry type is free
text); the refund carries the dispute fee as `Dr payment_processing_fees` (`feeMinor`), and the
payout excludes a fee already on the refund (`feeOnRefund`). ⚠️ A payout that posts before its
chargeback's refund books the fee twice.

**Keeping evidence current is two `defineParentReconciler`s, not a router.** A fired record
rule *marks*; the drain rebuilds once per parent after commit, however many per-field rules fired.
`customer-money/order-evidence-reconciler.ts` owns order payment evidence and
`payouts/payout-reconciler.ts` owns the payout assessment (`payouts/assess-payouts.ts`), which is
the degenerate case of the primitive: a marked `payout` or `processor_balance_entry` **is** the
parent, so there is no `resolve` and the work is `rebuildBatch` because one assessment covers a
whole batch.

🔑 **The order reconciler is one key with kind-tagged ids** — `order:<id>`, `line_item:<id>`,
`customer_transaction:<id>` — and `resolve` maps all three onto order instance ids. Two keys would
be the obvious shape, but then an order and its own lines dirtied by one write drain twice.

⚠️ **The sync's bulk path calls the batch entry points directly** rather than marking
(`customer-money/record-events.ts`'s `reconcileFinancialRecordsAfterBulk`): nothing opens a
dirty-parent scope at sync finalize, so a mark per record would run one assessment per record.

⚠️ The word "reconcile" carries five meanings in this cluster. `totals`, `billing`, `match` and
`drift` reconcilers are parent rebuilds; these two are an evidence *assessment* wearing the same
primitive, which is why the payout function is named `assessPayouts` and not `reconcile…`.

🛑 **The `rails.ts` clearing balance is the ACCOUNT's, never the rail's** — nothing stamps a
gateway onto a `GlPostingLine`, so two rails sharing an account get the same balance with
`sharedWith` naming the other. And it is called "clearing balance", never "unsettled": it is
shipped-not-settled **minus** settled-not-shipped.

### 8.6 Stripe: one platform account, three jobs

auxx has **one** Stripe platform account doing three unrelated jobs, told apart by which webhook
endpoint the event arrives on:

| Job | Who pays whom | Code | Webhook secret |
| --- | --- | --- | --- |
| **Platform billing** | the org pays auxx.ai | `@auxx/billing`, `apps/web/src/lib/stripe.ts` | `STRIPE_WEBHOOK_SECRET` |
| **Stripe Connect** | the org's customers pay the org | `accounting/money/stripe-connect/`, `money/checkout/`, `accounting/sales/credit-memos/card-refund.ts`, `money/payouts/sources/stripe-connect.ts` | `STRIPE_CONNECT_WEBHOOK_SECRET` |
| **Financial Connections** | nobody; auxx reads the org's bank | `data-connectors/connectors/stripe-financial-connections*.ts`, `accounting/banking/feed/fc-*.ts` | `STRIPE_BANKING_WEBHOOK_SECRET` |

A fourth meaning is not ours at all: **Stripe as a system the org uses** — the `stripe` rail in
`accounting/rails/rail-catalogue.ts`, the inbound webhook preset, the brand icons. None of it
touches our key, and it keeps the bare word.

🛑 `accounting/money/stripe-connect/client.ts` is the **only** place a Connect call constructs a
`Stripe` instance, and everything on it runs on the **platform** secret key — the same one billing
runs on. There is no per-org token and no OAuth client, which is most of why this provider was
chosen and also why none of it may ever be handed to sandboxed app code: a Shopify token
compromises one store; this key is auxx's identity across every org. `banking/feed/fc-client.ts`
and the Financial Connections connector borrow that client by importing
`accounting/money/stripe-connect/client`, which at least names what they are borrowing.

**For new code:** a module, file or function that uses the platform key is named for its job —
`billing`, `stripe-connect`, `financial-connections` — not `stripe`.

---

## 9. Source Evidence

Five tables under `financial-source-*.ts` separate *what a provider said* from *what we booked*.
Every one carries `(organizationId, id)` as a unique, and every cross-table FK is composite with
`onDelete: 'no action'`: org deletion cascades, scoped financial references preserve history.

| Table | Holds |
| --- | --- |
| `FinancialSourceAccount` | One connected account/store: `providerKey`, `externalAccountId`, `environment`, a human `name`, `paymentGatewayId` |
| `FinancialSourceObservation` | An immutable record of what a provider reported, with its content hash |
| `FinancialSourceAcceptance` | That an observation was accepted as evidence: `state` (`pending`/`accepted`/`rejected`/`blocked`), `moneyTransactionId`, `unresolvedReferences`. One per source object |
| `FinancialSourceCoverage` | How far acquisition has progressed. CHECKed: `accepted + rejected + pending = fetched` |
| `FinancialSourceObject` | The provider object an observation is about |

`money/customer-money/source-reads.ts` and `source-writes.ts` own all five:
`readSourceAccounts` / `readSourceObjects` / `readAcceptance` / `readOrderCoverageRow`,
`findSourceObjectByIdentity` (all five columns of the unique key), `readCurrentObservations` —
the one definition of "latest", ordered `(observedAt, id)` — and the upserts both the storage and
the evidence lane call, including `refreshOrderCoverageCounts`, whose one predicate keys the tally
on the acceptance's resolved `orderInstanceId` — an acceptance that resolved to no order is
coverage of no order — so the two lanes cannot disagree about `complete`. `payouts/entry-reads.ts`
is the same for `ProcessorBalanceEntry` (`readEntry`, `listPayoutEntries`).

🔑 **`FinancialSourceAccount.id` is the source scope key** (brief 47) — not the connector id, not
the credential id. Neither of those is 1:1 with a store, and neither survives a rebuild or a
reconnect. It is also what scopes the role map (§4.4), so two stores can keep revenue apart.

`paymentGatewayId` is the other direction: which rail this feed settles for, null until a person
links it. **A rail nothing points at is a manual rail.** It is durable configuration a person
created — the same class of thing as a bank account record, not connector plumbing re-minted on
reconnect — so it survives a reinstall the same way the store scope does.

`exportShape` is gone with the Sales Receipt shape (91 §8.13, drizzle `0390`); every shipment
exports as an Invoice (§11.3). Since 91 an acceptance whose order has not arrived is accepted
anyway, with an `ORDER_NOT_FOUND` work item at stage `evidence` (§8.3), and the acceptance's
retry columns live on `AccountingWorkItem` (§8.4c). The rest of this section is brief 94's to
rewrite.

`MoneyTransfer` and `ProcessorBalanceEntry` extend an existing canonical `EntityInstance`
identity, with ordinary `FieldValue`s carrying provider facts and shared domain events doing
reconciliation (§8.5's two reconcilers). Whether that is the right physical shape is
[still open](../plans/accounting/decisions.md) — see §15 item 15.

---

## 10. The Rails

A rail is a `payment_gateway` **record** carrying its own clearing account. 🛑 **Never a role** —
naming one would need a role per gateway, and the vocabulary is closed (§6.1).

| File | Owns |
| --- | --- |
| `rails/client.ts` | The vocabularies, the read model, and the pure handle arithmetic (`normaliseGatewayHandle`) |
| `rails/reads.ts` / `writes.ts` | Every read and write over `payment_gateway`, plus `listLinkedFeeds` — the one feed-discovery read, every live `FinancialSourceAccount` linked to a rail. **No delete** — `status: 'closed'` is the removal answer |
| `rails/rail-catalogue.ts` | `suggestRail(handle)` → a rail name, settlement source, fee treatment and two account names. 🛑 **Suggestions, never routing**, and the function is TOTAL: an unknown handle is never refused |
| `rails/mint-rail-accounts.ts` | Mints the chart accounts one rail needs. 🛑 **Not inside `createPaymentGateway`**, and 🛑 **a minted account gets NO role** — it is named by a rail-scoped `GlRoleAssignment` row |
| `rails/rail-fee-status.ts` | What the close can honestly say about a rail's processor fees. 🛑 **A fact, never an alarm and never a refusal** — it produces a date, and `prepareClose` does not call it |
| `rails/feeds.ts` | Linking a processor feed to a rail (`FinancialSourceAccount.paymentGatewayId`) and whether a rail is ready to post |
| `rails/repoint.ts` | What moving a gateway's clearing account is about to strand. ⚠️ It reads what is *posted to the account*, which is not the same as what *this gateway put there*, and the transfer entry is deliberately not here |
| `rails/rail-groups.ts` | The census grouped by rail (`buildRailGroups`) and the setup defaults (`defaultMintFeeAccount`, `isStaleRail`). Pure and client-safe; the wizard and `connect-and-go/auto-route-rails.ts` share it |
| `rails/settlement-discovery.ts` | Live processor sources with settlement evidence and no rail linked yet |

**Netted vs billed.** A rail with a linked live `FinancialSourceAccount` is polled by its
`PayoutSource` and settles **net** — the payout entry drains clearing and expenses the fee. A rail
nothing has linked is **billed**: it deposits gross, is relieved by a coded bank line plus a
monthly fee entry, and wants no feed, ever.

### 10.1 Banking

`accounting/banking/` is the bank feed and its review queue, in four subfolders: **`feed/`** (the
Stripe Financial Connections connector, coverage, descriptor and match-key normalisation, the
webhook, the reaper), **`import/`** (the bank half of the shared CSV/OFX importer; the pure OFX
parser lives in `@auxx/lib/import/client`, because it belongs to the FORMAT and not to banking),
**`review/`** (the queue, and `BANK_TRANSACTION_POSTING_TYPE`'s coded and transfer entries), and
**`rules/`** (rules, suggestions, and the unsafe-regex guard).

**Matched lines post nothing** — a match links both ways and stamps the document. **Coded lines
post** `Dr <code> / Cr <the bank account's GL code>`; the key carries an attempt counter because
an undo reverses the posting and a re-code must not re-claim the reversed tuple as
`already_posted`. A transfer posts one entry on the outgoing leg and matches the other. The poster
pins the raw columns so the feed cannot rewrite a posted row.

⚠️ `banking/writes.ts` reaches the feed through its **leaf** module, never the `./feed` barrel,
because that barrel pulls the Stripe SDK and the connector engine.

🛑 **Disconnecting a feed goes through `disconnectConnectors`, re-arming through
`rearmConnector`** (`data-connectors/mutations.ts`), never a hand-written status write: the feed is
provisioned `syncBehavior: 'scheduled'`, so the 12-hour repeat job has to be removed with the
status and registered again with it.

---

## 11. The Export: Outbound

### 11.1 The batch

**One `ExportBatch` is one provider object**: its `objectType`, a frozen payload and that payload's
hash, the provider's id and sync token for it, its state, and the detail postings it rolls up
through `ExportBatchPosting`. In Transaction mode a batch holds exactly one posting; the Sales
Receipt shape that absorbed a fulfillment's receipts into its batch is gone (91 §8.13).

```
ready → sending → sent
          └→ failed (retry)      sent → withdrawn (rollback)
```

`withdrawn` is terminal; the next build makes a new batch out of the freed postings.

A refusal is kept as more than prose (89 D1): `failureClass` is the adapter's own verdict
(`configuration` | `data` | `transport`, null on a crash) and `failureItems` the pieces of work
behind a configuration refusal — one `unmapped_account` / `invalid_mapping` item per `gl_account`,
the shape `EntryBlockers` renders. 🛑 **Only `transport` is retried automatically** (89 D3):
`fail()` sets `nextAttemptAt` for that class alone, so a batch refused on setup or data waits for
a person and the Retry button, exactly as `ledger/types.ts`'s `PostFailureClass` has always said.

Two partial unique indexes carry the design:

- `ExportBatch_grain_key` on `(organizationId, bookId, avenue, grainKey, coalesce(storeId, ''),
  coalesce(railId, ''), currency)` **WHERE `state <> 'withdrawn'`** — one live batch per grain
  bucket. The `coalesce` is there because NULLs are distinct in a unique index, so two store-less
  summary rows would not collide.
- `ExportBatchPosting_live_posting_key` on `(organizationId, glPostingId)` **WHERE `withdrawnAt IS
  NULL`** — one live batch per posting. A rollback stamps `withdrawnAt` rather than deleting the
  row, so the membership history survives.

`build-batches.ts` uses `onConflictDoNothing` rather than a read-then-write: two builders racing
the same grain must produce one batch, and the partial index is the only thing that can settle
that.

`export/queue-reads.ts` owns the export tables' reads: `listExportBatches` and
`countExportBatchesByState` behind the Outbox, and `readLiveBatchMemberships` for anyone asking
which live batch holds a posting. The list's month filter is the half-open window from
`monthBounds` (`ledger/periods/periods.ts`) — `2026-02-31` is not a `date`.

### 11.2 The two gates

```
source event final
   │  posts at once — no drafts (§5.5)                  ← our books
   ▼
posted
   │  autoSend off → export queue (hold, release)      ← gate 2: the provider
   ▼
sent
```

Gate 1, the draft queue, was deleted by 91 D5: review happens here, before anything leaves.
Reverse acts on the left column. Retry, rollback and release act on the right. **No verb does
both.**

🛑 **`release.ts` releases and returns.** A single send is two sequential round trips to a
rate-limited third party (QuickBooks: the layer-2 `find`, then the `create`; plus the chart on an
org-cache miss and two per cold customer or item, 93 §2), and a bulk bar acts on forty rows at once,
so doing it inline is a request nobody holds open. A release enqueues `export-batches` jobs of
`EXPORT_BATCHES_PER_JOB = 10`; `send-many.ts` leases the set in one UPDATE and sends it through
`sendObjects` — for QuickBooks one batch `query` for the set's DocNumbers and one batch `create` for
the misses, **two calls per set** where the single path spends two per object (93 D3/D4). A set never
mixes a payment with an unsent batch it applies to: the walk cuts there, settles, and carries on.
`retry.ts` and a single Send stay on the one-row `export-batch` job, precisely because a single row
wants its refusal back in the same breath. The sweep still sends one row at a time, five per org,
until the throttle question (93 Q2) is answered on the sandbox.

`sweep.ts` is the scheduled half: due means `ready` on an avenue whose `autoSend` is on, or
`failed` past its `nextAttemptAt` and inside `MAX_AUTO_ATTEMPTS = 3` (backoff 60s / 5m / 30m). A
**held** batch — `ready` with `autoSend` off — is never touched: releasing it is a person's act.

`send.ts` leases one batch (`LEASE_MS = 5 min`), and the lease is claimed **in the WHERE clause,
not in JS**: two workers reading the same free lease must not both win, and only the update can
settle that. `not_connected`, `disabled` and `waiting` decrement `attempts` and return the batch
to `ready` — they do not spend the sweep budget.

🛑 **The mapping table is read before the provider is** (89 D7/D8). `export/preflight.ts` walks a
batch's frozen payload for its `glAccountId`s and checks them against `provider.listAccountMappings`
— our database, no provider call, `unmapped_account` only. `listExportBatches` runs it over `ready`
rows so the tab shows the refusal before anyone presses Send; `releaseExportBatches` will not
enqueue a batch it flags; `sendExportBatch` runs it after the lease and fails the batch as
`configuration` with the items and no round trip. It is a subset of the adapter's own resolution
at send time (`invalid_mapping` needs the live provider chart), never a contradiction of it, and
it never reaches back into the ledger: a post never asks whether a provider account exists (P2).

**Send is idempotent by readback**, not by a request-id contract. `idempotencyKey` is derived from
the batch identity alone, so every retry carries the same key. ⚠️ `readbackMismatch`'s
`unsupported` is **not a failure**: a provider with no per-object read cannot answer, and refusing
the send afterwards would withdraw an object that is correctly there. The comparison reads the
create's own answer first (`SendObjectResult.echo`, 93 A2) and calls `readObject` only when a
provider echoes nothing; `readObject` stays on the seam for those providers and for rollback.

🛑 **`rollback.ts` is an EXPORT operation, never a ledger one.** Nothing there reverses, reopens a
period or releases a claim: the postings stay `posted` and come back to *Ready*. Backing an entry
out of *our* books is `reverseEntry` — a different button with a different meaning. Rollback order
is load-bearing: a Payment must be withdrawn before the Invoice it applies to, so an Invoice batch
refuses while one is still there.

### 11.3 Mode, shape and settings

| Setting | Decides |
| --- | --- |
| `accounting.exportMode` | `transaction` \| `summary`. Fails closed to `transaction` |
| `accounting.exportModeCutover` | The date the mode applies from. A posting dated below `max(cutover, connection.exportFromDate)` is skipped |
| `accounting.autoSend.<avenue>` | Gate 2, per avenue. Unset → off |
| `accounting.summaryGrain.<avenue>` | `day` \| `month` \| `payout` for the nine grained avenues (`SUMMARY_GRAIN_AVENUES`, §13.3). Payouts, bank deposits and journals have no grain — one object each |

**The avenue is a stored column.** `avenueOfPostingType` is the exhaustive posting-type → avenue
map, applied once in `insert-posting.ts` and written to `GlPosting.avenue` (task 92); every read
that groups or filters by category — the Outbox tabs, the unbuilt summary, the builder's
candidate scan — reads the column, never the map. The switch has **no `default` case**, so a
posting type added later fails to compile rather than silently landing in no avenue at all, and
`GlPosting_avenue_check` pins the same list in SQL. Three types answer `null` — `opening_balance`
(an opening entry has no provider counterpart), `provider_sync` (the loop guard) and
`bank_transaction` (the provider already has the bank feed). The twelve avenues are the
provider-object families of TARGET §5's last column: `fulfillment · invoice · receipt · refund ·
creditMemo · expenseBill · vendorPayment · vendorCredit · payout · bankDeposit · inventory ·
journal`. `inventory` is journal-shaped at the provider but its own lane, because inventory
movements are most of what leaves and nobody wants them filtered as "journal".

**`ExportBatch.objectType` is one of eight, and `journal` is only one of them.**
`export/payloads/` holds one file per object type — each a Zod schema, its `*_OBJECT_TYPE`
constant, and nothing else — and `payloads/index.ts` owns `EXPORT_OBJECT_TYPES` plus the
discriminated `parseExportPayload` that turns a stored `(objectType, payload)` pair back into its
shape. 🛑 **The payload layer and the adapter's handler table are checked against each other at
module load**: `quickbooks-accounting-provider.ts` throws on import if any `EXPORT_OBJECT_TYPE` has
no handler, so a new object type cannot silently fall through `sendObject` as "unrecognised".

`object-shape.ts` is **pure** and turns one posting plus its roled lines into one of those objects.
`shapeForPosting` switches on `postingType`:

| Posting type | Object |
| --- | --- |
| `fulfillment`, `invoice_issued` | `invoice` |
| `payment` | `payment` |
| `credit_memo` | `credit_memo` |
| `refund` | `refund_receipt` |
| `payout`, `bank_deposit` | `deposit` |
| `vendor_bill` | `bill` |
| `vendor_credit` | `vendor_credit` |
| everything else | `journal` |

🛑 **Every shipment is an Invoice and every receipt a Payment** (91 §8.13). Our two entries map
one to one onto the pair; QuickBooks applies the waiting Payment to the Invoice itself and derives
both its accrual and its cash P&L from them. The Sales Receipt shape — `exportShape`,
`wantsSalesReceipt`, the `auto` fork, `readReceiptsForOrders` and the absorbed members — is
deleted: it read a sibling, and under per-event receipts it pulled a receipt already sent as a
Payment into a later Sales Receipt, booking the cash twice.

Each shape classifies its own lines by role and **falls back to `journal`, with a reason, the
moment a line does not fit — never a refusal**. The default branch for `write_off`,
`manual_journal`, `recurring_journal`, `inventory_movement` and the two `month_end_*` types is a
plain journal, *not* a fallback: nothing was tried and rejected.

🛑 A line names `glAccountId` and `accountCode`, **never a provider account id** (decision `P2`) —
on a journal line, a `payment`'s `depositTo`, a `deposit`'s `fromAccount`, all of them. The
adapter resolves them at send time, so a batch built before a mapping changed sends against the
mapping that is live when it goes.

⚠️ **A Deposit's `totalMinor` is the bank leg's amount, not the posting's.** `GlPosting.totalMinor`
is the entry's gross balancing total (`Dr bank + Dr fees`); what a Deposit records is the net that
actually lands, which is what the signed lines — the fee carried as a negative — sum to.

Summary mode still emits only `journal` (D3): `readLedgerSummary` already emits one row per posting
for the grain-less avenues, so both shapes come out of one read, and a summary batch mints its own
`AUXX-SUM-<hash>` document number because it has no posting to borrow one from.

A summary journal carries `summary: { storeId }` (91 §8.14). QuickBooks refuses an A/R line
without a customer, and a summary line has no counterparty, so the adapter resolves the store's
per-platform placeholder customer (`resolvePlaceholderCustomer`, `objects/journal.ts`) for a
receivable line; a payable line without a counterparty still refuses.

### 11.4 The provider seam

`accounting/providers/provider.ts` declares `AccountingProvider` and the manager that resolves the
one an organization has connected — shaped after the house provider/manager pattern. An
organization with nothing connected gets `NONE_ACCOUNTING_PROVIDER`; its postings are built and
persisted identically.

Fifteen members: `id`, `init?`, `resolveAccount` (the ONLY place a code becomes a provider
identifier), `sendObject`, `sendObjects?`, `readObject`, `listProviderAccounts`,
`readProviderBalances`, `ledgerSlicer`, `listAccountMappings`, `setAccountMapping`,
`clearAccountMapping`, `withdrawObject`, `objectUrl?`, `createProviderAccount?`.

🛑 **`payload` is OPAQUE above the seam**, and its shape belongs to `objectType`, not to the
interface: a second provider implements the same three methods over the same three words. No
posting or batch vocabulary appears in the interface on purpose.
🛑 **`readObject` answers `unsupported` rather than inventing a result.**
🛑 **`sendObject`'s `waiting` is not a fault.** A Payment whose Invoice has not sent yet answers
`waiting` with a reason; `send.ts` releases the lease and gives the attempt back, exactly as it does
for `not_connected` and `disabled`. Nothing names the dependency across the seam in either
direction — the sweep's `txnDate, createdAt` ordering is what normally sends the invoice first.
🛑 **`withdrawObject` must converge on "not there"** rather than raising when the object is already
gone — that is what makes an uncertain delete resolvable by retrying.
🛑 **`objectUrl` is the only place a vendor URL may be built** — never in a component.
🛑 **`createProviderAccount`'s absence IS the capability flag.** So is `sendObjects?`'s: without
it `send-many.ts` asks `sendObject` row by row. Its answers are aligned with its inputs, each the
verdict `sendObject` would reach alone; the outer `err` means no object got one. QuickBooks sends
`vendor_credit` (not in `batch_quickbooks_operations`) through its single tools inside the same call,
and falls back to them entirely when the installed app has no batch tool. Intuit dedupes a batch
item only on the call's `requestid` plus the item's `bId`, so both are hashed from the set's
per-batch idempotency keys (`send-objects.ts`); the layer-2 query and the 6140/6240 net stay the
real guard when a retry's set differs.
🛑 **`ledgerSlicer` is a slicer rather than a `readProviderLedger(from, to)`**, because a date
range is QuickBooks-shaped and cannot serve Xero, whose Journals feed is walked by an offset on
creation order. `NULL_LEDGER_SLICER.fetchBatch` answers `ok(null)` and **not** an empty batch: an
empty batch reads as "the accountant posted nothing that month".

⚠️ **The adapter registers from the app layer.** A standalone script that never boots the app gets
the null provider and is told *"No accounting system is connected"* on a fully connected org. Call
`registerAccountingProviders()` in any probe script, or the answer is meaningless. **Every process
that posts must call it at boot — web AND the worker.**

`providers/quickbooks/` is the one implementation. The three object methods dispatch through one
`OBJECT_HANDLERS` table to `objects/<type>.ts`, one file per object type, each owning its own
`send` / `read` / `withdraw`; `objects/customers.ts` and `objects/items.ts` are not object types but
the referenced-record resolvers a native payload needs first — a Customer or Vendor for the
counterparty, one generic Service item per income account — and they are why a native object can
refuse where a journal could not. `objectUrl` is a second table, `OBJECT_URL_PATH`, keyed the same
way. `account-map.ts` keeps the mapping in a hidden connection-scoped cell on the `gl_account`
instance; `account-types.ts` is the outbound half of the type vocabulary; `identity-field.ts`
mirrors ids into `RecordIdentity`.
`account-identities.ts` and `suggest-account-identities.ts` sit above the seam and **know nothing
about QuickBooks** — the identity list is a checklist with a row for every live account, and 🛑 **a
suggestion is never a mapping**.

`providers/provider-agreement.ts` compares our trial balance against their balance sheet. 🛑 **It
renders a COMPARISON and never becomes a statement source.**

### 11.5 The Outbox — the one screen, four tabs

`OUTBOX_TABS = ['blocked', 'ready', 'sent', 'failed']` (`export/client.ts`). `blocked` is not an
`ExportBatchState`: it holds work the ledger has not posted at all, which is why it stands ahead of
the export states rather than among them. Beside the tabs a view dropdown (`?view=`, brief 95)
picks **Summary** — one row per grain bucket, whether or not a batch exists — or **Transaction** —
one row per posting with its export state. Ready, Sent and Failed filter whichever view is
showing; Blocked ignores it. Every tab lists **all periods**.

🛑 **`sending` is a state, not a tab** (75 D6). A batch mid-send stays listed under Ready and spins
there — a momentary state is not a place to stand, and a batch that vanished from the tab you were
looking at read as a failure. `exportBatchTabAdmits` is what makes Ready admit both, and
`parseOutboxTab` lands a pasted `?tab=sending` on Ready rather than an empty strip.

**Blocked is the ledger's parked work** (75 D1, 91 D6). One row per
`(reasonCode, role, railId, glAccountId)` group over `AccountingWorkItem` (§8.4c) — *"100 receipts
blocked: clearing is not mapped for Shopify Payments"* is one row — with the code's sentence and
severity from `work-items/client.ts`, a count, and an expansion to its items
(`listBlockedWorkItems`); a movement item opens the `?movement=` frame and a shipment the
`?shipment=` frame, in the one ledger drawer host. The category (receipt, refund, vendor payment,
fulfillment, credit memo, payout) is derived from the source in SQL. **Map** deep-links to
`/app/accounting/settings/accounts?role=<role>`, which seeds the Mapping tab's search box so the
row is on screen. **Retry all** (`retryBlockedGroup`) sets `nextAttemptAt` on the group and
returns — the recovery job does the posting, as release does for the outbox. The badge counts
groups and leaves skipped codes out.

`money/blocked-movements.ts` holds `sweepMovementAccounting`, the movement lane of the work-item
sweep, for every purpose. 🛑 **The poster is chosen from the movement's purpose and its own
`MoneyApplication` rows** (`resolvePoster`): a refund, a vendor payment and a vendor refund to
their own posters; a receipt applied to an invoice to the invoice poster; every other receipt to
the customer receipt poster (§8.3) — never from a provider key.

⚠️ A **document**-level refusal (a bill's Post button) has no lane here and needs none: it refuses
synchronously, the callout names the remedy, and nothing is written.

**Failed is the export's parked work** (89 D6), and it refuses in the same voice as Blocked. A
`configuration` batch with items renders one `EntryBlockers` row per account — Map deep-links to
`/app/accounting/settings/accounts?s=chart&account=<glAccountId>`, the Chart tab's editor, where the
`ProviderAccountPicker` is — and the drawer's Export section hosts the picker inline plus **Retry**
(89 D5: Retry is the one-row door and belongs in the drawer; Un-sync stays on the queue). The
other classes print `lastError` verbatim under a class hint. **Ready shows the same block** on a
batch the mapping table already refuses, with Send now disabled (89 D7). 🛑 The unmapped-account
sentence names the *Chart of accounts* tab: the role remedy and the account remedy send people to
one page for two different mappings, and a person who has just mapped the role reads "map it under
Accounts" as done (89 §1.6).

**The Outbox moves while a send happens** (93 §3). `send.ts` publishes `exportBatch:changed` on the
org channel at the lease (`sending`) and wherever `releaseOwned` settles (`sent`, `failed`, or back to
`ready`), and `rollback.ts` publishes `withdrawn` — so the sweep, a Send, a Retry and a Release all
announce every transition. `export/realtime.ts` wraps the publish; it never throws into a send.
`use-outbox-realtime.ts` patches the row in every cached `exportBatches.list` page and moves
`outboxCounts` by the delta (invalidating when the row is not cached, or on `withdrawn`). 🛑 A row
never leaves its tab on a frame: `sent` leaves Ready on the next refetch, because admission is
`exportBatchTabAdmits`, the server's rule. `releaseExportBatches` mints a `runId` (never stored),
puts it on each job and returns it; the header strip reads `n of N sent · f failed` off the frames
tagged with it and clears when every row has settled, when a counts read begun after the last
frame shows nothing `sending`, or after `RUN_IDLE_MS` (30 s) with no frame at all — realtime off or
the worker down — followed by a list refetch. The panel's invalidate-on-mutation stays as the safety
net: realtime has no replay.

**A bulk Retry enqueues** (93 §4). `exportBatches.retry({ batchIds })` is `releaseExportBatches`
with `manual: true`, carried on the job so the send resets `attempts` exactly as the one-row
`retry({ batchId })` does, and answers the same `{ runId, released, skipped, blocked }`. The bar
drives it through `useBulkRunner.enqueue`: every row goes pending up front and clears as
`useOutboxRealtime().watchRun` reports its frame settled (settles that beat the answer are
replayed), when the strip closes the run, or after `ENQUEUE_IDLE_MS` without a settle. 🛑 Rollback
does not follow (Q3): it stays one synchronous `ledgerControl` call per row, because the provider's
refusal is the answer the operator pressed it for.

---

## 12. The Mirror: Inbound

**A raw copy of the provider's ledger, in its own tables.** `ProviderLedgerEntry` /
`ProviderLedgerLine` hold every transaction they have, verbatim: their transaction id, their
object type spelled their way (`'Journal Entry'`, `'Bill Payment'`), their date as a string, their
sync token, and lines carrying **their** account ids. It includes the objects we sent. It never
mixes with `GlPosting`, and it is the source both the translation and the export's readback read.

### 12.1 Authorship

🛑 **Every entry has exactly ONE author, forever.** An entry auxx wrote is never edited in the
provider and pulled back; an entry the accountant wrote is never edited in auxx and pushed back.
There is no merge, no conflict resolution, no last-writer-wins — two disjoint sets moving in
opposite directions, unioned into one ledger. `ProviderLedgerEntry.author` is `'auxx' | 'provider'`,
stamped once, by `writes.ts`.

⚠️ **The predicate is keyed on the PAIR**, never on the id alone: a `Purchase` sharing an id with
one of our `JournalEntry` rows would otherwise silently drop a real expense. The transaction id is
the primary key and the document number is the second witness.

### 12.2 The three rules of the sync

1. 🛑 **The cutover floor is asserted before the first call**, inside the source's factory.
   `planSyncChunks` **refuses** rather than clamps, so no slice can reach a date below it. This is
   the second of the two ways this feature can double a ledger: the opening entry *is* the
   provider's own pre-cutover position restated as one entry of ours, so reading back the period it
   summarises imports the very balances it was derived from. The floor is the first day of the
   month **after** `accounting.cutoffPeriod`.
2. **One month per call.** Report endpoints do not paginate — `startposition` and `maxresults` are
   accepted and ignored — so the date range is the only lever, and a chunk that silently truncated
   is indistinguishable from a quiet month. **Chunk size is a safety property, not a tuning knob.**
3. **Converge by re-reading, never by tracking changes.** A re-read writes what is new (the claim
   makes a repeat a no-op) and **reverses** anything held as `provider_sync` in that range whose id
   has stopped appearing. A reversal, never a delete (`G4`); a mirror row that stopped appearing is
   stamped `withdrawnAt` rather than deleted.

🛑 **Nothing in `writes.ts` reaches `GlPosting`, and nothing repairs one of our entries.** The
comparison produces a report and nothing else: there is deliberately no writer that restates our
posting from theirs or re-pushes ours over theirs.

### 12.3 Translation

`translate.ts` turns the accountant's half into our rows: one `provider_sync` posting per
`author: 'provider'` entry, subject `(provider_ledger_entry, <mirror row id>)`.

🛑 **Only `'provider'` entries.** The mirror holds the objects we sent too; translating one would
double it, both copies would balance, every statement would still tie, and nothing downstream
could detect it. `author` is the guard.

🛑 **An unmapped provider account is a REFUSAL naming it**, never a guess and never a fallback
account.

The `periodKey` is **their transaction id**, not a date: the claim index gives per-transaction
idempotency for free, exactly as a payout keys on a payout id.

**It reopens nothing.** An entry dated in a month our own lock has closed is normal — it is the
accountant's December adjusting entry arriving in February, which is the case this whole feature
exists for — so it is *reported* as `deferredToClosedMonths` and a person with `ledgerControl`
decides. Reopening from here would put the decision somewhere with no audit trail and no human.

An unbalanced entry is skipped **silently** because `planProviderSync` already reports it, and a
zero-value entry is its own outcome: the provider's opening inventory-adjust rows are four real
transactions that look exactly like that.

### 12.4 Markers and cadence

Two settings, and the split is load-bearing:

- **`accounting.providerSyncedThrough`** — "this range has been read completely". Written once per
  clean chunk, and it correctly takes the org-wide accounting lock. 🛑 **It may only ever advance
  over a chunk that actually succeeded**: a marker that ran ahead of a failed chunk lies in the one
  direction that matters. "Where the walk is" and "how far is vouched for" are two different values
  and only the second is this one.
- **`providerSync.state`** / **`providerSync.schedule`** — where the walk is and how it is going,
  written after every slice. 🛑 The `providerSync.` prefix is **not** a naming preference: an
  `accounting.`-prefixed blob would grab the org-wide accounting commit lock on every slice write.

**Cadence is "at close, plus on demand". Not continuous.** Daily polling of a report endpoint
spends rate limit answering a question nobody asks on a Tuesday. ⚠️ That is an argument against a
*schedule*, not against a *worker* — the two are separable, and `mirror/scheduler.ts` registers the
scheduled door so that a scheduled walk and a pressed one are the same walk.

---

## 13. Statements and Reports

`accounting/reports/`. All of them are presentations of one sweep over `GlPostingLine`. The
aggregates share the line predicate — `standingLineFilter` (`ledger/reads/standing-lines.ts`) over
`POSTED_STATUSES`, the one export in `ledger/types.ts` — and keep their own select lists.

| Report | File | Shape |
| --- | --- | --- |
| Trial balance (primitive) | `trial-balance.ts` | `GROUP BY glAccountId` over `[from, to]`. 🛑 Cumulative, no fiscal year — five readers compose it |
| Trial balance (statement) | `trial-balance-statement.ts` | As of ONE date. Composes three of the above; §13.1's boundary; computed retained earnings |
| Balance sheet | `balance-sheet.ts` | As of one date; splits equity at `fiscalYearStart(asOf)` |
| Profit & loss | `profit-and-loss.ts` | A true range report |
| General ledger | `general-ledger.ts` | Per-account lines; optional `glAccountId` filter |
| A/R + A/P aging | `aging.ts` | As of one date, grouped by document; a movement's line attributed through `MoneyApplication` (§13.2) |
| 1099 | `vendor-1099.ts`, `vendor-1099-rows.ts` | Per vendor |
| Dimension breakdown | `dimension-breakdown.ts` | Group by a `dimensions` key |
| Completeness | `completeness.ts` | Which months and which posting types the books are incomplete for |

🛑 **Completeness is not the export backlog.** The statement reads do not filter on anything the
export wrote, so a pending or refused batch is not an incomplete book. `provider_sync` is in
`NEVER_CLOSE_EMITTED` because it is inbound and never emitted by a close; a banner saying "provider
sync posting is off" would be permanent and unfixable.

### 13.1 🔑 The fiscal-year boundary is a read rule, not a posted entry

auxx posts **no closing entries**. At the fiscal-year boundary, revenue and expense accounts do
not get zeroed by a journal entry; instead **every read** shows a P&L account from
`fiscalYearStart(asOf)` and derives a Retained Earnings row for everything before it. Equity never
moves — the amount simply shifts from the "this year" bucket to the "prior years" one.

🛑 **This is a property of every read path, including the general ledger**, not a statement
convention. A P&L account's beginning balance in the ledger is fiscal-year-to-date, not
life-to-date. A new report that forgets this will disagree with the row it was opened from.

✅ **The door to posted entries is open and costs nothing to keep.** `retainedEarnings()` accepts a
`postedRetainedEarningsBalance` and reports `priorYearsSource: 'posted' | 'rolled_forward'`, so a
posted closing entry — or a provider's imported RE balance — flows through the same function.

⚠️ A computed Retained Earnings row needs its `meta.note` treatment ("computed from the P&L, not a
posted balance"), or it reads as an account somebody posted to.

🛑 **`readTrialBalance` is the shared primitive and does NOT know about the fiscal year.**
`readBalanceSheet` makes three raw calls to it, `readTrialBalanceStatement` the same three,
`readProfitAndLoss` one and `aging.ts` one. Teaching the boundary to the primitive would make the
balance sheet apply it twice. A new report that wants the boundary composes; it does not reach
down.

⚠️ **The trial balance's computed row is `priorYearsMinor`, not `balanceMinor`.** Resetting P&L
accounts breaks `Σdebit = Σcredit` by exactly prior-year net income, so that is the whole plug.

🛑 **`fiscalYearStart(date, startMonth)` takes the month; it does not read it.** The org's value
lives in `accounting.fiscalYearStartMonth` and is resolved **once per report** —
`resolveFiscalYearStartMonth()` server-side, `useLedgerPeriod().fiscalYearStartMonth` in the
browser — then passed down. A read path that calls `fiscalYearStart(date)` with no month silently
assumes January and will disagree with the row it was opened from. Both readers normalize through
`normalizeFiscalYearStartMonth()`, which falls back to January rather than throwing: one
hand-edited row must not take down every statement in the org.

The setting is **not** frozen after the first posting, unlike `cutoffPeriod` and `bookTimeZone`:
those change a posted entry's `txnDate`/`periodKey`, this one writes nothing to the ledger at all.

### 13.2 Aging groups by the source document

`aging.ts` walks posted lines on **every** receivable or payable account — the role's default
plus every account whose subtype is `accounts_receivable` / `accounts_payable`, which covers A/R's
per-store accounts — groups them by document, nets each one, and ties its total against
`readTrialBalance`'s sum over those accounts (the `verdict`, shown even when false).

🔑 **The receivable a shipment raises is sourced on the `order`, not on an invoice.** The
DTC/dealer revenue path has no invoice record at all — `invoice` is the separate service-business
billing flow, and orders settle immediately with no due date. Only `invoice` and `vendor_bill`
carry a due date a report can bucket on; everything else is `current`, grouped by contact where one
resolves and into an "Unapplied and adjustments" catch-all otherwise. A new A/R- or A/P-touching
`sourceType` needs a branch here too, or its lines still tie (the total is a GL sum, not a join)
but land in the catch-all.

🔑 **A receipt or refund line is sourced on its movement, and aging attributes it through
`MoneyApplication`, never through the line** (91 §4.1; `reports/receivable-attribution.ts`, shared
with the statement split below). Live applications only, prorated by largest remainder across the
documents the movement is applied to; the unapplied remainder stays on the movement and lands in
the catch-all (`AGING_UNAPPLIED_GROUP_ID`); a refund follows its `MoneyRefundSettlement` or the
receipt it reverses; a credit memo folds into its order or invoice. Link-later therefore repairs
attribution without touching the ledger. The match is `'money_transaction'`: until 91 it read the
retired Dispatch-era `'payment_transaction'`, so every receipt credit fell into the catch-all.

**Paid before cutover** (`AGING_PRE_CUTOVER_GROUP_ID`, 91 §8.7). A document whose applications all
predate `accounting.cutoffPeriod` groups there rather than in `current`: the opening entry carries
that money by account, not by document, so the balance sheet was right and only aging needed the
rule.

**The statements split each receivable account per document** (91 D3). `readTrialBalance({
splitReceivables })` fills `receivableSplit` on every `accounts_receivable`-subtyped account by
the same attribution. The balance sheet keeps documents in debit under the account and shows
documents in credit — a paid, unshipped order — as a computed "<code> <name> - customer deposits"
row under Liabilities, with a `meta.note` and no drill (a computed row has no posting). The
trial-balance statement does the same; its Balance column leaves out the documents in credit and
the note says so. Nothing is posted: the ledger holds one A/R that goes negative, and the
presentation happens at read time.

⚠️ **`GENERAL_LEDGER_MAX_LINES = 25_000`** with a truncation contract: an `INCOMPLETE` first row, a
banner, a verdict override and an `-INCOMPLETE` filename. CSV and PDF read the **full** range
server-side — an export containing only the sections someone happened to open would be silently
wrong in the worst possible way.

`statement-math.ts` owns `retainedEarnings()`; `fiscal-year.ts` owns `fiscalYearStart()`;
`rows.ts` and `adapters.ts` turn a read into `StatementRow`s; `pdf/render-statement-pdf.ts`
renders, and is the one place `accounting/` imports `documents/`.

### 13.3 The summarised view

`ledger/reads/ledger-summary.ts` is TARGET §6: one read over the detail ledger, grouping posted
postings by avenue, grain bucket, store, rail and currency, summing lines by account, with
drill-down through the posting ids. **It is what the export batch builder sums its own payload
from.** In Transaction mode it is a view an org can open whenever it wants; in Summary mode each
row is also a batch carrying its sent state. Same component in both.

The Outbox does not use it. `export/summary-ctes.ts` is the same grouping in SQL over the stored
`avenue` column, read by `export/unbuilt-summary.ts` (`readUnbuiltSummaryPage`,
`countUnbuiltSummaryRows`, `readUnbuiltSummaryMembers`) and brief 95's `export/summary-rows.ts`.
The grain per avenue becomes a `CASE` over the org's `summaryGrain` settings; "would make a
journal" is a `HAVING` over the account-and-side lines. `readLedgerSummary` stays in memory
because the builder needs every group's summed lines.

**The grain is `day | month | payout`** (`SUMMARY_GRAINS`, 91 D9). Under `payout` a posting with a
`GlPosting.payoutId` buckets by it and one without falls into its day, so nothing waits on a
settlement that may not come. A payout bucket files on its earliest posting's day
(`summaryDayKey`) and is complete for the sweep once its latest posting is more than two days old,
the day grain's own rule. `payoutId` is null everywhere until brief 94 stamps it.

🛑 **Summary lines are keyed on `(glAccountId, direction)` and never netted** (91 D9). A/R appears
twice on a day — shipments in, receipts out — so Σdebit equals the row's `totalMinor` by
construction; netted lines could not balance a group mixing entry types. Both implementations,
`ledger-summary.ts` in memory and `summary-ctes.ts` in SQL, follow the rule and change together.

### 13.4 Reading a record's postings

`ledger/reads/list-postings.ts`. 🛑 **`listPostingsForSource` is how a record finds its postings —
through `GlPostingSource`, never a stamp field and never `GlPostingLine.sourceType`.** One query,
one component, every link role; the row's `linkRole` says *how* it matched, so a card can group
instead of pretending the four are the same thing. It is two queries rather than a join with
`DISTINCT`, so the header columns come back once per posting instead of once per link.

`findLiveSubjectPosting` is the read every "reverse this record's entry" path makes first: a
reversal deletes the original's subject row, so anything still `subject` and not `reversed` is what
is standing in the books right now. `findLiveSubjectPostings` is its batch.

`findLinkedPostings` is the `parent` / `member` read and takes `statuses` **required**: those link
rows survive the reversal, so "posted" and "any" are different answers — a caller that wants what
stands in the books asks for `['posted']`. `readPostingHeaders` is the
batched header read (the `FOR UPDATE` header reads stay in `ledger/post/`),
`readControlAccountLine` the A/R or A/P leg an entry actually landed in, and
`countPostingsForLineSource` the retry counter a key's `attempt` is minted from.

🛑 **Nothing in these reads is re-derived.** `totalMinor` is the header's own recorded total and
never `SUM(lines)`; `accountName` is the snapshot on the line and **there is never a join to the
chart in `read-posting.ts`**; `built` comes back verbatim as `unknown` and parsing is the caller's
decision. A posting id from another org is a `NotFoundError`, not a `ForbiddenError` — "this id
exists but is not yours" is itself a disclosure.

---

## 14. Surfaces: Routers, Routes, Workers, Settings

### 14.1 tRPC routers — `apps/web/src/server/api/routers/`

`ledger.ts` (the big one: periods, chart, roles, the account map, `exportBatches.*`, the mirror
procedures) · `ledger-reports.ts` · `ledger-opening.ts` · `money.ts` (which also holds the sales
verbs) · `credit-memo.ts` · `payment-gateways.ts` · `payout-evidence.ts` · `banking.ts` ·
`banking-review.ts` · `banking-rules.ts` · `banking-import.ts` · `sync-history.ts` ·
`document-edit.ts` (§5.10's four, for all four families)

⚠️ There is **no** `inventory.ts`, `sales.ts` or `invoice.ts` router: sales verbs live in
`money.ts` and inventory verbs are split between `purchasing.ts` and `builds.ts`. That is an
altitude mismatch with the lib tree, not a rule.

🛑 **The router asserts; lib never does.** No permission check lives in `packages/lib`.
`exportBatches.rollback` is gated on `ledgerControl`; the rest of the export verbs on `ledgerPost`.

### 14.2 Web routes — `apps/web/src/app/(protected)/app/accounting/`

```
/accounting                        the ledger (month rides on ?month=, not a path segment)
/accounting/reports/[report]       trial balance, balance sheet, P&L, GL, aging, 1099
/accounting/banking                review queue
        /deposits  /payouts  /settlements  /rules  /import/[jobId]
/accounting/settings               general · accounts · bank-accounts · payment-gateways
                                   posting · opening · provider · recurring
```

The export queue and the sync panel live inside those pages rather than on routes of their own.

⚠️ `DockableDrawer` docked with **no portal target renders its children inline**. A reports-page
drawer needs `DockedPanelsOutletProvider` in the layout; `settings` and `banking` already have it.

### 14.3 Workers — `apps/worker/src/workers/worker-definitions/`

`export-batch-worker.ts` · `provider-sync-worker.ts`

⚠️ The export worker is deliberately **not** concurrency 1, unlike the bulk posting workers: their
cap is a correctness cap because they race for a period key, and batches do not — each targets one
provider object, reads it back before recording anything, and carries a lease. Its cap of 3 is
about a rate-limited far side. The plural `export-batches` worker in the same file runs at
concurrency 1, globally (plain BullMQ has no per-org groups), since one job already carries a set.

### 14.4 Settings

| Key | What it decides |
| --- | --- |
| `accounting.bookTimeZone` | 🔑 Every period boundary. Frozen after the first posting |
| `accounting.cutoffPeriod` | The first month auxx keeps. Frozen after the first posting |
| `accounting.fiscalYearStartMonth` | 🔑 Where every read splits prior years from this year (§13.1). Defaults to January; **not** frozen |
| `ledger.lockedThroughMonth` | The period lock |
| `accounting.exportMode`, `.exportModeCutover` | Transaction or summary, and from when |
| `accounting.autoSend.<avenue>` | Gate 2 — hold or send. There is no gate 1 (§5.5) |
| `accounting.summaryGrain.<avenue>` | The summary bucket, `day`, `month` or `payout` |
| `accounting.guestContactId` | The contact a receipt or refund names when the customer is unknown (§8.3) |
| `accounting.opening*`, `qboOpening*` | The opening trial balance. Frozen by prefix after the first posting |
| `accounting.setupState`, `setupFinalizedAt/ByUserId` | Wizard completion |
| `accounting.providerSyncedThrough` | 🛑 The inbound marker — advance it only over a chunk that succeeded |
| `providerSync.state`, `providerSync.schedule` | The walk's own progress. 🛑 Prefixed so it does not take the accounting lock |
| `quickbooks.postJournalEntries` | 🛑 Whether money leaves for a third-party ledger |
| `banking.importMappings` | Bank CSV column mapping per header signature |

`LEDGER_WIDE_SETTING_KEYS` — `cutoffPeriod`, `bookTimeZone`, `lockedThroughMonth` — are the three
that govern **every** posting type.

`FeatureKey.accounting` gates every posting trigger with a `not_enabled` short-circuit
(`ledger/setup/accounting-enabled.ts`). Accounting is opt-in, and `not_enabled` is deliberately
distinct from `setup_incomplete`: the first means the module was never turned on, the second means
it is on and the wizard was not finished.

🛑 **An org setting can render stale indefinitely.** The settings UI reads a per-user
`userSettings` blob dehydrated at page load, and the invalidation graph only reaches the user half
when the event is emitted with `broadcastUserKeys: true`. `updateOrganizationSetting` emits
nothing, so each caller must remember — and several do not. A write that does not broadcast leaves
a checkbox showing the catalog default forever.

**Reading settings:** use `readOrganizationSettings(orgId, keys, db?)` from `settings/read.ts`, and
pass `db` only for a write-after-read consistency guarantee (see `lib-module-guide.md` §8). The
period-lock read in `post-entry.ts` and the audit `previousState` read in `set-locked-through.ts`
are the two places in this subsystem that legitimately do.

---

## 15. Gotchas and Invariants

### The ones that cost money

1. 🛑 **No default account, ever.** An entry posted to an arbitrary account still balances, so
   nothing downstream can detect it.

2. 🛑 **Two writers on one asserted account are undetectable.** See §6.5. `findWriterConflicts`
   returning non-empty means the ledger is running two regimes at once.

3. 🛑 **Never sum what a provider transcribed.** `depositedMinor` comes from the header. Summing
   items silently corrects the provider's arithmetic and breaks the tie to the bank line.

4. 🛑 **A watermark is not an idempotency key.** The payout sync is a poll; the gateway/payout
   **pair** is what stops a second posting relieving clearing twice.

5. 🛑 **A hashed period key, never a counted one.** A counted sequence converges two concurrent
   rows onto one key, and the claim answers `already_posted` — a **success** — having posted
   nothing (§7.1).

6. 🛑 **A partial unique index and the queries that mirror its predicate must change together.**
   Widening `GlRoleAssignment_org_role_default_key` without widening the eight
   `sourceAccountId IS NULL` reads that assumed the old predicate made three `ON CONFLICT` paths
   throw `42P10` and left five reads silently choosing between an org default and a rail row.

7. 🛑 **A provider entry id is unique PER BOOK, never per connection.**
   `ProviderLedgerEntry_txn_key` is `(organizationId, bookId, providerTxnType, providerTxnId)`.
   One `ExternalAccountingBook` has many `ExternalBookConnection` rows over time — every reconnect
   mints a new `epoch` — so a connection id is too narrow to say whose ledger an entry came from.
   `providerTxnType` is in the key for the same reason §12.1's authorship predicate is keyed on the
   pair: a `Purchase` and a `JournalEntry` may share an id.

8. 🛑 **A deleted contact can strand an already-posted entry forever.** The line's `counterpartyId`
   is frozen and still names the gone contact — a retry exports under the attribution the ledger
   asserted. But the provider-id lookup reads through the record's field values, and
   `deleteEntityInstance` sweeps them, so the fallback layers have no name and no email left. The
   entry becomes **permanently unexportable, with a message blaming a sync that cannot run.** The
   fix is to resolve through `RecordIdentity`, an id **map** keyed on `entityInstanceId` — the
   record of a correspondence that happened, which does not stop having happened when we delete our
   copy. ⚠️ Check what the delete engine does to `RecordIdentity` first
   ([`record-delete-architecture-guide.md`](./record-delete-architecture-guide.md) is the
   authority).

### The ones that cost a rebuild

9. **`GlPostingLine` has no update path.** Correct by reversal (`G4`).

10. **Two copies of the posting-type vocabulary, never three.** `ledger/types.ts` (client-safe) and
    the `GlPostingType` pgEnum. The registry enum that used to be the third is gone.

11. **`gl_posting` is not an `EntityRefKind`.** Reconsidered and deliberately left out — *"it is
    Drizzle tables now, not an entity kind."*

12. **The `built` column versus every `*Draft*` symbol.** `POSTING_DRAFT_VERSION` is 1 and
    `parsePostingDraft` rejects anything else; there has never been a v2. A new optional field on
    `BuiltEntry` reaches the audit record with no version bump, which is why `v` stays 1.

### The ones that waste a day

13. **A builder existing does not mean the type posts, and `enabled: false` does not mean it
    never does.** The flag says whether a close of ours emits the type; `provider_sync` is written
    by the inbound sync with the flag off (§5.1).

14. **`policy.ts` is declared, not derived.** If the code disagrees with the declaration, the
    declaration is the bug report.

15. **Builders throw; readers return `Result`.** `postEntry` never throws at all; `postEntryInTx`
    throws so its caller rolls back.

16. **Do not cache `resolveRoles`.** There is no invalidation event for a `gl_account` rename or
    archive, and a stale role map fails **open**.

17. **Register the provider adapters and the payout sources in any standalone script**, or the
    answers are false negatives.

18. **`pnpm exec vitest run <dir>` does not run integration tests.** They are excluded from
    `vitest.config.ts` and run on `vitest.integration.config.ts` via `pnpm test:integration`.

19. **The integration test database is shared and destructive.** `global-setup.ts` does
    `pg_terminate_backend` against every connection to `auxx_test`, then `DROP DATABASE`. Two
    agents running it concurrently kill each other — expect `57P01`, `Connection terminated
    unexpectedly`, or FK errors against tables you never touched. Retry serially before concluding
    anything is broken.

### Comments in the code that are out of date

The mechanism changed underneath some long file headers, and the tree moved under most of them.
These are known:

- **Roughly thirty comments still name the retired `postings/` path** — `providers/provider.ts`'s
  `postings/provider-sync/`, `accounting-providers.ts`, `payouts/rails.ts`, `banking/writes.ts`,
  four in `ledger/post/policy.ts`, and more. Read them as the module the path's leaf now lives in.
- `ledger/post/post-entry.ts` and `periods/period-key.ts` describe the claim as `ON CONFLICT
  (organizationId, postingType, periodKey, revision)` on `GlPosting`. It is
  `GlPostingSource_claim_key` (§4.3).
- `ledger/roles/regime.ts` names a `receipt` posting type and a `buildReceiptEntry` — neither
  exists — and calls `vendor_bill` "deliberately not enabled", which it no longer is (§5.1).
- `month_end_inventory` appears in prose in `post-entry.ts` and `policy.ts` and is not in
  `POSTING_TYPES`. ⚠️ It is also the sole `kind` of the live `PostingAssertions` type that
  `draft.ts` parses — that one is code, not a comment.
- `providers/book-connections.ts` says `externalCompanyId` is "what `GlPosting.providerTenantId`
  stores". That column is gone; the company scopes the mirror's key instead (§15 item 7).
- `types.ts`'s `provider_sync` comment names `EXPORT_ROUTE_BY_POSTING_TYPE`, now a derived view of
  the policy, and its `refund` and `credit_memo` comments still describe pre-91 entries
  (`Dr returns / Cr clearing`, a memo money leg). The builders' headers are right.
- `builders/basis-dimension.ts` explains itself in terms of `AccountingEffect`, which is gone.

### The tensions nobody has adjudicated

20. **Fail closed vs fall back.** `resolveRoles` fails closed on an unmapped role (§6.2); a
    source-scope miss falls back to the default (§9); a clearing-account miss is supposed to block.
    Each is right for its case; the boundary is not written down.

21. **Table-backed vs entity-backed financial records.** `GlPosting` is a table for a reason that
    is airtight (§4.1). `MoneyTransfer` and `ProcessorBalanceEntry` are `EntityInstance`-backed.
    Which one a *new* financial fact should be is genuinely open — see CLAUDE.md's "New Storage:
    Ask, Don't Assume" and
    [`plans/accounting/decisions.md`](../plans/accounting/decisions.md) before adding one.

---

## 16. The Scenarios a Change Here Must Survive

Concrete, testable, and the right thing to walk through before changing §5, §8, §11 or §12.

1. A **$200 charge applied $150 / $50 across two invoices**: one money movement, two applications,
   a correct held balance, and no duplicate bank receipt.
2. An **unapplied deposit** and a **refund** both remain visible and correctly classified — the
   deposit shown as a liability, per document, at read time, inside each receivable account
   (§13.2), while the ledger holds it as a credit in A/R; a refund whose memo has not arrived as a
   receivable on aging.
3. The **same charge arriving twice** — through collection and through connector evidence: one
   canonical transaction, one claim, one entry.
4. A **payout arriving before its charges**, or with incomplete evidence: inspectable, but not
   falsely reconciled, and never a synthetic invoice allocation or revenue entry.
5. A **vendor payment covering several bills, partially reversed**: correct allocations, a correct
   payable balance, and matching bank evidence.
6. A **control-account adjustment that ties in total but carries no document attribution**: show a
   subledger discrepancy until it is properly resolved, and do not repost it.
7. **Removing a connection** does not disable local accounting; **adding one** does not
   indiscriminately export every historical local entry.
8. A **batch sent, then rolled back, then rebuilt**: the postings come back to *Ready*, the ledger
   never moved, and the membership history survives.
9. The **accountant's December adjusting entry arriving in February**, into a month our lock has
   closed: reported, never reopened, and still there on the next re-read.

🔑 Two properties worth stating separately, because they are the ones most often assumed:

- **Reversed source arrival order must converge.** Repeated commands, duplicate webhooks and
  out-of-order facts all have to land on the same records and balances.
- **Source-to-auxx and auxx-to-provider are two different reconciliation boundaries.** A clean
  first proves nothing about the second.
