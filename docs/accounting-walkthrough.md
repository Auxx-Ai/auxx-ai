<!-- docs/accounting-walkthrough.md -->

# Closing the books: how the accounting module is used

Orientation for someone new to `/app/accounting`. Auxx already knows what was
bought, received, built, sold and paid for. This module is the layer that turns
that subledger into books a business can run on: double entry, a chart of
accounts, period locks, and statements.

**Permissions:** `ledgerView` to read, `ledgerPost` to post and reconcile, `ledgerControl` for the
chart, the opening trial balance and the period lock.
**Regime:** L1 (month-end inventory assertion, not per-event costing).
**As of:** 2026-09-08.

---

## 1. Where the ledger sits

```
   BUY          RECEIVE         MAKE          SELL          BANK          BOOK
 ─────────   ────────────   ──────────   ───────────   ──────────   ───────────
 purchase_    stock_          build        order        bank_         gl_posting
 order        movement        consume/     invoice      transaction   double-entry
 vendor_bill  (append-only)   produce      payment      (Stripe FC)   balance sheet
     │            │              │             │             │             │
     └────────────┴──────────────┴─────────────┴─────────────┘             │
              the costed subledger — already ours                    the books
```

QuickBooks, where it is connected at all, sits downstream of the last box. It is
the **exporter the CPA files from**, never the source of truth. "Nothing
connected" is a fully supported configuration — the ledger is ours, entries are
still built, balanced and persisted, and only the export does not happen.

---

## 2. Five rules that explain most of the design

Everything odd-looking in this module traces back to one of these.

| Rule | What it means in practice |
| --- | --- |
| **Roles, not numbers** | Code never names `1100`. It names the role `accounts_receivable`, and the org's own chart resolves it. A bookkeeper coding a manual line uses an account *code*; a builder never can. This is what lets an org rename and renumber its chart without breaking a posting. |
| **Correct by reversal** | There is **no edit path on a posted line, anywhere**. A mistake is fixed by posting its reversal. That is why the UI offers "Reverse" where you would expect "Edit", and why a wrong number stays visible in history forever. |
| **One writer per account** | Cash and the three inventory accounts may have exactly one posting type that writes them. Two writers both balance, so a double count never surfaces — it shows up months later as a cash account that will not tie. |
| **Periods lock** | A month closes and then refuses new entries. Boundaries are wall-clock midnights in the org's `bookTimeZone`, not UTC. A blocked entry is offered the **next open period** rather than silently failing. |
| **Refusals are cards** | When the ledger declines to post you get an **Entry blockers** card naming the reason and the remedy, never a toast. Accounting refusals are usually correct and always need reading. |

One more worth stating: **bookkeeping never blocks the business.** An invoice
must not fail to send because its posting failed — the customer is waiting on the
document. Postings never throw; a refusal is recorded and surfaces later in the
unposted-periods banner.

---

## 3. The four tabs

| Tab | Route | What lives there |
| --- | --- | --- |
| **Ledger** | `/app/accounting` | The close console: this month's entry, the entries list, the journal-entry drawer, books-balance health, the period picker. |
| **Banking** | `/app/accounting/banking` | The For Review queue, plus Deposits, Payouts, Rules and CSV/OFX Import. |
| **Reports** | `/app/accounting/reports` | Trial balance, balance sheet, P&L, A/R and A/P aging, vendor 1099. PDF and CSV out. |
| **Settings** | `/app/accounting/settings` | General (period, payment routing), Chart of accounts, Bank accounts, Opening balances. |

Banking is hidden without `ledgerPost`. Inside Settings, General and Bank accounts need
`ledgerPost`; Chart of accounts and Opening balances need `ledgerControl`.

---

## 4. The flow

Grouped by **how often somebody does it**, because that is the thing newcomers
get wrong: most of these entries post with nobody in the Accounting module at
all.

### 4.1 Once, at cutover — the setup wizard

*Owner or bookkeeper. Half an hour.*

Auto-opens on the first visit anywhere under `/app/accounting`. Nine pages, and
**the order is load-bearing** — each page depends on what the one before it
wrote. Every page is skippable, and every page writes real settings rather than
wizard-local progress, so the settings screens, the checklist and the Post gate
all read one source and agree.

1. **Welcome** — what the wizard is about to change.
2. **Accounting period** — fiscal year start, book time zone, cutover month.
3. **Opening inventory** — the snapshot the three inventory accounts start from.
4. **Opening trial balance** — every other account's starting balance. Its three
   inventory rows are prefilled from step 3 and locked, which is why it sits here
   and not first.
5. **Costing** — standard cost settings.
6. **Account roles** — which of your accounts plays each role. Must come before
   mapping: a role has to point at one of our accounts before that account has
   anything to be paired with.
