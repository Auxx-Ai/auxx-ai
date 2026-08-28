<!-- docs/inventory-costing-architecture-guide.md -->

# Inventory, Purchasing & Costing Architecture Guide

**Last Updated:** 2026-08-28
**Scope:** The money spine that points *inward and through* — buy, receive, bill, match, build,
value, and post. `purchase_order` → `stock_movement` → `vendor_bill` → three-way match →
`build` → `gl_posting`. What each entity owns, where a cost comes from and when it freezes,
who may write the movement ledger, and the silent-failure modes this subsystem has already
paid for.

> This is the durable half. The design history and the open work live in `plans/money/`, which
> is **not tracked in git** — `plans/money/README.md` is the status entry point, `decisions.md`
> the decision register, `design/` the long-form arguments, `archive/` the finished ones.
> **Where a plan and the code disagree, the code is the truth**, and §12 lists the places they
> currently do.
> Companions: `entity-architecture-guide.md` (definitions, fields, `FieldValue`, the lookup
> core), `entity-events-architecture-guide.md` §8 (the sync-change manifest), `skip-events-history.md`
> (the write lanes), `lib-module-guide.md` (module shape), `ui-design-guide.md` (the cards and
> the line builder).

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Core Concepts & Vocabulary](#2-core-concepts--vocabulary)
3. [The Data Model — thirteen entities, zero new tables](#3-the-data-model--thirteen-entities-zero-new-tables)
4. [The Buy Side — purchase order to vendor bill](#4-the-buy-side--purchase-order-to-vendor-bill)
5. [The Three-Way Match](#5-the-three-way-match)
6. [The Movement Ledger](#6-the-movement-ledger)
7. [Costing — where a number comes from and when it freezes](#7-costing--where-a-number-comes-from-and-when-it-freezes)
8. [The Make Side — the build event](#8-the-make-side--the-build-event)
9. [The GL Seam — what exists, what is designed](#9-the-gl-seam--what-exists-what-is-designed)
10. [Write Lanes & the Silent Ledger Write](#10-write-lanes--the-silent-ledger-write)
11. [Gotchas & Invariants](#11-gotchas--invariants)
12. [Where the Plans and the Code Disagree](#12-where-the-plans-and-the-code-disagree)
13. [Key Files](#13-key-files)

---

## 1. Executive Overview

Everything auxx.ai did with money originally pointed **outward**: quote → order → invoice →
payment. This subsystem is the inward half plus the transformation in the middle.

```
  BUY                        RECEIVE                 BILL                    MATCH
 ──────────────────   ──────────────────────  ─────────────────────  ────────────────────
  purchase_order        stock_movement          vendor_bill            matchBill()
   + _line               type: 'receive'         + _line                three legs:
   what we agreed        what arrived, when,     what we are            PO price  ── expected
   to buy, at what       at what cost            being charged          receipt   ── received
   price                  ↑ append-only           (transcribed,          bill      ── billed
        │                  updatable: false        never computed)           ↓
        │                       │                       │            matched | exception
        └───────────────────────┴───────────────────────┘                     ↓
                                │                                      (phase 7) gl_posting
  MAKE                          │
 ──────────────────             │
  build                         │
   completeBuild() writes  ──────┘
   consume(−) + produce(+)
   in ONE transaction
   at a cost that sticks
```

Four properties carry the whole design:

1. **auxx.ai is the system of record; the accounting provider is an exporter.** Every fact
   lives in auxx entities. The provider push is one adapter behind one interface, and the
   provider's own ids live in `RecordIdentity`, never in a column. (Decision P1.)
2. **The movement ledger is append-only.** Every field on `stock_movement` is
   `updatable: false`. A mistake is corrected by *reversing* it, never by editing it. This is
   what makes the ledger trustworthy and what rules out FIFO layers (§7.3).
3. **Cost is frozen onto the movement at write time**, and nothing ever restates it. A vendor
   price change in March must not move January's COGS.
4. **Quantity on hand is a full re-SUM of the ledger, per part, on every write.** Nothing else
   may write it — not a connector, not a sink, not a form.

---

## 2. Core Concepts & Vocabulary

| Term | Means |
| --- | --- |
| **Movement** | One `stock_movement` row. The only thing that changes stock. Append-only. |
| **QoH** | `part_quantity_on_hand`. Derived — a full `SUM(quantity)` over the part's movements, recomputed by `recalculatePartQoH`. Never authored. |
| **Standard cost** | `part_standard_cost`, frozen by `rollStandardCost`. The value every movement stamps. Distinct from `part_cost`. |
| **`part_cost`** | The **live** rolled-up material cost, rewritten on every vendor-price change and propagated to ancestors. Correct for *pricing* (what to charge next), fatal for *valuation*. Read it as **replacement cost**. |
| **Landed cost** | `unitPrice + shippingCost + unitPrice × tariffRate/100 + otherCost`. What a receipt actually cost, including freight and duty. |
| **PPV** | Purchase price variance — account `5090`. The delta between what a receipt cost and the frozen standard. |
| **GRNI** | Goods Received Not Invoiced, account `2160`. The clearing account between "we have the goods" and "we have the invoice". |
| **Three-way match** | PO price × receipt quantity × bill amount, compared with tolerances. Produces `matched` or `exception`. |
| **`partKind`** | `component` \| `subassembly` \| `finished_good`. Decides the inventory account (`1310` / `1330`) and whether a part is *buildable*. Stored and auditable — deliberately not derived. |
| **L1 / L3** | The GL posting regime. **L1** = one periodic entry per month asserting inventory balances. **L3** = perpetual per-event postings. Exactly one may drive `1310/1320/1330`. |
| **Buildable** | `subassembly` or `finished_good`. Only these absorb conversion (labour + overhead) cost. |

---

## 3. The Data Model — thirteen entities, zero new tables

**Every entity in this subsystem is an `EntityInstance` on a seeded system definition.** There
are no new Drizzle tables. Fields are `CustomField` rows; values are `FieldValue` rows. That is
a deliberate decision (P2, P3, P4, P5) and it has consequences — see §12 for the one place it
was argued against and lost.

Seeded in `packages/lib/src/seed/entity-seeder/constants.ts`:

| Entity | Visible | Owns |
| --- | --- | --- |
| `purchase_order` | ✅ | What we agreed to buy, at what price. The **price arm** of the match. |
| `purchase_order_line` | ❌ | Part, quantity, `expected_unit_price`, the received/billed roll-ups. |
| `vendor_bill` | ✅ | What we are being charged. Totals are **transcribed**, never computed. |
| `vendor_bill_line` | ❌ | `quantityBilled`, `unitPriceBilled`, the `purchaseOrderLine` match key. |
| `stock_movement` | — | The ledger. Append-only, `updatable: false` throughout. |
| `build` | ✅ | A production run: consume components, produce a finished good. |
| `part` | ✅ | The stock master. Carries `partKind`, QoH, and the five frozen standard-cost fields. |
| `vendor_part` | ❌ | The `(part, supplier)` price row. Prefill and provenance only. |
| `gl_account` | ❌ | Our chart of accounts. The provider's id hangs off it via `RecordIdentity`. |
| `gl_posting` | ❌ | One journal entry. Written only by the poster. |
| `gl_posting_line` | ❌ | Double-entry lines, keyed on an account **code** (`'2160'`), never a provider id. |
| `vendor_payment` | ❌ | 🛑 **INERT.** Seeded, zero writers, zero rows. See §11. |
| `vendor_payment_allocation` | ❌ | 🛑 **INERT.** The header/allocation split that lets one bank line clear several bills. |

### 3.1 Why the line entities are their own type

`line_item` is a **sell** line: `unitPrice` is a sell price and eight of its fields are
permanently dead on a purchase. Reusing it would have put two incompatible meanings on one
field. The *UI* is shared — `LineBuilder` renders all four document types — but the entity is
not (P4, P5).

### 3.2 What is deliberately absent

- **No `goods_receipt` header.** The PO header already carries the totals and the freight
  allocation basis, which was the header's one unique justification.
- **No `line_item.unitCost`.** A sold line stores no cost. Point-in-time cost lives on the
  movement at `(fulfillment, line)` grain; a single CURRENCY column cannot hold the two frozen
  costs of one line shipping across two periods (D16).
- **No lot costing.** A lot is a traceability axis — recall, warranty, supplier quality — and
  a nullable label on a movement. It holds no quantity and no cost bucket (P11, §7.3).
- **No aging, remittance or 1099.** Payment itself is in scope; the A/P *reporting* layer is not.

---

## 4. The Buy Side — purchase order to vendor bill

### 4.1 The status axes

A purchase order does **not** have one status enum. One enum conflated three independent
questions and could not answer any of them. It is split into:

| Axis | Written by | Values |
| --- | --- | --- |
| **Action** | guarded transitions | `draft` → `issued` → … |
| **Receipt** | derived from the line roll-ups | nothing / partial / complete |
| **Billing** | derived from the line roll-ups | nothing / partial / complete |

Only the action axis is authored. The other two are read from
`purchase_order_line_quantity_received` / `_quantity_billed`, which are maintained roll-ups.

The confirmed-send flip writes **`issued`**, not `sent` — one event, one value. It lives in
`flipDocumentStatusOnSend` on the `message:sent` event (a worker job), **not** in the router,
so it fires on all four send doors.

### 4.2 Receiving — two doors, one of which is the real one

| Door | Surface | Sets `purchaseOrderLineId`? |
| --- | --- | --- |
| **PO-first** (primary) | `ReceivePurchaseOrderDialog`, off the Receiving card | ✅ yes |
| Part-first | `ReceiveStockPopover` on the part's inventory tab | ❌ no |
| Adjust stock | `stock-adjustment-popover.tsx` → `adjustStock` | ❌ no |

🛑 **Part-first receiving against a purchase order is not merely tedious, it is wrong.** With no
`purchaseOrderLineId` the movement never rolls up, `quantityReceived` stays at zero, and the
three-way match has no receipt leg — so all that clicking produces a correct QoH and a broken
match. The friction and the defect had the same cause.

**The server prices a receipt, not the browser.** `receiveStock` → `resolveReceiptPrice` owns
the arithmetic. A form that sends only a base price gets a cost derived from the *supplier row's*
`unitPrice` — which may be the price the user just replaced. See §11.

**Over-receipt is never clamped.** A vendor shipping 12 against an order for 10 is exactly what
the match exists to surface; capping it hides the discrepancy at the one moment somebody is
holding the packing slip.

**A line receiving zero is excluded from freight allocation.** Freight is spread across what was
actually on the truck; including a line that did not arrive dilutes every other line's share.

### 4.3 The bill

**Bill totals are transcribed, not computed.** Recomputing a bill's totals from its lines
silently corrects the vendor's arithmetic — which is precisely the discrepancy the match exists
to surface. This is the rule; the one deliberate exception is the *prefill* of the header total
in `CreateBillFromPurchaseOrderDialog`, which is safe only because the header total is **not a
match input** (the match weighs the lines).

Raising a bill's lines from the order prefills the **structure** and never the **match inputs**:
`purchaseOrderLine` (the join), `part`, `description` and the `2160` GRNI code are filled;
`quantityBilled`, `unitPrice` and `lineTotal` are left for the person holding the invoice.

⚠️ `quantityBilled` cannot literally be left blank — it is `nullable: false, defaultValue: 1`,
so a created line reads `1` until typed. That is safe *because* `quantityExact: true`: billing 1
against 10 received raises `quantity_under_billed` rather than passing quietly. A forgotten
quantity is loud.

---

## 5. The Three-Way Match

`packages/lib/src/purchasing/match.ts`. A pure function over three inputs, with tolerances.

```
                 purchase_order_line.expected_unit_price   ← what we agreed (price arm)
matchBill(bill) ─ purchase_order_line.quantity_received    ← what arrived   (quantity arm)
                 vendor_bill_line.quantity/unit_price      ← what we are charged
                          ↓
        { outcome: 'matched' } | { outcome: 'exception', reasons[], variance }
```

**The tolerance** (`DEFAULT_MATCH_TOLERANCE`): `pricePercent`, `priceAbsolute` (a flat floor in
minor units), and `quantityExact: true`. The allowance is `max(percent, absolute)`. The actual
default values are a **guess** — nobody has looked at a real vendor invoice yet.

**Reasons** are discriminated on `code` and each carries the numbers it compared, so the queue
renders billed / received / expected side by side without a string parse:
`receipt_overdue`, `quantity_under_billed`, `price_variance`. (`quantity_over_billed` was
**deleted** by P24 — see §5.2. Every `billed > received` line is now either `awaiting_receipt`
or, once late, `receipt_overdue`, so nothing could emit it.)

### 5.1 Two rules the match must not lose

**Variance is `billed − (quantityReceived × unitPriceExpected)`.** Using *billed* quantity on
both sides lets an over-billed quantity net out against an under-billed price to zero — hiding
the exact failure the match exists to catch.

**The match re-runs when the goods arrive.** `matchBill` fires on a bill write and a bill-line
write. Nothing in `receiving/` originally called it, so the verdict depended on the order the
paperwork happened to arrive in: enter the bill before the goods and `billed 1 but only 0
received` stood **forever**. `rematchBillsForPurchaseOrderLines`
(`purchasing/match-reconciler.ts`) closes it, driven from the receipt roll-up for lines whose
received total actually moved — gated on the roll-up's own evidence, never on a `targetAttr`
string.

> 🛑 **The generalisable failure:** every unit test passed, because each one drives the match
> directly and none of them models two documents arriving out of order. A queue holding
> exceptions that are no longer true teaches people to clear it without reading it.

### 5.2 A bill for goods that have not arrived (P24)

Prepayment is normal here — vendors often will not ship until the invoice is paid — so
`billed > received` is the correct state of a *correct* bill for weeks. It is therefore a third
outcome, **`awaiting_receipt`**, and not an exception. `matchVariance` goes **price-only** for
those lines (`billed − quantityBilled × unitPriceExpected`), because relabelling alone would
leave the queue's money column screaming the bill's entire value; a `receipt_overdue` line is
*not* awaiting and keeps the full `quantityReceived` formula.

**What makes that safe is that it ages, and aging needs a clock.** The predicates
(`isAwaitingReceipt`, `isReceiptOverdue`, `DEFAULT_MATCH_TOLERANCE.receiptGraceDays = 7`) are
pure and take `asOf` as a parameter — nothing in `purchasing/match.ts` reads a clock, so the
rule is testable to exhaustion. Every *trigger* for re-running the match, however, is
event-driven: a bill write, a bill-line write, or a receipt landing. So the transition it
computes had nothing to fire it, and a bill whose goods never arrive sat `awaiting_receipt`
forever — the exact vendor-took-the-money-and-never-shipped case the outcome exists to catch.

`purchasing/aging-sweep.ts` (`sweepAgingVendorBills`, the daily `vendorBillAgingJob` on the
maintenance queue) is that clock, and it is **the only time-driven trigger in this subsystem**.
Three properties are load-bearing:

- It **selects**, it does not decide. It calls `rematchBill`, so the verdict and the write stay
  in one place; a second path that set `vendor_bill_status` is exactly the divergence §5.1's
  failure came from. It even asks `isReceiptOverdue` itself rather than re-deriving the grace
  arithmetic.
- It anchors on the `awaiting_receipt` **working set**, not on history — one global query joined
  to `CustomField` and `EntityInstance` (archived bills excluded, or an archived prepaid bill is
  re-matched nightly forever), then four batched reads per *affected* org down the
  bill → line → PO line → order → `expectedAt` ladder. An org with no prepaid bills costs
  nothing.
- The write is **loud**. A bill crossing into `exception` is the one event the mechanism exists
  to surface, so it must publish, fire rules and reach the sync manifest. `quietSession` here
  would rebuild the invisibility being fixed.

⚠️ **An order with no `expectedAt` never ages**, deliberately: nobody agreed a date to be late
against, the field is nullable with nothing prefilling it, so the fallback would be the common
case rather than the edge one. Such a bill is meant to surface through the completeness check
(the GRNI residual), which is not built.

---

### 5.3 An untyped price is absence, not zero — and it blocks `matched`

Found 2026-08-28 by opening the app; every one of the 226 unit tests passed while this was wrong.

`billLineValuesFromPurchaseOrderLine` deliberately leaves `unitPrice` **blank** when a bill is
raised from a purchase order, because it is a value the match COMPARES and prefilling it would make
the match rubber-stamp itself. That is correct and must not change. But `match-hook.ts` read the
blank as `?? 0`, which made it a genuine disagreement with the order's expected price — so **every
freshly raised bill was an `exception` on price from birth** and could never reach
`awaiting_receipt`, which is exactly the population `P24` exists to serve.

Two rules now, and the second is the one that is easy to get wrong:

1. **A line with no billed price is unmatchable**, exactly like a line with no purchase-order link.
   `num()` returns `null` only when there is no numeric value, so a vendor legitimately billing
   **$0.00** (a free replacement) is a value like any other and still matches.
2. 🛑 **An untyped line blocks `matched` and `awaiting_receipt`, demoting the bill to `draft`** — but
   never suppresses an `exception`. The tempting fix, "skip the price arm when the price is absent",
   is worse than the bug: a bill whose goods arrived and whose prices nobody typed then reads
   `matched`, and `matched` is the one status that posts to the GL automatically. Observed live —
   `INV-PO8-001` rendered a green **Matched** badge at variance `$0.00` with *"1 line with no unit
   price entered yet"* sitting beside it. A half-read document has no verdict.

**Untyped is not unlinked.** A freight line on a goods bill is outside the match by design and does
NOT demote the bill; an untyped line is an omission. They are counted separately (`untypedLines` vs
`unlinkedLines`) and reported as separate notes, because one sends a human to fix a link and the
other sends them to the invoice.

---

## 6. The Movement Ledger

`stock_movement` is the append-only spine. **Every field is `updatable: false`**, deliberately.

### 6.1 The writers

| Writer | Produces | Lane |
| --- | --- | --- |
| `receiveStock` / `receivePurchaseOrder` | `receive` (+) | interactive |
| `adjustStock` | `adjust` (±) | interactive |
| `completeBuild` | `build_consume` (−) **and** `build_produce` (+) | quiet, one transaction |
| `reverseMovement` / `reverseBuild` | the negating row | quiet |

**A correction is a reversal, never an edit.** `reverseMovement` exists for exactly this. The
double-reversal guard is a read-then-write with no DB constraint available on a `FieldValue`,
so it is best-effort.

### 6.2 QoH is derived

`recalculatePartQoH` re-SUMs the whole ledger for a part. This is what makes the ledger the
truth and it is **why a connector or sink may never write `part_quantity_on_hand`** — the next
movement would overwrite it. A Shopify `inventory_quantity` therefore has to land in its own
column regardless of any mapping decision; the drift check is a column-vs-column comparison on
one row.

Being a full re-SUM makes QoH **order-independent**, which is exactly why it is compatible with
standard cost and moving average, and *not* with FIFO layer allocation (which must be
incremental and therefore locked). See §7.3.

### 6.3 `occurredAt`

`ORDER BY COALESCE(occurredAt, createdAt)` is the ledger's real ordering. A backdated receipt is
a date correction under standard or average costing — and a full recomputation under FIFO. That
asymmetry is one of the reasons FIFO is not on the table.

---

## 7. Costing — where a number comes from and when it freezes

### 7.1 The three costs, named honestly

| Field | Written by | Answers |
| --- | --- | --- |
| `part_cost` | `recalculateAffectedParts`, on every vendor-price change | *What would this cost to buy next?* — **replacement cost**. Drives markup pricing. |
| `part_standard_cost` | `rollStandardCost` only. `updatable: false`, `computed: true` | *What do we value this at?* — **the value every movement stamps.** |
| `part_average_cost` | — | Only exists if moving-average is ever chosen over standard. |

🛑 **`part_cost` cannot be the accounting standard.** It is rewritten on every vendor-price
change and propagates to every ancestor, so valuing a movement with it means a motor price
change in March silently restates January's COGS.

The standard is split into four components plus an effective date —
`standardMaterialCost`, `standardLaborCost`, `standardOverheadCost`, `standardCost`,
`standardCostEffectiveAt` — because the fulfillment COGS entry must split across
**5000 Materials / 5010 Direct Labor / 5020 Applied Overhead**, and it can only do that if the
finished-good standard remembers its composition.

### 7.2 `rollStandardCost` — four rules learned the hard way

`packages/lib/src/builds/standard-cost.ts`.

1. **Bottom-up, summing children's `standardCost` — not their `part_cost`.** `part_cost` is a
   pure material chain with no labour or overhead at any level, so rolling it drops every
   subassembly's conversion cost on the way up. Because `completeBuild` values consumed rows at
   the child's standard and produced rows at the parent's, that gap reappears as a **permanent
   variance to 5090 on every build**.
2. **Conversion cost only where `partKind` says buildable.** A purchased `component` must not
   receive assembly labour it never got.
3. **A scoped `partIds` must widen to every ancestor**, or a parent reads a stale child standard.
4. **The revaluation delta is two figures, not one.** `(new − old) × QoH` with a **NULL `old`**
   reports the entire on-hand inventory value as variance on the very first roll — the roll
   everybody runs first. `revaluationDelta` (old non-NULL: a real restatement, and the only one
   that belongs in the 5090 entry) is summed separately from `initialValue` (old NULL: opening
   balance material).

**Abort vs skip:** a *built* part whose child has no standard **throws**; a part with no inputs
at all is **skipped and reported** — never written, and above all **never zeroed**, because `0`
is a valid standard that would pass `completeBuild`'s "never post a zero cost" gate.

**A standard-cost change touches no existing movement. Ever.** It is a one-time revaluation of
*on-hand* inventory to 5090, not a restatement.

### 7.3 Why not FIFO

The receipt row looks like a cost layer, and it is necessary but nowhere near sufficient:

- A layer needs a **mutable `remainingQty`**. Every movement field is `updatable: false`.
- **One consume movement splits across layers**, so it no longer has a single `unitCost` — the
  one-row-one-cost invariant dies, and with it the clean `SUM(extendedCost) GROUP BY glAccount`
  the entire posting design rests on.
- **QoH is a full re-SUM.** Layer allocation is order-dependent and must be incremental.
- A backdated receipt forces relayering of everything downstream.

The same three objections kill *lot costing*, which is specific identification with a per-lot
key. It also imposes the cost that actually fails in practice: the floor recording which bin
they pulled from, on every consume — and a missed selection is indistinguishable from a correct
one until a year of margins is wrong.

### 7.4 The four cost fields on the movement

| Field | Meaning |
| --- | --- |
| `unitCost` | Standard cost per unit, frozen at write time, integer cents. |
| `extendedCost` | `round(unitCost × quantity)`, **signed like `quantity`**, so a period rollup is a plain `SUM`. |
| `costBasis` | `standard` \| `actual`. Always `standard` today. |
| `glAccount` | `1310` / `1330`, resolved from `partKind` **at write time**. |
| `qtyPerUnit` | The as-built BOM snapshot on a `build_consume` row. NULL means the component was **off-BOM** — a floor substitution. |

**Why store both `unitCost` and `extendedCost`:** `unitCost` is what a human audits;
`extendedCost` is what SQL sums without a multiply a NULL can poison.

**Why store `glAccount` rather than derive it:** if a part is reclassified from `component` to
`finished_good`, deriving would silently restate every closed period that touched it. The stored
value is the classification *as of the movement*.

**Historical movements have NULL costs and stay NULL.** They predate the regime and are not
postable; any `listUnpostedMovements` must filter `unitCost IS NOT NULL`.

### 7.5 Landed cost and the accrual split

`computeLandedCost` = `unitPrice + shippingCost + unitPrice × tariffRate/100 + otherCost`.

🛑 **GRNI is credited at `vendorUnitPrice`, not landed cost.** The vendor's invoice contains only
`unitPrice` — freight is invoiced separately and weekly, duty comes from the broker. Credit GRNI
landed and debit it vendor-only and the account never clears; it is a liability that grows
monotonically and reconciles to nothing. Each adder clears against the accrual that matches its
own invoice:

```
Dr 1310 Inventory              landed
  Cr 2160 GRNI                 vendorUnitPrice × qty   ← clears against the vendor bill
  Cr 2150 Freight Accrual      the shipping portion    ← clears against the freight invoice
  Cr 2170 Duties Accrual       the tariff portion      ← only if tariffRate is ever non-zero
```

---

## 8. The Make Side — the build event

`packages/lib/src/builds/`. A `build` records: consume the components, produce the finished good,
at a cost that sticks.

```
completeBuild()  —— ONE transaction ——▶  −20  400Lbs Motor Assembly  @ child standard
                                          +10  Auxx Lift 400lbs      @ parent standard
```

- **WIP is derived, not stored.** Consume and produce are written in one transaction, so the
  ledger never holds an intermediate state. `1320 WIP` exists in the GL entry — where the
  variance becomes visible — and nets to zero on every completed build.
- **A build is reversed, never edited.** Same rule as the movement it writes.
- **`build_status` is guarded** on the field chain, for `['in_progress', 'completed', 'canceled']`.
  `planned` is excluded *structurally*: it is the field's `defaultValue` and `applyDefaults`
  injects it into every create before the field chain, which has no create exemption — guarding
  it would refuse every build create.
- 🛑 **The guard is registered on the field chain ONLY**, unlike quote/invoice/PO. See §11.
- **Residual:** `completed → planned` by hand stays reachable. Closing it needs a *transition*
  guard, which the field chain cannot express (`existingValue` is hardcoded `undefined` on the
  single-field path), so writing one would produce an inert guard.

### 8.1 An order-raised build tracks its order

An order raises the builds needed to fulfil it, through **one** raise door. The build is a
**projection** of the order, not a snapshot: the order controls the build, a reconcile overwrites
a human's edit, and coverage is the full ordered quantity. Divergence is stamped
(`order_build_revision` / `build_order_revision`) and *shown* — drift is `true` only when both
stamps exist and differ; a missing stamp is *unknown*, never *drifted*.

`reconcile-policy.ts` decides and `reconcile-order-builds.ts` executes; the stamp ignores the
edit window and the apply honours it.

### 8.2 `stock_movement_adjust_subparts` — do not delete this field

It was once the inventory bridge's flag, and the bridge is deleted. **The field is still live and
still must not be deleted**: `explodeBomMovement` guards on it as its third statement, before any
query, so a `false` reaches that guard on every write lane. It is now the belt that keeps a
build's movements from exploding their own BOM. Update the reasoning, not the conclusion.

---

## 9. The GL Seam — what exists, what is designed

### 9.1 What is built

- `gl_posting`, `gl_posting_line`, `gl_account` **entities**, seeded and invisible.
- `packages/lib/src/postings/` — `build-entry.ts`, `periods.ts`, `provider.ts`. Pure-ish;
  persists nothing yet.
- Postings are stored as **double-entry lines keyed on an account CODE** (`'2160'`), never a
  provider account id. Provider ids live in `RecordIdentity`, hung off `gl_account` by the app
  that owns them. This is the whole cash value of "the provider is an exporter" (P2).

#### The chart of accounts is seeded, and a posting names a ROLE (`G7` / `G8`)

`postings/default-chart.ts` is a **default the org edits**, not a standard: 28 accounts, seeded
into every org by entity migration 108 (`seed/gl-account-chart.ts`, idempotent on `code`). Twelve
of them carry a `gl_account_role`; the other sixteen are ordinary bookkeeping auxx never posts to,
and a role-less account is the normal case.

🛑 **Because the chart is editable, no code may name a number.** A builder emits
`ACCOUNT_ROLES.GRNI` and a resolver reads *this* org's chart to learn that GRNI is `2160` here and
`2155` at the customer who renumbered it. The chain is `role -> the org's gl_account -> code ->
the provider's id`, and only the last hop belongs to a provider adapter. The resolver must fail
**closed** on zero or more than one match — never "take the first", which is the one behaviour
that would put money in an arbitrary account. That is why the seed is a single sequential writer
and why `gl_account_role` is `unique: true`.

⚠️ **`stock_movement.glAccount` stores a ROLE, not a code**, despite its name and its
`stock_movement_gl_account` system attribute (both predate `G8` and cannot be renamed without
reshaping a materialised field in every org). It used to hold `'1310'` / `'1330'`. A movement is
append-only and frozen at write time, so a number stamped on it is silently reinterpreted the day
the org renumbers — and the posting it feeds still balances, so nothing downstream can detect it.
`resolveInventoryRoleForPartKind` is the only thing that decides the value; `buildReceiptEntry`
consumes it as `inventoryAccountRole`. Migration 108 remaps the legacy codes.

**`vendor_bill_line.glAccount` is deliberately the opposite and stays a CODE.** It is a
bookkeeper coding a line against their own chart — most of which carries no auxx role — and it is
`updatable: true`, so nothing about it is frozen history. Same question, different answer.
(`bill-lines-from-purchase-order.ts` still hardcodes `GRNI_ACCOUNT_CODE = '2160'` for its prefill;
that one *is* a `G8` violation and should resolve the `grni` role instead.)

### 9.2 What is designed and not built

`packages/lib/src/money/gl/` **does not exist**. The builder/poster seam, the fulfillment entry,
and the close console are all design-only — see `plans/money/design/gap-e/f/g`.

The intended seam is *builders are the accounting, the poster is the plumbing*: each builder
returns a `DraftJournalEntry` of **logical account keys** and **integer minor units, always
positive, with direction as a separate field**; one poster resolves keys to provider ids,
asserts `Σ Debit === Σ Credit`, and handles idempotency.

### 9.3 L1 vs L3 — the load-bearing constraint

🛑 **A balance assertion and per-event postings cannot both drive `1310` / `1320` / `1330`.** The
monthly assertion would silently reverse every perpetual posting and dump the residual into COGS,
where it would look like consumption.

**L1 (what ships first):** one entry per month asserting each inventory account to the value the
subledger computes, with labour and overhead absorbed out of their pools and COGS as the
balancing figure. It needs **no A/P**, and it tolerates imprecise coding during the month because
the balance is *asserted*, not accumulated — a miscoded purchase distorts one month and
self-corrects the next.

**L3 (perpetual)** is a switch thrown once GRNI has both sides. Turning on per-event postings and
turning off the monthly assertion is **one** change, never two.

> The A/P leg has a hard external ordering constraint: the provider's A/P account is not
> addressable until one `Bill` object has existed in it.

### 9.4 How money is represented — settled, do not re-open

**Every monetary amount in the posting tables is an INTEGER NUMBER OF MINOR UNITS, stored in a
`bigint` column, always positive, with direction carried in a separate field** (decision `G2`).
`GlPosting.totalMinor` and `GlPostingLine.amountMinor` are both `bigint({ mode: 'number' })`.

This gets re-litigated, so the reasoning is recorded here once.

**Never floating point.** A general ledger's whole invariant is that debits equal credits
*exactly*, and binary floats cannot represent decimal fractions. Verified against the dev database:

```sql
select (0.1 + 0.2) = 0.3        -- false
select sum(0.1) over 100 rows   -- 9.99999999999998
```

One hundred dimes do not sum to ten dollars. In a ledger this forces a choice between an assertion
that fails on correct entries and an epsilon tolerance — and an epsilon is where a real one-cent
error hides forever. A double *is* exact for whole numbers below 2^53, so cents-in-a-double would
compute correctly; it is still wrong because nothing enforces integrality. The column type says
fractional, so a bug writing `1234.5678` is accepted in silence, and SQL `SUM()` over a float may
reorder and disagree with itself between runs. `bigint` makes the wrong value unrepresentable
rather than merely unlikely.

⚠️ **`FieldValue.valueNumber` IS `doublePrecision`**, and that is where every purchase order,
vendor bill and invoice amount currently lives. It is a shared generic column — it also carries
quantities, weights, percentages and ratings, so it has to be fractional. It was never chosen for
money. This is a real latent weakness in the product and the reason the posting tables are
deliberately *not* modelled on it.

**Not `numeric`, either** — though it is the textbook accounting type and the tempting answer.
`numeric` is exact and would be correct in isolation, but the entire codebase already speaks minor
units: `G2`, `money/totals.ts`, the `CURRENCY` `FieldType` convention, `matchVariance`, and the
pure builders in `postings/build-entry.ts`, which are typed on `number`. Introducing decimal
strings only in the GL creates a conversion boundary between the subledger and the ledger it
feeds — and a conversion boundary is precisely where money bugs live. Consistency is the
correctness argument here, not convenience. `numeric` would be right if sub-cent precision were
ever needed; it is not.

**Why `mode: 'number'` and not `mode: 'bigint'`.** Two reasons, the second more practical than the
first.

1. True `BigInt` pushes `BigInt` arithmetic through every pure builder and creates the same
   conversion boundary the previous paragraph rejects.
2. **`JSON.stringify` throws on a `BigInt`** — `TypeError: Do not know how to serialize a BigInt`.
   tRPC here is configured with **superjson** (`server/api/trpc.ts:73`), which handles `BigInt`
   fine, so that one boundary would have survived. The others would not: `@auxx/logger`'s
   structured shipping to OpenObserve, BullMQ job payloads through Redis, and — most relevantly —
   the JSON body the accounting provider is POSTed. The GL poster is the exact code that crosses
   that last boundary.

⚠️ **The one honest cost of `mode: 'number'`:** Drizzle's mapper is `Number(value)` — verified in
`drizzle-orm/pg-core/columns/bigint.js:24`. Above 2^53 it **silently rounds** rather than throwing,
which is a worse failure shape than an error. Postgres still stores the true value; only the JS
read loses it. The threshold is roughly $90 trillion, about six orders of magnitude past anything
this business will post, which is why the trade is worth taking — but it is a rounding cliff, not
a guard rail, and it should be named rather than discovered.

🛑 **The ceiling that made this a real bug:** the columns shipped as `int4` on 2026-08-28, ceiling
**$21,474,836.47**. That is under a single real account balance in this business, and Postgres
fails such a write with `22003` — so a month-end close would refuse to post rather than degrade.
Caught and widened before either table held a row. Any *new* money column anywhere in this
subsystem is `bigint` minor units for the same reason; the type is pinned by the structural tests
in `packages/database/src/tests/gl-posting-schema.test.ts` so it cannot silently regress.

---

## 10. Write Lanes & the Silent Ledger Write

🛑 **`skipEvents: true` is INSUFFICIENT, not merely deprecated — there are TWO doors.**

| Door | What it is | Gated on |
| --- | --- | --- |
| **A** | the per-write fan-out (`derivePublishEvents`) | `publishEvents` |
| **B** | the **sync manifest** — `createEntity`'s `syncCollectorOf` + `recordCreated` block | **neither `publishEvents`, nor `txScope`, nor `skipEvents`** |

So a session with `skipEvents: true` is still captured by door B and the manifest consumer still
dispatches the native rules from it.

**For a deliberately silent ledger write, use `quietSession(reason)`** — not `seedSession` (the
reason string would be a lie), not `absorbedSession` (it needs a real named aggregator), and not
a bare `publishEvents: false` (`silent-write-conformance.test.ts` scans for it and fails).
`builds/write-lane.ts` is the reference.

⚠️ **A quiet lane silences the WHOLE rule.** `mfg-stock-movements-created` also fires
`recalculatePartQoH`. Go quiet and the caller's own post-commit recalc becomes the **only** QoH
writer — and it must then cover every part the write touched.

⚠️ **Post-commit work must be enqueued after `COMMIT`.** The enqueue resolves its source on a
different connection and cannot see uncommitted rows.

---

## 11. Gotchas & Invariants

These are the silent failures this subsystem has already paid for. Every one of them passed CI.

**A migration that creates a field must flush the org cache BEFORE anything writes a record with
it.** `UnifiedCrudHandler.warmCache` resolves an entity's fields from the org cache and **drops a
value whose field it cannot resolve** rather than failing. Entity migration 108 created
`gl_account_role` and then seeded the chart of accounts in the same pass, with its cache flush at
the end of `up()`. Every create ran against a `customFields` snapshot taken before the field
existed: **784 accounts across 28 orgs, every column written except the role**, nothing threw, and
the migration logged `applied`. A chart with no roles makes the posting resolver fail closed on
every entry. The flush now sits between the structure work and the record work,
`seedDefaultChartOfAccounts` re-reads what it wrote and throws if a role did not land, and
`108-purchasing.test.ts` pins the ordering by source position. Verify a migration by querying
Postgres, never by reading its log line.

**A migration that changes the MEANING of a stored derived value owns re-deriving it.** `P24` did
not add an option to `vendor_bill_status`; it changed what the stored value means — billed-but-not-
received is `awaiting_receipt` now, not `exception`. Nothing else moves an existing bill: the
nightly aging sweep reads only bills *already* in `awaiting_receipt`, to age them forward. 108
therefore re-runs `rematchBill` over every bill in a matchable status, which re-derives status,
variance **and notes** together — the notes are the half that lies loudest, being prose generated
by a reason code that no longer exists.

**A child-to-parent roll-up needs a door for every way its child can change, and
`created`/`deleted` is only complete when the child is append-only.**
`purchase_order_line_quantity_billed` had exactly those two triggers, and
`purchase-order-status-writer.ts` asserted in prose that they were "the two events that can move
either axis". That held for the RECEIPT roll-up, whose child `stock_movement` is append-only —
a correction is a reversal, which is another create. It was false for BILLING, because a
`vendor_bill_line` is created at its registry default of `1` and the real quantity is typed in
**afterwards**: the ordinary act of transcribing an invoice moved the child and never re-SUMmed
the parent. Two dev orders sat at a stored `1` against bill lines reading `4` and `10`, and the
divergence was permanent. Downstream, `selectBillableLines` gates on `billed < ordered`, so a
fully-billed line kept being offered back on the next bill, and `purchase_order_billing_status`
is classified from the same stale figure. Fixed 2026-08-28 by
`recalculateBilledRollupOnBillLineChange` marking a per-line reconciler.

**A relationship repoint dirties TWO parents, and the post-hook only names one.** The edit door
above is keyed on `vendor_bill_line_quantity_billed` *and*
`vendor_bill_line_purchase_order_line`, because the match key is user-editable
(`PurchaseOrderLinePicker`) and re-pointing a bill line at a different order line leaves the line
it VACATED holding a phantom quantity. `newValue` names only the destination, so the handler
reads `EntityFieldChangeEvent.oldValue` — the pre-write value, and the only place the vacated
parent is still named — and marks both. This is why the reconciler is keyed on the PURCHASE ORDER
LINE (the marked record IS the parent, no `resolve` step): one keyed on the bill line could only
ever resolve the parent it now points at. ⚠️ A fix of this shape prevents new divergence and does
**not** repair rows that already diverged; whether that needs a backfill is a separate call, and
for this one it did not (purchasing was pre-deployment, so the stale rows went with the dev seed).

**A cached value derived from CODE outlives the code.** The `recordRules` cache once held DB
rules unioned with code-declared system rules, so adding an action to a system rule did nothing
for a day per org — the cached list kept firing, nothing threw, nothing logged. Two rules:
**never cache anything derived from a code-level declaration** unless the key carries a version
bumped in the same commit; and when converting a cached union to a read-time union, **bump the
key prefix**, or old entries get a second copy appended and every rule fires twice until expiry.

**`invalidateResource` is a delete, not a refresh.** It removes every cached field value for the
record, so calling it to refresh one roll-up wipes the record's relationships with it. Prefer the
non-destructive publish path (`publishFieldValueUpdates` → `useResourceSync` → `setValues`);
reach for invalidation only when there is no publisher.

**An inverse relationship is a SECOND copy of the same fact.** It is stored on the child and
mirrored on the parent. The realtime half is fixed — `relationship-sync.ts` publishes the diff —
but the mirror still **fires no record rules and writes no timeline entry**, so an automation on
"when this order's lines change" is dead. And if you reach for the list lane instead, **build the
filter through a shared function**: `createListKey` hashes the filter's `id` strings, so a
hand-written equivalent lands on a private cache entry no optimistic append ever reaches.

**A card declared with no component renders nothing** — no error, no placeholder, no warning.
Declare a card value in `drawer-config.ts` / `detail-view-config.ts` only in the same change that
registers its component. Now automated by `drawer-card-parity.test.ts`, which carries a
non-vacuity guard so a config shape change cannot make the walk yield zero keys and pass while
checking nothing.

**Entity colours and field-option colours are different unions**, differing by one entry —
`ICON_COLORS` has `emerald`, `SELECT_OPTION_COLORS` has `forest`. `slate`, `rose`, `cyan` and
`violet` are in neither, and `getIconColor` falls back to gray with no error.

🛑 **A receipt that sends only `vendorUnitPrice` freezes the wrong cost, silently.**
`resolveReceiptPrice` derives the landed cost from the **supplier row's own `unitPrice`** whenever
`unitCost` is absent — so a form sending an edited base price without the landed total stores a
cost computed from the price the user just replaced. Nothing throws; the frozen cost is wrong
forever, on the one field the entire inventory valuation rests on. **The rule: whenever a form
can price a receipt at all, it sends BOTH figures, and the landed one is the number the breakdown
displayed.** `receipt-input.ts` exists to make that testable rather than a comment.

🛑 **`ensureCustomFields` never rewrites an existing field's `options`.** Adding a value to a
seeded SINGLE_SELECT reaches **new orgs only**; the code, the UI and the DB then disagree with no
error anywhere, and the new value renders as a raw string with no label or colour. The fix is a
re-materialize step in the migration that rewrites the whole array when it differs — **rewrite,
do not append** (an appended value sits last on migrated orgs and mid-list on fresh ones), and
**count it as work**, or the run skips the org-cache flush and the value stays invisible anyway.

🛑 **`ensureEntityDefinitions` is CREATE-ONLY.** It skips any org already holding the def, so
`isVisible` is evaluated only at creation. **Editing `SYSTEM_ENTITIES` reaches no existing org** —
flipping one boolean across existing orgs needs its own migration. Same shape as the trap above,
same consequence: no error, no log line. It reads as correct in review.

🛑 **The system-hook chain has NO `bypassFieldGuards`.** That exemption lives only in
`fireFieldPreHooks`. So which chain a lifecycle guard belongs on is decided by **how its
sanctioned writers write**, not by taste: writers that go through `FieldValueService` directly
need both chains; writers that go through `UnifiedCrudHandler.update` need the field chain
**only**, or the guard refuses the very buttons it protects.

⚠️ **`on: 'set'` is not a transition.** The interactive native-field door dispatches
`oldValue: undefined` against a sentinel, guaranteed unequal, so **every write matches**. A
handler needing a real transition must re-read the field. The sync-manifest door *does* carry
real old→new values — so the same rule behaves differently by door.

⚠️ **A new `entityType` takes EIGHT files, not five.** Beyond `enums.ts`, `SYSTEM_ENTITIES` and
the fields registry: `SYSTEM_ATTRIBUTES` (miss it and nothing compiles), `ENTITY_DEFINITION_TYPES`,
`RESOURCE_FIELD_REGISTRY`, the entityType→registry map in `create-fields.ts`, and
`DISPLAY_FIELD_CONFIG` — the last four fail **silently and later**.

🛑 **A Redis outage leaves every interactive write spinning rather than failing.**
`publisher.publishLater` is **awaited** on the interactive lane, it is a BullMQ write, and
`maxRetriesPerRequest: null` means the command never settles against an unreachable Redis.
`setValuesForEntity({ publishEvents: true })` therefore never returns — no throw, no timeout.
Not this subsystem's bug; it is on the write path every surface here uses.

🛑 **`vendor_payment` is walled by a test.** `108-purchasing.test.ts` walks every `.ts`/`.tsx`
under `packages/lib/src` and fails if any file outside a 9-entry allowlist so much as **names**
`vendor_payment` / `VENDOR_PAYMENT`. Deliberately stronger than "nothing writes it" — a reference
is the first step of a writer, and an allowlist entry is a reviewable edit. It is what keeps *a
def with zero rows can be reshaped for free* a fact rather than a comment claiming to be one.
Adding to that allowlist is the moment to re-read the payment shape decisions.

**Integration tests do not run in the default suite.** `packages/lib/vitest.config.ts` excludes
`src/**/*.int.test.*` — that config mocks `@auxx/database`. They need
`pnpm -F @auxx/lib test:integration` and a live Postgres. **A green package suite is not evidence
that any integration test passed, or even ran.**

---

## 12. Where the Plans and the Code Disagree

Recorded because both documents still exist and a reader will otherwise trust the wrong one.

| Claim | Reality |
| --- | --- |
| Gap E §4.2 recommends `GlPosting` as a **real Drizzle table**, for a Postgres-enforced `(org, type, period)` unique index and a three-line `INSERT … ON CONFLICT` claim step. | ❌ **Not what shipped.** `gl_posting`, `gl_posting_line` and `gl_account` are all `EntityInstance`-backed system defs. Gap E's objection therefore stands and is **unaddressed**: there is no composite unique constraint across two fields of an instance, because they are two `FieldValue` rows, not two columns. Double-posting protection will have to be application-level check-then-insert — the shape this codebase already knows leaks (see `duplicate-detection-architecture-guide.md` on the exact-match arm as an enforcement-leak detector). Resolve before the poster persists anything. |
| Gap C §6.1's `rollStandardCost` formula (`standardMaterialCost = round(part_cost)`). | ❌ Superseded — see §7.2. The shipped roll sums children's `standardCost`, bottom-up, gated on `partKind`. |
| Gap D §8 "purchase orders — later". | ❌ Stale. The buy side shipped ahead of it. |
| `EntityTypeValues` / `EntityType` in `packages/database/src/enums.ts` | ⚠️ **Stale by thirteen types** — missing `order`, `purchase_order`, `vendor_bill`, `gl_account`, `build` and more. Its only consumer is a `z.enum` that system-seeded defs never reach, so nothing is broken. ⚠️ That file has a **destructive generator**; hand-edit it. |
| `EntityRefKind` in `packages/sdk/src/root/tools/types.ts` | ⚠️ Stale — never gained `purchase_order` / `vendor_bill` / `gl_account` / `order` / `build`. **This one blocks work**: an installed app cannot declare a field against a kind not in the union, and hanging provider account ids off `gl_account` needs it. Different union from the one above; confusing them wastes a pass. |
| `vendor_bill_balance` "computed from total and amountPaid" | ❌ **No writer exists.** Declared `creatable: false` with no hook, so it is unwritable by a human and uncomputed by the system: every bill's stored balance is NULL. The payment card sidesteps it by computing the display value, so the screen is right and any filter or sort on Balance is not. |

---

## 13. Key Files

**Lib modules**

| Path | Owns |
| --- | --- |
| `packages/lib/src/purchasing/` | `match.ts` (the pure match), `match-hook.ts` (triggers), `match-reconciler.ts` (re-match on receipt), `allocate-landed-cost.ts`, `purchase-order-status*.ts`, `vendor-part-lookup.ts` |
| `packages/lib/src/receiving/` | `receive-stock.ts`, `receive-purchase-order.ts`, `adjust-stock.ts`, `reverse-movement.ts`, `cost-fields.ts`, `guard.ts`, `receipt-queries.ts` |
| `packages/lib/src/builds/` | `complete-build.ts`, `standard-cost.ts`, `build-mutations.ts`, `reverse-build.ts`, `reconcile-order-builds.ts`, `reconcile-policy.ts`, `drift-*.ts`, `auto-build-*.ts`, `write-lane.ts`, `guard.ts` |
| `packages/lib/src/bom/` | `cost-calculator.ts` (`computeLandedCost`, the live roll-up), `qoh.ts` (`recalculatePartQoH`), `subpart-graph.ts` |
| `packages/lib/src/postings/` | `build-entry.ts`, `periods.ts`, `provider.ts` — the posting seam, persisting nothing yet |
| `packages/lib/src/money/gl/` | 🛑 **does not exist** — Gap E is design-only |

**Registry & seed**

- `packages/lib/src/seed/entity-seeder/constants.ts` — `SYSTEM_ENTITIES`
- `packages/lib/src/resources/registry/resources/` — `purchase-order-fields.ts`,
  `vendor-bill-fields.ts`, `stock-movement-fields.ts`, `build-fields.ts`, `gl-*-fields.ts`,
  `vendor-payment*-fields.ts`
- `packages/lib/src/seed/entity-migrations/migrations/` — 108 purchasing, 109 build (inert),
  110 build-visible, 111 build drift, 112 record-documents

**Surfaces**

- `apps/web/src/components/purchasing/` — the PO and bill cards, the line picker, the bill dialog
- `apps/web/src/components/manufacturing/` — parts, receipts, builds
- `apps/web/src/server/api/routers/purchasing.ts`
