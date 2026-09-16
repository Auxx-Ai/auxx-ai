# Accounting Architecture Guide

**Last Updated:** 2026-09-16
**Scope:** The general ledger and everything that writes to it — the posting pipeline, account
roles, the accounting-effect acceptance boundary, the money model, source evidence, the
accounting-provider seam in both directions, periods and the close, and the statements.

> **This guide is the mechanism. It is not the status.**
> What is merged, what is open and what the counts are lives in
> [`plans/accounting/STATE.md`](../plans/accounting/STATE.md). What was decided and what was
> reversed lives in [`plans/accounting/decisions.md`](../plans/accounting/decisions.md) and
> [`plans/money/decisions.md`](../plans/money/decisions.md) (the `G*`/`P*` register).
> Design briefs live in `plans/accounting/tasks/` and describe the world as it was when written.
>
> **Companion — inventory and costing.** How a movement is valued, what GRNI holds, the
> three-way match and the month-end inventory assertion live in
> **[`inventory-costing-architecture-guide.md`](./inventory-costing-architecture-guide.md)**;
> its §9 is the durable description of the GL seam this guide sits behind.
>
> **Companion — records.** `gl_account`, `journal_entry`, `bank_account`, `payment_gateway`,
> `invoice`, `order` and `fulfillment` are `EntityInstance`s. How records and fields work is
> **[`entity-architecture-guide.md`](./entity-architecture-guide.md)**.
>
> **Companion — connectors.** How Shopify facts arrive at all is
> **[`data-connectors-architecture-guide.md`](./data-connectors-architecture-guide.md)**.

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Vocabulary](#2-vocabulary)
3. [The Ledger: Data Model](#3-the-ledger-data-model)
4. [The Posting Pipeline](#4-the-posting-pipeline)
5. [Roles and the Chart of Accounts](#5-roles-and-the-chart-of-accounts)
6. [The Effect Layer: Atomic Acceptance](#6-the-effect-layer-atomic-acceptance)
7. [The Money Model](#7-the-money-model)
8. [Source Evidence](#8-source-evidence)
9. [The Accounting-Provider Seam: Outbound](#9-the-accounting-provider-seam-outbound)
10. [The Accounting-Provider Seam: Inbound](#10-the-accounting-provider-seam-inbound)
11. [Periods, the Lock and the Close](#11-periods-the-lock-and-the-close)
12. [Statements and Reports](#12-statements-and-reports)
13. [Surfaces: Routers, Routes, Workers, Settings](#13-surfaces-routers-routes-workers-settings)
14. [Gotchas and Invariants](#14-gotchas-and-invariants)
15. [What a Change Here Must Prove](#15-what-a-change-here-must-prove)

---

## 1. Executive Overview

**auxx.ai keeps its own double-entry general ledger.** An external accounting system is an
optional register on a seam, not the system of record. An organization with nothing connected
runs the entire path below unchanged — entries are built, balanced, claimed, persisted and
reported — and the only difference is that the last step has nowhere to push. That is a
supported configuration, not a degraded one (`postings/post-entry.ts:1-12`, decision `P1`).

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
          │
          ▼
  ┌───────────────────────────────────────────────────────┐
  │ AccountingWork  →  AccountingWorkBasis (versioned)     │  the obligation + its input
  │        ↓ accept, inside ONE transaction                │
  │ AccountingEffect (frozen, sha256-hashed)               │  what was agreed to book
  └───────────────────────────────────────────────────────┘
          │  builder: roles + integer minor units (PURE)
          ▼
  ┌───────────────────────────────────────────────────────┐
  │ resolveRoles → GlRoleAssignment → gl_account           │  this org's own accounts
  │ insertPosting: ON CONFLICT (org, type, period, revision)│ the double-post defence
  │ GlPosting + GlPostingLine                              │  the books
  └───────────────────────────────────────────────────────┘
          │                                    ▲
          ▼ delivery (queued, leased, proved)  │ provider-sync (re-read, converge)
  ┌───────────────────────────────────────────────────────┐
  │ AccountingProvider  ←→  the connected accounting system│
  └───────────────────────────────────────────────────────┘
```

Five properties hold the whole thing up:

1. **Builders are the accounting; the poster is the plumbing.** A builder is a pure function
   returning roles and amounts. It never touches the database, never names an account number
   and never knows a provider exists.
2. **A double post is unrepresentable, not merely detected.** The claim is a Postgres unique
   index on `(organizationId, postingType, periodKey, revision)`.
3. **Correct by reversal, never by edit.** `GlPostingLine` has no `updatedAt` and the module
   exposes no update.
4. **Acceptance and the journal commit together.** The frozen effect and the `GlPosting` land
   in one transaction; everything external happens after that commit and is recoverable.
5. **Provider-agnostic above the seam.** Nothing in `postings/` imports a specific accounting
   system except `delivery.ts`, which is where the seam currently leaks (§9.5).

---

## 2. Vocabulary

| Term | Means |
| --- | --- |
| **Posting** | One journal entry. A `GlPosting` row plus its `GlPostingLine`s |
| **Posting type** | What produced it — `fulfillment`, `payment`, `manual_journal`, … (§4.1) |
| **Role** | A provider-neutral account key a builder emits, e.g. `'grni'`. Never a number |
| **Period key** | The summarization window: a day (`'2026-08-18'`) or a month (`'2026-08'`) |
| **Claim** | The `(org, type, periodKey, revision)` tuple that makes a double post impossible |
| **Work** | `AccountingWork` — a durable obligation to book something, owned by a record or a movement |
| **Basis** | The versioned input to that obligation. Immutable once accepted, sha256-hashed |
| **Effect** | `AccountingEffect` — an accepted basis bound to exactly one `GlPosting` |
| **Delivery** | Pushing a posting to the connected system, with a lease, a frozen payload and a readback |
| **Coverage** | Which components of an effect a given destination has received |
| **Ledger mode** | auxx holds the primary GL; the provider is an exporter |
| **Subledger mode** | The provider holds the primary GL; auxx keeps a full shadow ledger |

---

## 3. The Ledger: Data Model

All schema under `packages/database/src/db/schema/`.

### 3.1 `GlPosting` — one journal entry

| Column group | What it carries |
| --- | --- |
| Identity | `id`, `organizationId`, `postingType`, `periodKey`, `revision`, `docNumber` |
| Dates | `txnDate` (a Postgres `date`, already in the org's book timezone) |
| State | `status` (`posted` \| `reversed`), `reversesId` |
| Delivery | `deliveryIntent` (`not_required` \| `manual` \| `automatic`), `intendedBookConnectionId`, `exportStatus` (`not_required` \| `pending` \| `exported` \| `failed`), `providerId`, `providerEntryId`, `providerTenantId`, `attempts`, `failureReason`, `releasedAt` |
| Provenance | `reasons` (why these accounts), `basis` |

🛑 **Why this is a table and not an `EntityInstance`.** `FieldValue` carries exactly two unique
indexes — the primary key and `(entityId, fieldId, sortKey)` — so composite uniqueness across
two *fields* of an instance is not merely unimplemented, it is **unexpressible**: a unique index
constrains within a row, and two fields are two rows. The entire double-post defence is
`INSERT … ON CONFLICT (organizationId, postingType, periodKey, revision) DO NOTHING RETURNING *`,
and nothing on the entity route can express it (`gl-posting.ts:1-17`, decision `G6`).

The retired `gl_posting` / `gl_posting_line` **entity definitions** were deleted in entity
migration 114. Do not recreate them. `gl_posting` was reconsidered for `EntityRefKind` and
deliberately left out.

### 3.2 `GlPostingLine` — one leg

Append-only. **There is no `updatedAt` column and no update function.** On the entity route
`updatable: false` is advisory — read by the grid cell and the connector catalog and by nothing
on the write path — so a later `fieldValue.set` could rewrite one line's amount on a posted entry
and silently unbalance the books. Here immutability is **structural** (`gl-posting-line.ts:1-11`).

Each line carries: `glAccountId` (the account's stable id — brief 15), `accountCode` (a label
that may change), `accountRole` where one drove it, `direction` (`debit` \| `credit` — the **only**
carrier of sign, decision `G2`), `amountMinor` as a positive `bigint`, `counterpartyType` /
`counterpartyId`, `memo`, `dimensions` (jsonb, e.g. `{ jurisdiction }`), and `sourceId`.

🔑 **The line id is the row identity.** `GlPostingLine.id` is a cuid primary key. Composing a key
out of `(glAccountId, glPostingId, txnDate, docNumber)` collides, because none of those four vary
between lines of one posting on one account — a fulfillment batch credits sales tax once **per
jurisdiction**, all to the same account (brief 56 unit 1).

### 3.3 `GlRoleAssignment` — this org's role map

`uniqueIndex(organizationId, role)` gives `G19` its directional uniqueness: each role resolves to
exactly one account (required, enforced); each account may serve many roles (permitted, common).
Neither a `SINGLE_SELECT` nor a `MULTI_SELECT` field on `gl_account` can express that
(`gl-role-assignment.ts:1-18`).

Since brief 47 the map is **scoped by source**: two partial unique indexes,
`GlRoleAssignment_org_role_default_key` and `GlRoleAssignment_org_role_source_key`, admit one
default plus N per-`FinancialSourceAccount` overrides, so two stores keep their revenue apart.
Manual is a sentinel row, not a null.

### 3.4 The effect tables

| Table | Holds |
| --- | --- |
| `AccountingWork` | The obligation. Owned by an `EntityInstance` **or** a `MoneyTransaction`, never both, enforced by CHECK |
| `AccountingWorkBasis` | Versioned inputs to that obligation. A replay must match the selected basis |
| `AccountingEffect` | An accepted basis bound to one `glPostingId`, with `acceptedBasis` (jsonb) and `basisHash` (sha256) |

`AccountingEffect` rows are **immutable and hashed**. Anything that changes the shape of an
accepted basis requires rehashing frozen records — which is why reserving a field costs nothing
and retrofitting one costs everything.

---

## 4. The Posting Pipeline

### 4.1 Posting types

Declared in `postings/types.ts` (`POSTING_TYPES`) and mirrored by the `GlPostingType` Postgres
enum. **Two copies on purpose** — `types.ts` is client-safe and `@auxx/database` is not — and
there must never be a third.

| Live today | Declared, not emitted |
| --- | --- |
| `fulfillment`, `payment`, `payout`, `credit_memo`, `invoice_issued`, `deposit_application`, `write_off`, `expense_bill`, `bank_transaction`, `bank_deposit`, `manual_journal`, `recurring_journal`, `opening_balance`, `month_end_inventory` | `receipt`, `vendor_bill`, `build`, `month_end_deferral`, `month_end_reversal` |

`provider_sync` is a third case: it is **inbound**, written by the sync on the accountant's
schedule and never by a close, so it is deliberately excluded from `ENABLED_POSTING_TYPES` and
also excluded from the completeness report's subtraction via `NEVER_CLOSE_EMITTED`
(`reports/completeness.ts:76-87`). A banner saying "provider sync posting is off" would be
permanent and unfixable.

🛑 **The existence of a builder does not mean a type is live.** `buildReceiptEntry` and
`buildVendorBillEntry` are written, documented and tested, and have **no posting caller**.
`regime.ts`'s `ENABLED_POSTING_TYPES` is what tells you (`regime.ts:57`).

### 4.2 `policy.ts` — one declared record per type

`POSTING_POLICIES` declares, per posting type: the trigger, the entry as a role template, which
settings change it, the ON-state sentence and the OFF-state sentence, the constants a person
should know, and the record pages it reads its by-id accounts from.

Four tables that used to answer four questions separately — `ENABLED_POSTING_TYPES`,
`EXPORT_ROUTE_BY_POSTING_TYPE`, `SINGLE_WRITER_ROLES_BY_POSTING_TYPE` and the disabled-state
sentences — are now **derived views** of it. Edit the policy, not the derived table.

🔑 **Declared, never derived.** Nothing in `policy.ts` is computed from a builder, a worker
schedule or a settings catalog. If the code and the declaration disagree, the declaration is the
bug report — a table derived from the builders would simply move with them and tell nobody.

`ENABLED_POSTING_TYPES` is derived in **declaration order** and `__tests__/policy.test.ts` pins
that list byte for byte. Add a new enabled type at the end of the enabled block and extend the pin.

### 4.3 Builders — pure, and they throw

`postings/build-*.ts`. Every builder is a total function of its arguments: no database, no
provider, no clock, no I/O. It returns a `BuiltEntry` of roles and positive integer minor units.

**Failures here are programmer error**, so builders throw `AuxxError` subclasses rather than
returning a `Result`. A builder that cannot balance its own arithmetic is a bug, not a runtime
condition (`build-entry.ts:1-12`, and `docs/lib-module-guide.md`). The house split is
`build-month-end-inventory.ts` (pure, throws) beside `gather-month-end-inventory.ts` (reads,
returns a `Result`).

### 4.4 The poster — `post-entry.ts`

Resolve → balance → claim → persist → delegate → record.

**This function never throws.** Every refusal — a closed period, an unmapped role, an imbalance,
a provider fault — resolves to a typed `PostResult`, so a tRPC mutation or a BullMQ job can
persist the outcome without a try/catch of its own.

The claim (`insert-posting.ts:153-200`) is the primary defence and it depends on nothing: two
concurrent runs of the same period contend on one index tuple, the loser gets no row back, reads
the winner's row and returns `already_posted`. It does not depend on a provider, on a network, or
on our own code getting the ordering right.

Layers above it — a deterministic document number queried before insert, a deterministic
`requestId` on the push, a forensic note in the provider's register — belong to the **adapter**,
because they are that provider's idempotency contract. **Layer 1 protects our row; layers 2–4
protect theirs.**

### 4.5 `withAccountingCommitLock`

Re-exported from `@auxx/database` via `postings/accounting-commit-lock.ts`. An org-scoped
advisory lock taken inside the transaction by every writer that touches work, effects or
postings. It is what makes "accept and post together" safe across concurrent manual and
automatic runs.

⚠️ Writing a setting row directly, or purging cache keys by hand, **skips this lock.** Harmless
when nothing is posting; not the same path as a click.

### 4.6 Batch posting

`money/batch-posting/` is the shared frame; `money/fulfillment-posting/` and
`money/credit-memo-posting/` are its two sources. Batching lives **in the ledger, not at the
export seam** (brief 25): the grouping decision is an accounting decision about what one journal
entry means, and pushing it to the exporter would make an org's books depend on whether anything
is connected.

Grouping is per flow, per source (`accounting.fulfillmentGrouping`, `accounting.creditMemoGrouping`).
Voiding one member out of a batch produces a **compensating entry**, not a whole-entry reversal.

---

## 5. Roles and the Chart of Accounts

### 5.1 Why roles exist

The chart is an **editable seeded default** (`G7`) — US GAAP mandates no numbering, and charts
vary by country, industry and taste. Once the chart is editable the number cannot carry the
meaning: a customer renumbering GRNI from `2160` to `2155` would silently break posting, and the
entry would still balance. So builders emit roles (`G8`).

There are **25 roles** (`build-entry.ts:114`). `CASH` was deliberately removed: *a bank account is
not a role*. A payout settling into one bank and the bank feed's own line for the same money could
land in two different accounts and still balance, with nothing comparing them
(`build-payout-entry.ts:41-49`). Cash-touching builders now name a `bank_account`'s own
`gl_account` id, resolved through `postings/resolve-cash-account.ts` and the
`bank_account_gl_account` pointer.

### 5.2 `resolveRoles` — a batch, and it fails closed

```
ACCOUNT_ROLES  →  GlRoleAssignment  →  gl_account  →  ResolvedPostingLine
 builder emits    THIS org's map       code, name,     what a line stores
 'grni'                                type, active
```

**It is a batch.** A month-end entry touching six unmapped roles fails **once**, naming all six.
A bookkeeper fixing a close needs the list, not a treasure hunt.

**It fails closed on five distinct conditions with five distinct messages.** "You never mapped
this", "you marked this unused and the books disagree" and "the account you mapped it to was
archived" call for three different actions by three different people.

🛑 **There is no default account and no "take the first".** That is the one behaviour that would
put money in an arbitrary account: the entry would still balance, nothing downstream could detect
it, and it would surface at a close as a number nobody can reconstruct.

⚠️ **Not cached, deliberately.** The obvious `OrgCacheDataMap` key was considered and rejected:
`gl_account` is an `EntityInstance` and there is no per-record event for a rename or an archive,
so a cached key would be correct for an hour and then fail **open** — the entry still balances.
`role-map.ts` reads the same rows through the same door and inherits the rule. Do not add a cache
key to either until `gl_account` create/update/archive have events of their own.

### 5.3 The write side validates against the same facts

`setRoleAssignment` refuses, **before writing**, a role outside `ACCOUNT_ROLES` and an account
whose `accountType` is incompatible — the same `ROLE_ACCOUNT_TYPES` table the resolver checks.
Pointing `grni` at a revenue account produces an entry that balances, so nothing downstream can
detect it; catching it at assignment time is the difference between a validation message and a
restatement.

`listRoleMap` returns one row for **every** role, mapped or not. It is a checklist, not a table
dump: a screen rendering only existing rows could never show what is missing, which is the single
question the setup wizard exists to answer.

### 5.4 Chart provisioning

`default-chart.ts` declares a small core plus opt-in packs (`card_rail`, `prepayments`,
`inventory`, `purchasing`, `payroll`, `fixed_assets`, `debt`). `chart-import.ts` creates one
`gl_account` per active provider account, stamping the provider account identity at import.
`next-account-code.ts` and `mint-rail-accounts.ts` handle new accounts.

### 5.5 Single-writer roles

`regime.ts` exists for one assertion: `1310` / `1320` / `1330` may be driven by a **monthly
balance assertion** or by **per-event postings**, never both. The two are not additive and the
conflict is undetectable downstream — the month-end entry moves each inventory account *to* the
value the subledger computes, silently reversing every perpetual posting made during the month
and dumping the residual into the COGS plug, where it reads exactly like consumption. Both entries
balance. Both claim cleanly. Nothing in the engine can tell the difference.

The gap this leaves over bank-account **ids** (which the guard cannot see, since it only reads
`accountRole` lines) is closed by `duplicate-movements.ts`, which reads what was actually posted.

---

## 6. The Effect Layer: Atomic Acceptance

This is the newest and least obvious layer. It exists because "post the journal, then record that
we posted it" has a crash window in the middle, and a ledger that loses that record either
double-posts on retry or silently drops the event.

### 6.1 The three tables, in order

1. **`AccountingWork`** — captured when the obligation arises. Owned by an `EntityInstance`
   (a fulfillment, an invoice, a credit memo) **or** by a `MoneyTransaction` (a receipt, a
   refund, a deposit application), never both. A CHECK enforces the exclusivity, and two partial
   unique indexes enforce **one original per owner** for the families that are 1:1.

   `REPEATABLE_ACCOUNTING_EFFECT_KINDS = ['invoice_write_off', 'deposit_application']` is the
   exception list, and it is a statement about the **business**: an invoice really can be written
   off twice, and a receipt really can be applied to two invoices.

   🛑 **A repeat is not a correction.** A correction says the first entry was a mistake. A July
   write-off after a March one is new bad debt on its own date, and recording it as a correction
   would misstate the month the loss happened.

2. **`AccountingWorkBasis`** — the versioned input. Changed evidence **appends** a new basis; an
   old initial payload replayed after an append is a `ConflictError`, never a second original.

3. **`AccountingEffect`** — the accepted basis, frozen, sha256-hashed in `basisHash`, bound to
   exactly one `glPostingId`. `acceptedBasis` carries a balanced, account-resolved
   `contribution[]` per member transaction — which is why the per-transaction register is a
   **read**, not something that needs building.

### 6.2 `acceptEntryInTx` — the boundary

`postings/accept-entry.ts` takes prepared members, re-derives and revalidates each **inside** the
locked transaction, and commits the accepted effects and the `GlPosting` together. Everything
external — the provider push, the queue enqueue — happens strictly after that commit and is
recoverable from persisted state.

The revalidation-inside-the-transaction requirement is exactly why several effect families are
still reserved rather than wired: `payout_settlement`'s gross/fees/net split currently arrives
from a provider gather in `money/payouts/sync.ts` rather than being re-derivable in the
transaction.

### 6.3 Corrections

A correction is new work plus new effects plus a compensating journal, linked to the originals;
the original claims stay consumed. `assertCorrectionNegatesOriginal` is family-agnostic, so every
effect kind gained the invariant at once.

⚠️ **The direction invariant lives in acceptance, not in the schema**, because the schema cannot
see `work.operation`. A reviewer skimming a diff sees "a schema check was relaxed"; it is the
opposite — the check moved and a stronger one was added beside it.

⚠️ **Partial unapply is refused** by design: it would need the accepted effect split in two, which
is not an exact reversal, and the negation check would correctly refuse it. Splitting needs its own
design. Do not loosen the negation check to allow it.

---

## 7. The Money Model

### 7.1 The one write door

`money/commands/run-money-command.ts` is the single write door for `MoneyTransaction`,
`MoneyApplication` and everything hanging off them. It runs one command exactly once, inside the
accounting commit lock.

Idempotency is `MoneyCommand.commandKey`: a retry with the same key **and the same payload**
returns the first run's `resultIds` without executing again; the same key with a **different**
payload is a `409`, because two different requests wearing one key is a caller bug, not a retry.

### 7.2 The tables

| Table | Holds |
| --- | --- |
| `MoneyCommand` | The idempotency record: key, kind, payload hash, `resultIds` |
| `MoneyTransaction` | A confirmed movement. `purpose` ∈ `customer_receipt` \| `customer_refund` \| `vendor_payment` \| `vendor_refund` |
| `MoneyApplication` | Append-only `apply` / `unapply` against an order, an invoice or a vendor bill |
| `MoneyTransfer` | A payout or transfer. **Never** a fifth money purpose |
| `PaymentRoute` | The resolved processor merchant/rail, or a manual route |
| `MoneySourceLink` | Many immutable source observations → one movement |

**Dates model two precisions.** `datePrecision` is `'instant'` (with `occurredAt`) or `'date'`
(with `occurredOn`). A card charge is an instant; a hand-recorded payment is a date. Timezone
conversion applies only to instants.

**Requests are not movements.** Only a confirmed actual movement becomes a `MoneyTransaction`.

### 7.3 Policies under one family

An effect family may carry more than one **policy**. `customer_receipt` has both
`shopify_receipt_v1` (applications to one order, a `FinancialSourceAcceptance` from a live source
account) and `invoice_receipt_v1` (a hand-recorded invoice payment, which has none of those).
A second policy under the same family is cheaper and truer than an eighth effect kind.

🛑 **The frozen order basis schema is byte-identical on purpose.** The union discriminates
*structurally*, both members are `strictObject`s, and hundreds of `AccountingEffect` rows re-parse
these schemas. Do not add a discriminator field to the order schema.

### 7.4 Payment routing

`money/bank-deposits/route.ts` routes a payment by **method** to `undeposited_funds`, a bank
account, or `clearing`, per the `accounting.paymentRoute.*` settings. Cash and cheque go to the
**role**, not to a bank account, because five cheques banked together arrive as one bank line —
which is why recording a payment does not demand a bank account for those methods and refuses one.

⚠️ **`clearing` does not carry over to a hand-recorded payment.** A clearing account exists to be
drained by a payout entry; a card on a terminal auxx does not know about produces no payout.

### 7.5 The legacy lane

`PaymentTransaction` / `PaymentAllocation` and the hidden `payment` entity mirror are the
Dispatch-era money model, still standing in `money/payments/`. They are being retired
(`plans/accounting/tasks/54-one-money-model.md`). Do not build new work against them, and do not
mirror between the lanes.

The mirror's design mismatch, for the record: a $200 charge split $150/$50 across two invoices
creates **two** `payment` entities; a held deposit with no allocation creates **none**; refunds
create none. That conflates invoice-application identity with bank-receipt identity.

### 7.6 Payouts

`money/payouts/` raises a `payout` record per settled payout a source reports, posts its entry and
stamps the posting back. Provider-neutral behind `PayoutSource` (`money/payouts/source.ts`).

Three properties the module exists to keep:

- **A payout is posted at most once.** The **pair** (`payout_payment_gateway`, `payout_gateway_id`)
  is the idempotency key, checked before anything is written — because the sync is a *poll* and
  sees every payout again on every run. A watermark alone is not enough: it can be re-run, reset,
  or overlap a boundary, and a second posting would relieve clearing twice with both entries
  balancing.
- **A payout still in transit gets a record but no entry.**
- **`depositedMinor` is transcribed** from the header, never summed from the items. Summing would
  silently correct the provider's arithmetic, and the cash leg must equal what the bank line shows.

Recognition is keyed on `ref.kind` — `stripe_charge`, `order`, `none` — never on a charge id. A
source with no items posts recognition equal to gross and marks the record `imported`, so the
screen can say *"no itemisation"* rather than *"everything recognised"*.

**Rails are `netted` or `billed`** (`feeTreatment`). A netted rail is relieved by a payout record
from a `PayoutSource`; a billed rail deposits gross and is relieved by a coded bank line plus a
monthly fee entry — never a payout record.

---

## 8. Source Evidence

Five tables under `financial-source-*.ts` separate *what a provider said* from *what we booked*:

| Table | Holds |
| --- | --- |
| `FinancialSourceAccount` | One connected account/store: `providerKey`, `externalAccountId`, `environment`, a human `name`, an `axis` |
| `FinancialSourceObservation` | An immutable record of what a provider reported |
| `FinancialSourceAcceptance` | That an observation was accepted as evidence for a movement |
| `FinancialSourceCoverage` | How far acquisition has progressed |
| `FinancialSourceObject` | The provider object an observation is about |

🔑 **`FinancialSourceAccount.id` is the source scope key** (brief 47) — not the connector id, not
the credential id. Neither of those is 1:1 with a store, and neither survives a rebuild or a
reconnect. It is also what scopes the role map (§3.3), so two stores can keep revenue apart.

⚠️ **A scope miss falls back to the default; it does not fail.** Connecting a store must never stop
the books. This is in deliberate tension with §5.2's fail-closed rule and with the clearing-account
rule, and the boundary between them is not currently written down anywhere.

`MoneyTransfer` and `ProcessorBalanceEntry` extend an existing canonical `EntityInstance`
identity, with ordinary source `FieldValue`s carrying provider facts and shared domain events
doing reconciliation (`money/reconciliation/`). Whether that is the right physical shape is
[still open](../plans/accounting/decisions.md).

---

## 9. The Accounting-Provider Seam: Outbound

### 9.1 The interface

`postings/provider.ts` declares `AccountingProvider` and a manager that resolves the one an
organization has connected — shaped after the house provider/manager pattern
(`ai/providers/provider-registry.ts`, `files/storage/storage-manager.ts`): an interface with an
`id`, a registry of lazy factories, and a cache so a provider is constructed once.

An organization with nothing connected gets `NONE_ACCOUNTING_PROVIDER`. Its postings are built and
persisted identically; the only difference is that nothing is pushed.

⚠️ **The adapter registers from the app layer.** A standalone script that never boots the app gets
the null provider and is told *"No accounting system is connected"* on a fully connected org. Call
`registerAccountingProvider` + `setConnectedProviderResolver` in any probe script, or the answer is
meaningless.

### 9.2 Book connections

`postings/book-connections.ts` resolves the **pinned** connection and the delivery intent for a
posting. `ExternalAccountingBook` is unique on (org, provider, company); `ExternalBookConnection`
allows one active connection per org.

A CHECK on `GlPosting` binds the two delivery columns together: `deliveryIntent` is null or
`not_required` **with** a null `intendedBookConnectionId`, or `manual`/`automatic` **with** a
non-null one (`gl-posting.ts:309`). A posting cannot half-declare a destination.

The opening policy (`accountingOpeningPolicySchema`) is an explicit, immutable cutover choice —
a local period cutoff is **not** evidence of what the external books already contain.

### 9.3 `delivery.ts` — lease, freeze, prove

The delivery path is off the request path on purpose: a delivery is three to five sequential
round trips, and doing it inline held a 28-group run open for minutes.

- **Lease** (`LEASE_MS = 5 min`, `RETRY_MS = 60 s`) so one row is worked by one runner.
- **Frozen payload.** `delivery-proof.ts` prepares the journal, hashes it, and the same bytes are
  what get sent on a retry.
- **Readback.** `verifyDeliveredJournal` compares what came back.
- **Coverage partitioning.** `assertCoveragePartitionsInTx` proves that the components of an
  effect being delivered do not overlap ones already delivered.
  `WHOLE_EFFECT_COMPONENT_KEY = 'whole_effect'` is the identity of a component that *is* the whole
  effect and names no individual lines.
- **Crash sweep.** `sweepAccountingDeliveries` is the explicit backstop for rows nothing woke up
  for.

🛑 **A plan refusal does not stamp `exportStatus: 'failed'`.** `planAccountingDeliveryInTx` throws
`UnprocessableEntityError`, matching every other plan failure, so a refused row stays in *Ready to
sync* wearing an accurate badge and the reason lives on the row. Do not "fix" this by stamping
failed — nothing was attempted.

⚠️ **Release is sticky.** A `releasedAt` stamp survives a refusal; the sweep keeps retrying and
delivers the moment the blocker clears, with no second press. Correct per the code; undecided as a
policy.

### 9.4 The export route

`EXPORT_ROUTE_BY_POSTING_TYPE` is `'journal' | 'none'`, derived from each policy. `'none'` is a
real, declared answer, not an omission — `opening_balance` is `'none'` because pushing the opening
entry back at a provider that the opening entry was *derived from* doubles every balance, and
`provider_sync` is `'none'` because pushing a synced entry hands the accountant their own entry a
second time. Both copies would balance.

### 9.5 🔌 Where the seam leaks

`postings/delivery.ts` imports `money/quickbooks/*` directly (`resolveQuickbooksContext`,
`prepareQuickbooksJournal`, `toNeutralPartyType`). Everything else above the seam is
provider-agnostic; this file is the one place that names a vendor, and it is the known cost of the
current delivery implementation. `objectType` vocabulary is neutral (`journal`, `customer`,
`invoice`, `payment`, `credit_memo`) and the adapter maps to the provider's own names.

---

## 10. The Accounting-Provider Seam: Inbound

`postings/provider-sync/` reads entries the accountant authored in the connected system and writes
them as `provider_sync` postings. Three rules run the file (`provider-sync/sync.ts:1-27`):

1. 🛑 **The cutover floor is asserted before the first call.** `planSyncChunks` **refuses** rather
   than clamps, so no code path can reach a date below it.
2. **One month per call.** Report endpoints do not paginate — `startposition` and `maxresults` are
   accepted and ignored — so the date range is the only lever, and a chunk that silently truncated
   is indistinguishable from a quiet month. **Chunk size is a safety property, not a tuning knob.**
3. **Converge by re-reading, never by tracking changes.** A re-read writes what is new (the claim
   index makes a repeat a no-op) and **reverses** anything held as `provider_sync` in that range
   whose id has stopped appearing. A reversal, never a delete.

And one thing it deliberately does **not** do: **it reopens nothing.** An entry dated in a month
our own lock has closed is normal — it is the accountant's December adjusting entry arriving in
February, which is the case that motivated the feature — so it is *reported* and a person with
`ledgerControl` decides. Reopening from here would put the decision somewhere with no audit trail
and no human.

The loop guard is a flag, not an architecture: a synced entry carries the provider's id on the row
that already has a column for it, and the exporter skips it.

**Cadence is "at close, plus on demand". Not continuous.** Daily polling of a report endpoint
spends rate limit answering a question nobody asks on a Tuesday. ⚠️ That is an argument against a
*schedule*, not against a *worker* — the two are separable.

`accounting.providerSyncedThrough` is the marker, written **per chunk** so a provider fault on a
later month keeps every month already brought across. Note that "where the walk is" and "how far is
vouched for" are two different values, and only the second is the marker: once a chunk comes back
unclean the run sets `blocked` while later months are still read and written.

---

## 11. Periods, the Lock and the Close

### 11.1 Period keys

`postings/periods.ts` is **pure**: `isPeriodLocked` and `assertPeriodOpen` take the lock as an
argument so the module stays exhaustively testable with no database.

🛑 **Period boundaries are instants derived from wall-clock midnights in
`accounting.bookTimeZone`, never UTC.** A `periodKey` / `txnDate` is derived **once**, at the
wall-clock boundary, and stored as a calendar date with no instant component left in it. That is
why report reads compare `txnDate <= to` as a plain date comparison and do **no** timezone
conversion of their own — re-deriving a boundary from a `Date` one level up is the classic bug here.

### 11.2 The lock

`ledger.lockedThroughMonth` is one value covering both modes, because the question is the same in
both: *is this month still accepting entries*. What differs is who **writes** it — a human in
ledger mode — and that difference belongs to the writer, not to every reader
(`period-lock.ts:12-30`).

The lock is **soft**: it marks a month closed and refuses a post against it; reopening is a normal,
permissioned, audited act.

`close-month.ts`, `close-blockers.ts`, `close-periods.ts` and `settled-periods.ts` are the close
console's reads and writes. `latest-by-type.ts` and `month-activity.ts` answer "what has this month
already got".

---

## 12. Statements and Reports

`postings/reports/`. All of them are presentations of one sweep over `GlPostingLine`.

| Report | File | Shape |
| --- | --- | --- |
| Trial balance (primitive) | `trial-balance.ts` | `GROUP BY glAccountId` over `[from, to]`. 🛑 Cumulative, no fiscal year — five readers compose it |
| Trial balance (statement) | `trial-balance-statement.ts` | As of ONE date. Composes three of the above; §12.1's boundary; computed retained earnings |
| Balance sheet | `balance-sheet.ts` | As of one date; splits equity at `fiscalYearStart(asOf)` |
| Profit & loss | `profit-and-loss.ts` | A true range report |
| General ledger | `general-ledger.ts` | Per-account lines; takes an optional `glAccountId` filter |
| A/R + A/P aging | `aging.ts` | As of one date |
| 1099 | `vendor-1099.ts`, `vendor-1099-rows.ts` | Per vendor |
| Dimension breakdown | `dimension-breakdown.ts` | Group by a `dimensions` key |

### 12.1 🔑 The fiscal-year boundary is a read rule, not a posted entry

auxx posts **no closing entries**. At the fiscal-year boundary, revenue and expense
accounts do not get zeroed by a journal entry; instead **every read** shows a P&L
account from `fiscalYearStart(asOf)` and derives a Retained Earnings row for
everything before it. Equity never moves — the amount simply shifts from the
"this year" bucket to the "prior years" one.

🛑 **This is a property of every read path, including the general ledger**, not a
statement convention. A P&L account's beginning balance in the ledger is
fiscal-year-to-date, not life-to-date. A new report that forgets this will disagree
with the row it was opened from.

✅ **The door to posted entries is open and costs nothing to keep.**
`retainedEarnings()` accepts a `postedRetainedEarningsBalance` and reports
`priorYearsSource: 'posted' | 'rolled_forward'`, so a posted closing entry — or a
provider's imported RE balance — flows through the same function.

⚠️ A computed Retained Earnings row needs its `meta.note` treatment ("computed from
the P&L, not a posted balance"), or it reads as an account somebody posted to.

🛑 **`readTrialBalance` is the shared primitive and does NOT know about the fiscal year.**
`readBalanceSheet` makes three raw calls to it, `readTrialBalanceStatement` the same three,
`readProfitAndLoss` one and `aging.ts` one. Teaching the boundary to the primitive would make
the balance sheet apply it twice. A new report that wants the boundary composes, it does not
reach down.

⚠️ **The trial balance's computed row is `priorYearsMinor`, not `balanceMinor`.** Resetting P&L
accounts breaks `Σdebit = Σcredit` by exactly prior-year net income, so that is the whole plug.
`balanceMinor` would also add `postedPriorYearsMinor` (already on the report as the org's own
retained-earnings account row) and `currentPeriodMinor` (already on it as the current-year P&L
rows). The balance sheet makes the identical argument about its own equity section.

`statement-math.ts` owns `retainedEarnings()`; `fiscal-year.ts` owns `fiscalYearStart()`.
`rows.ts` and `adapters.ts` turn a read into `StatementRow`s; `pdf/` renders.

🛑 **`fiscalYearStart(date, startMonth)` takes the month; it does not read it.** The org's value
lives in `accounting.fiscalYearStartMonth` and is resolved **once per report** —
`resolveFiscalYearStartMonth()` server-side, `useLedgerPeriod().fiscalYearStartMonth` in the
browser — then passed down. A read path that calls `fiscalYearStart(date)` with no month silently
assumes January and will disagree with the row it was opened from.

The setting defaults to January (what every report assumed before it existed, so nothing moved when
it landed) and is **not** frozen after the first posting, unlike `cutoffPeriod` and `bookTimeZone`:
those change a posted entry's `txnDate`/`periodKey`, this one writes nothing to the ledger at all.
Both readers normalize through `normalizeFiscalYearStartMonth()`, which falls back to January rather
than throwing — one hand-edited row must not take down every statement in the org.

⚠️ **`GENERAL_LEDGER_MAX_LINES = 25_000`** with a truncation contract: an `INCOMPLETE` first row, a
banner, a verdict override and an `-INCOMPLETE` filename. CSV and PDF read the **full** range
server-side — an export containing only the sections someone happened to open would be silently
wrong in the worst possible way.

---

## 13. Surfaces: Routers, Routes, Workers, Settings

### 13.1 tRPC routers — `apps/web/src/server/api/routers/`

`ledger.ts` · `ledger-reports.ts` · `ledger-opening.ts` · `money.ts` · `credit-memo.ts` ·
`banking.ts` · `banking-review.ts` · `banking-rules.ts` · `banking-import.ts` · `payout-evidence.ts`

🛑 **The router asserts; lib never does.** No permission check lives in `packages/lib`.

### 13.2 Web routes — `apps/web/src/app/(protected)/app/accounting/`

```
/accounting                        the ledger (month rides on ?month=, not a path segment)
/accounting/reports/[report]       trial balance, balance sheet, P&L, GL, aging, 1099
/accounting/banking                review queue
        /deposits  /payouts  /settlements  /rules  /import/[jobId]
/accounting/settings               general · accounts · bank-accounts · payment-gateways
                                   posting · opening · provider · recurring
```

⚠️ `DockableDrawer` docked with **no portal target renders its children inline**. A reports-page
drawer needs `DockedPanelsOutletProvider` in the layout; `settings` and `banking` already have it.

### 13.3 Workers — `apps/worker/src/workers/worker-definitions/`

`accounting-delivery-worker.ts` · `fulfillment-posting-worker.ts` · `credit-memo-posting-worker.ts`

### 13.4 Settings

| Key | What it decides |
| --- | --- |
| `accounting.bookTimeZone` | 🔑 Every period boundary |
| `accounting.fiscalYearStartMonth` | 🔑 Where every read splits prior years from this year (§12.1). Defaults to January; not frozen |
| `accounting.cutoffPeriod` | The first month auxx keeps |
| `accounting.setupState`, `setupFinalizedAt/ByUserId` | Wizard completion |
| `accounting.fulfillmentPosting`, `creditMemoPosting` | Manual or automatic |
| `accounting.fulfillmentGrouping`, `creditMemoGrouping` | The batch grain |
| `accounting.paymentRoute.{cash,check,card,bank,other}` | Where a payment's debit lands |
| `accounting.cashBankAccountId` | The `cash` route's bank account |
| `accounting.opening*`, `qboOpening*` | The opening trial balance |
| `accounting.providerSyncedThrough` | The inbound marker |
| `ledger.lockedThroughMonth` | The period lock |
| `quickbooks.postJournalEntries` | 🛑 Whether money leaves for a third-party ledger |
| `banking.importMappings` | Bank CSV column mapping |

`FeatureKey.accounting` gates every posting trigger with a `not_enabled` short-circuit
(`postings/accounting-enabled.ts`). Accounting is opt-in.

🛑 **An org setting can render stale indefinitely.** The settings UI reads a per-user
`userSettings` blob dehydrated at page load, and the invalidation graph only reaches the user half
when the event is emitted with `broadcastUserKeys: true`. `updateOrganizationSetting` emits
nothing, so each caller must remember — and several do not. A write that does not broadcast leaves
a checkbox showing the catalog default forever.

---

## 14. Gotchas and Invariants

### The ones that cost money

1. ✅ **A provider entry id is unique PER COMPANY, and both write paths must stamp it.**
   The index is `(organizationId, providerId, providerTenantId, providerEntryId)` — a
   provider entry id is a per-company sequence, so `147` exists in every company and
   means something different in each. 🛑 **`providerTenantId` is the company, not the
   connection**: one `ExternalAccountingBook` has many `ExternalBookConnection` rows
   over time (a reconnect mints a new `epoch`), so a connection id would be too narrow.
   ⚠️ **NULLs are distinct in a unique index**, so a row carrying an entry id and no
   company sits outside the guarantee entirely — which is exactly what the inbound sync
   did until 2026-09-16, leaving 126 of 152 in-scope rows unguarded. Export stamps it
   from the pinned connection; `provider-sync/writes.ts` stamps it from the active book.
   Anything new that writes a `providerEntryId` must stamp it too.

2. 🛑 **No default account, ever.** An entry posted to an arbitrary account still balances, so
   nothing downstream can detect it.

3. 🛑 **Two writers on one asserted account are undetectable.** See §5.5. `findWriterConflicts`
   returning non-empty means the ledger is running two regimes at once.

4. 🛑 **Never sum what a provider transcribed.** `depositedMinor` comes from the header. Summing
   items silently corrects the provider's arithmetic and breaks the tie to the bank line.

5. 🛑 **A watermark is not an idempotency key.** The payout sync is a poll; the gateway/payout
   **pair** is what stops a second posting relieving clearing twice.

5b. 🛑 **A deleted contact can strand an already-posted entry forever.** The line's
   `counterpartyId` is frozen and still names the gone contact — a retry exports under the
   attribution the ledger asserted, not the current record. But the provider-id lookup reads
   through `UnifiedCrudHandler.getFieldValues(recordId)`, and `deleteEntityInstance` calls
   `sweepEntityFieldValues`, so the cell is gone and the fallback layers have no name and no
   email left to search or create with. The entry becomes **permanently unexportable, with a
   message blaming a sync that cannot run.**

   The fix is to resolve through `RecordIdentity` — an id **map**, keyed on
   `entityInstanceId`, which is the record of a correspondence that happened, and the
   correspondence does not stop having happened when we delete our copy. ⚠️ Check what the
   delete engine currently does to `RecordIdentity` first;
   [`record-delete-architecture-guide.md`](./record-delete-architecture-guide.md) is the
   authority. If both are gone, refuse with a sentence saying the contact no longer exists,
   not one saying it "has not been synced yet".

### The ones that cost a rebuild

6. **`GlPostingLine` has no update path.** Correct by reversal (`G4`).

7. **`AccountingEffect.acceptedBasis` is frozen and hashed.** Changing an accepted basis shape
   means rehashing frozen records. Reserve fields early; retrofit never.

8. **Do not add `kind` to the frozen order basis schema.** The union discriminates structurally
   and hundreds of rows re-parse it.

9. **Two copies of the posting-type vocabulary, never three.** `types.ts` (client-safe) and the
   `GlPostingType` pgEnum. The old registry enum was deleted; do not bring it back.

10. **`gl_posting` is not an `EntityRefKind`.** Reconsidered and deliberately left out — *"it is
    Drizzle tables now, not an entity kind."*

### The ones that waste a day

11. **A builder existing does not mean the type posts.** Check `ENABLED_POSTING_TYPES`.

12. **`policy.ts` is declared, not derived.** If the code disagrees with the declaration, the
    declaration is the bug report.

13. **Builders throw; readers return `Result`.** `build-*.ts` throws `AuxxError`;
    `gather-*.ts` / `reads.ts` return `Result`. `post-entry.ts` never throws at all.

14. **Do not cache `resolveRoles`.** There is no invalidation event for a `gl_account` rename or
    archive, and a stale role map fails **open**.

15. **Register the provider adapter in any standalone script**, or `resolveAccountingProvider`
    returns the null provider and every answer is a false negative.

16. **`pnpm exec vitest run <dir>` does not run integration tests.** They are excluded from
    `vitest.config.ts` and run on `vitest.integration.config.ts` via `pnpm test:integration`.

17. **The integration test database is shared and destructive.** `global-setup.ts` does
    `pg_terminate_backend` against every connection to `auxx_test`, then `DROP DATABASE`. Two
    agents running it concurrently kill each other — expect `57P01`, `Connection terminated
    unexpectedly`, or FK errors against tables you never touched. Retry serially before concluding
    anything is broken.

### The tensions nobody has adjudicated

18. **Fail closed vs fall back.** `resolveRoles` fails closed on an unmapped role (§5.2); a
    source-scope miss falls back to the default (§8); a clearing-account miss is supposed to
    block. Each is right for its case; the boundary is not written down.

19. **Table-backed vs entity-backed financial records.** `GlPosting` is a table for a reason that
    is airtight (§3.1). `MoneyTransfer` and `ProcessorBalanceEntry` are `EntityInstance`-backed.
    Which one a *new* financial fact should be is genuinely open — see
    [`plans/accounting/decisions.md`](../plans/accounting/decisions.md) §4.1 before adding one.

---

## 15. The Scenarios a Change Here Must Survive

Rescued from the architecture blueprint this guide replaces. Concrete, testable, and the
right thing to walk through before changing §4, §6, §7 or §9.

1. A **$200 charge applied $150 / $50 across two invoices**: one money movement, two
   applications, a correct held balance, and no duplicate bank receipt.
2. An **unapplied deposit** and a **refund** both remain visible without a mirror record.
3. The **same charge arriving twice** — through collection and through connector evidence:
   one canonical transaction, one original accounting effect.
4. A **payout arriving before its charges**, or with incomplete evidence: inspectable, but
   not falsely reconciled, and never a synthetic invoice allocation or revenue entry.
5. A **vendor payment covering several bills, partially reversed**: correct allocations, a
   correct payable balance, and matching bank evidence.
6. A **control-account adjustment that ties in total but carries no document attribution**:
   show a subledger discrepancy until it is properly resolved, and do not repost it.
7. **Removing a connection** does not disable local accounting; **adding one** does not
   indiscriminately export every historical local entry.

🔑 Two properties worth stating separately, because they are the ones most often assumed:

- **Reversed source arrival order must converge.** Repeated commands, duplicate webhooks and
  out-of-order facts all have to land on the same records and balances.
- **Source-to-auxx and auxx-to-provider are two different reconciliation boundaries.** A
  clean first proves nothing about the second.