7. **Accounting system** — connect QuickBooks, or don't.
8. **QuickBooks accounts** — pair each of our accounts with one of theirs. Cannot
   render a row until step 7 fetched a provider chart.
9. **Finalize** — posts the opening balance entry, dated the day before cutover,
   and freezes the baseline.

> 🛑 **The setup freezes on the first posting.** Once a single `GlPosting` exists
> for the org, the server *refuses* further changes to the opening balances, the
> book time zone and the cutover period, naming the reversal path in the error.
> This is a server guard, not a disabled button — a script or a direct settings
> write hits it too.

### 4.2 Continuously — documents post as they happen

*Nobody does this. It posts itself as the business runs.*

Sales, invoicing and payments happen in the money module; accounting is just
where the result lands. Each of these fires **after** its document's writes
commit, never inside them.

**An invoice is issued** — `AUXX-INI-<invoice number>`

```
  Dr 1100 accounts_receivable   total
      Cr 4030 revenue_service     total - tax
      Cr 2200 sales_tax_payable   tax          (leg omitted when zero)
```

Dated the invoice's own issue date, not today.

**A payment is received** — `AUXX-PMT-<hash>`

```
  Dr route (1050 undeposited | 1000 cash | 1200 card clearing)   amount
      Cr 1100 accounts_receivable                                  allocated
      Cr 2350 customer_deposits                                    the rest
```

The debit account comes from the per-method routing set in Settings > General.
Money received against nothing is a **liability**, not revenue.

**A held deposit is applied** — `AUXX-DPA-<hash>`

```
  Dr 2350 customer_deposits     reclassed
      Cr 1100 accounts_receivable  reclassed
```

Moves a prepayment onto the receivable it finally has an invoice for. No cash
moves.

**Stripe pays out** — `AUXX-PAY`, record `PAY-0001`

```
  Dr cash                      the whole deposit that reached the bank
  Dr payment_processing_fees   fees withheld on the RECOGNISED charges
      Cr 1200 clearing_card          RECOGNISED gross
      Cr 2450 unidentified_receipts  the unrecognised remainder, net
```

Four legs, and each one buys something specific:

- **cash takes the whole deposit**, so the entry matches the one bank line;
- **clearing is relieved of exactly what Auxx put in it**, so it still
  reconciles to zero;
- **the remainder stays visible per payout** in `2450`, instead of driving
  clearing permanently negative by whatever the merchant charged outside Auxx.

When every charge is recognised the fourth leg is zero and drops, and the entry
is the ordinary three-line one.

> ⚠️ **Payouts are the one automatic job.** They arrive two ways: a
> `payout.paid` webhook, and a nightly sweep at **04:30 UTC** that walks every
> org with a live Stripe connection. Both run the same idempotent sync keyed on
> the gateway id, so a payout cannot post twice. A failed payout is **reversed**,
> never deleted.

### 4.3 Weekly — clear the bank queue

*Bookkeeper. Banking tab.*

The bank feed brings in lines the business has no document for yet. Every line
gets one of four decisions:

| Treatment | When | What it posts |
| --- | --- | --- |
| **Match** | The line is a payment or deposit Auxx already knows about | **Nothing.** It links. |
| **Code** | No document exists — a bank fee, an owner draw | Posts by account code |
| **Transfer** | Money moving between two of your own accounts | Pairs two lines |
| **Exclude** | Not yours, or a duplicate | Nothing. Undoable. |

> 🛑 **Why matching posts nothing.** A payment already posted its own entry. If
> the matched bank line posted a second one, **both would balance** and cash
> would be overstated by that payment with nothing to flag it. This is the
> double-count hazard the whole bank-feed design is built around.

The queue is meant to be cleared in bulk, not row by row. Stripe gives us a
`description` string and nothing else — no merchant enrichment, no categories —
so **suggest-from-history is the primary mechanism**, not a supplement. Accept
suggestions in bulk, bulk-exclude, bulk-assign an account, or promote a line you
just coded into a standing **rule** straight from the drawer.

Also under Banking:

- **Deposits** — group the cheques and cash sitting in Undeposited Funds into one
  slip matching the single line the bank will show. Posts one cash line, prints a
  slip PDF, and refuses edits once cleared. ACH and card bypass this entirely.
- **Payouts** — every Stripe payout with its split. "Sync now" for impatience,
  and an **Unidentified only** filter for payouts carrying money Auxx did not
  recognise.
- **Import** — CSV/OFX for the window before the bank connection existed, since
  the feed's history only accumulates from the connection date forward.

### 4.4 As needed — adjusting entries and write-offs

*Bookkeeper. Ledger tab.*

A manual journal entry opens as a **drawer** on the ledger page (`?je=new`),
never its own route. Code the lines by **account code** — the one place a human
picks an account directly — with a two-line minimum, a balance check, and
positive integers only.

- **The drawer raises its record on the first edit, not on open.** Open it and
  close it without typing and no `JNL-` number is burned. That also means a
  never-touched draft has nowhere to hang an attachment yet, and the row says so
  in a sentence rather than rendering a picker that would fail.
- **The attachment stays editable after the entry posts** — alone among the
  drawer's controls. It is *evidence about* the entry rather than part of it, so
  a statement that turns up a week after the close can still be stapled on.
- **A manual entry may never name an inventory account.** Refused by name, with a
  card pointing at the close console instead.
- **Discarding a draft archives it, never deletes it**, guarded at the record
  layer so the generic delete cannot slip past.
- **Write-offs** start from the invoice, not from here. The remaining balance is
  derived as `total - paid - written off`, and a partial write-off is repeatable.

### 4.5 Month-end — close the month

*Bookkeeper. Ledger tab.*

The ledger page shows one of three states: setup not finalized (the checklist), a
month open and ready to post, or everything posted. Under L1 a month has exactly
one month-end entry, so it renders inline rather than as a list.

1. **Pick the period** — the toolbar's period picker, not the page header.
2. **Read the preview** — an open month renders the *projected* entry from the
   builder; a posted month renders the *stored* one. They are never crossed:
   re-running the builder over a posted month gives a different answer the moment
   the subledger moves, and the number that matters is the one that was posted.
3. **Clear the blockers** — the Entry blockers card lists what stands in the way,
   each with its remedy. Ordinary outcomes stay neutral; only real refusals read
   as errors.
4. **Post** — needs `ledgerPost`. The result callout says what was written.
5. **Check the books balance** — the health line runs the whole-org verification,
   not just this entry's.
6. **Lock through the month**: needs `ledgerControl`. `ledger.setLockedThrough` sets
   `ledger.lockedThroughMonth`; the generic settings route refuses this key. Later arrivals
   into a locked period are offered the next open one.

Got it wrong? **Reverse it.** The revision strip on the entry shows the chain,
and the reversal posts as its own entry rather than editing anything. An
unposted-periods banner catches any month whose posting was refused earlier and
never retried.

### 4.6 Whenever — print the statements

*Anyone with `ledgerView`. Reports tab.*

- **Trial balance** — ties to the same whole-org verification the ledger page runs.
- **Balance sheet** and **profit & loss** — with compare modes, correct across a
  year boundary in a non-UTC book time zone.
- **A/R and A/P aging**, and a **vendor 1099** report.
- Any figure drills down to the lines behind it.
- Every report renders to **PDF** and **CSV**.

> ⚠️ **Read the completeness banner.** Statements carry a banner naming any
> posting type that is **not enabled**. A balance sheet that balances is not the
> same as a balance sheet that is complete, and this banner is the difference.
> Check it before believing a number.

---

## 5. What is not live yet

The union of posting types does not tell you what is live, and neither does the
existence of a builder. `ENABLED_POSTING_TYPES` in `postings/regime.ts` is the
one constant that does.

| | |
| --- | --- |
| **Built, dark** | **Per-event costing** (`receipt`, `vendor_bill`, per-event COGS). The builders exist and are tested. They stay off because the month-end inventory assertion currently drives the inventory accounts, and a balance assertion plus per-event postings may never both drive them. Turning it on is one swap, never an addition. |
| **Silent risk** | **Multi-currency.** A payout's currency is recorded, but the ledger is pinned to one currency and posts every payout as if it were that one. An org settling in two currencies books wrong numbers **and the entry still balances**, so nothing downstream complains. |
| **Unverified** | The **payout path has never run against a real Stripe account**, and its migrations are confirmed on dev only. The nightly sweep ships enabled, so the first production worker restart is when it starts posting. That first run wants watching — see `plans/accounting/payout-rollout.md`. |
| **Known gap** | The invoice drawer's Ledger panel reads **"Nothing posted yet"** both when nothing was ever attempted and when a posting was attempted and refused. Two different facts, rendered identically. The reason is already stored; the panel does not read it. |
| **No plans** | Payroll and a sales-tax engine are ruled out. `1210 Affirm Clearing` exists in the chart with no role and no writer. |

---

## 6. Deeper reading

| For | Read |
| --- | --- |
| Why the ledger is shaped this way | `docs/inventory-costing-architecture-guide.md` §9 |
| The current truth, newest section wins | `plans/accounting/HANDOFF.md` §11–§12 |
| What stands between the payout code and a live card sale | `plans/accounting/payout-rollout.md` |
| The bank feed, and the double-count hazard | `plans/bank-connection/README.md` |
| Every accounting surface and its primitives | `plans/accounting/ui-plan.md` |
