<!-- docs/mail-suggestions-architecture-guide.md -->

# Mail Suggestions & Unsubscribe Architecture Guide

**Last Updated:** 2026-08-01
**Scope:** *"We looked at your mail and noticed something."* How inbound mail grows a **bulk-sender
identity** at ingest, how a weekly job mines that into concrete **evidence-carrying proposals**
(unsubscribe from a newsletter nobody reads, auto-archive a sender you archive by hand), how a user
accepts or dismisses one, and how the **one-shot unsubscribe command** executes and is measured.

> This is the living reference for `mail-suggestions` + `mail-unsubscribe`. It consolidates
> `plans/mail-filter/03-suggestions-plan.md` (design history — §8 was revised on 2026-08-01 and
> decision **S12** supersedes the original UI section) and the parts of
> `plans/mail-filter/02-mail-filters-plan.md` this feature depends on.
> **Where the plans and the code disagree, the code is the truth**; §13 lists the deltas.
> Companions: `channels-mail-architecture-guide.md` (ingest, threads, the mail lens, inbox
> defs — read it first; nothing here re-derives visibility), `entity-events-architecture-guide.md`
> (signals and the timeline), `lib-module-guide.md` (both modules are the functional
> Drizzle + `neverthrow` shape).

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Core Concepts & Vocabulary](#2-core-concepts--vocabulary)
3. [Two Producers, One Surface](#3-two-producers-one-surface)
4. [The `subjectKey` Keyspace](#4-the-subjectkey-keyspace)
5. [The Data Model](#5-the-data-model)
6. [The Ingest Derive](#6-the-ingest-derive)
7. [The Mining Job](#7-the-mining-job)
8. [⚠️ The Compile Gate](#8-️-the-compile-gate)
9. [Unsubscribe](#9-unsubscribe)
10. [Permissions](#10-permissions)
11. [The Surfaces](#11-the-surfaces)
12. [Jobs & Schedules](#12-jobs--schedules)
13. [Where the Code Diverged From the Plan](#13-where-the-code-diverged-from-the-plan)
14. [Gotchas & Invariants](#14-gotchas--invariants)
15. [Key Files](#15-key-files)

---

## 1. Executive Overview

Four columns land on every inbound `Message` at ingest — `listId`, `senderDomain`,
`unsubscribeMeta`, `senderAuthenticated`. A weekly job groups them per inbox, applies thresholds and
four suppression rules, and writes at most **five** `MailSuggestion` rows per inbox. Each row carries
the evidence it was built from, the `ConditionGroup[]` it proposes, and the `MailFilterAction[]` that
would run. Accepting one calls the **ordinary** `mailFilters.create` mutation; unsubscribing runs a
**one-shot command** that is never a filter action.

```
  INGEST (pure header parse)          MINING (weekly, per inbox)          SURFACE
 ──────────────────────────   ──────────────────────────────────   ─────────────────────
  store-message.ts                buildInboxGroupQuery              mail toolbar button
    deriveBulkMailFields   ─▶       one grouped statement     ─▶      → openApprovals()
      listId                        ↓                                Approvals tab §4
      senderDomain                buildMailSuggestionDrafts          thread chip
      unsubscribeMeta               thresholds + 4 suppressions        │
      senderAuthenticated           assertFilterConditionsCompile ⚠️   │
                                    rank by msgCount × unreadRate      ▼
                                    cap at 5/inbox                accept → mailFilters.create
                                    ↓                            unsubscribe → executeUnsubscribe
                                  MailSuggestion rows                 → MailUnsubscribe row
                                                                      → daily "did they stop?" sweep
```

Three properties make this harder than "count some newsletters":

1. **A proposed filter that does not compile is catastrophic, not broken.**
   `buildConditionGroupsQuery` drops undispatchable conditions *silently*, and an all-dropped set
   reduces to the bare org scope — i.e. it matches **every thread in the inbox**. §8 is the whole
   reason `assertFilterConditionsCompile` runs when the **job writes the row**.
2. **Unsubscribing on someone else's behalf is an outbound action against a stranger.** The safety
   gate (§9.2), the SSRF hardening (§9.3), and the rule that `senderAuthenticated IS NULL` reads as
   *not* authenticated all exist because the failure mode is confirming a live address to a spammer.
3. **The suggestion is a prefill, never an authorization path.** Accept goes through the same router
   gate as hand-authoring a filter; the card only decides what to *offer*.

---

## 2. Core Concepts & Vocabulary

- **Bulk-mail group** — all inbound mail sharing one `subjectKey` in one inbox. The unit everything
  in this feature is about.
- **`subjectKey`** — `list:<listId>` or `domain:<senderDomain>` (§4). Minted by the miner, consumed
  by the unsubscribe executor and its sweep.
- **Suggestion / card** — a `MailSuggestion` row. `kind` ∈ `unsubscribe | auto-archive | auto-tag |
  auto-assign | route-inbox`; `status` ∈ `new | accepted | dismissed`.
- **Evidence** — the denormalized jsonb blob on the row. **Everything the card renders comes from
  it**, so displaying a card costs zero queries.
- **Suppression list** — the `dismissed` (and `accepted`) rows themselves. Dismissal is a *status
  write, never a delete*: deleting resurrects the card on the next weekly sweep.
- **Tier** — which unsubscribe mechanism a group supports: `one-click` (RFC 8058 server-side POST),
  `http` (we hand the URL to the client), `mailto` (a real outbound send). Chosen **by header, never
  by provider**.
- **Refusal** — a typed *value*, not an error. "We won't unsubscribe from this; block the sender
  instead" is a legitimate answer the card renders.
- **Starter filter** — a seeded, disabled `MailFilter` carrying a `templateKey`. Static and
  org-agnostic; the *other* producer (§3).

---

## 3. Two Producers, One Surface

Decision **S1**: mined suggestions and seeded starters are two producers that must not be fused.

| | Seeded starters | Mined suggestions |
| --- | --- | --- |
| Table | `MailFilter` with `templateKey` | `MailSuggestion` |
| Origin | `mail-filters/seed-suggested-filters.ts` at org seed | `jobs/maintenance/mail-suggestions-job.ts`, weekly |
| Content | static, org-agnostic, hand-written | evidence-carrying, per (inbox, group) |
| State | a real, **disabled** filter row | a proposal that has not created anything yet |
| Billing | excluded from `countBillableMailFilters` (`templateKey IS NOT NULL`) | not a filter at all until accepted |

They meet only at the end: accepting a mined suggestion creates an ordinary `MailFilter` through the
same mutation, and from that moment it is indistinguishable from a hand-authored one (except for
`MailSuggestion.acceptedFilterId`, which is plain text with **no FK** — deleting the filter must not
erase the record that we proposed it).

Both seeders and the miner share one non-negotiable rule: **only conditions the evaluator can
compile** (§8). `seed-suggested-filters.ts` reads the builder's dispatch table in its own test;
the miner validates at write time.

---

## 4. The `subjectKey` Keyspace

**Defined once**, in `packages/lib/src/mail-suggestions/client.ts`:

```ts
export const LIST_SUBJECT_PREFIX = 'list:'
export const DOMAIN_SUBJECT_PREFIX = 'domain:'
toSubjectKey(listId, senderDomain)   // listId wins whenever present
parseSubjectKey(key)                 // → { kind, value } | null
```

`packages/lib/src/mail-unsubscribe/client.ts` holds `toMailSubjectKey` / `parseMailSubjectKey`, which
are **shape adapters over those two functions, not a second implementation**. Say why out loud
because it is the kind of duplication a refactor invites: the mining job *mints* these keys and the
unsubscribe executor and its sweep *consume* them, so two copies that agree today drift the first
time either side gains a third prefix — and **the failure is silent**. A key the sweep cannot parse
counts no mail, and "no mail since" is exactly what the product reports as *"the sender honored your
unsubscribe."* Add a prefix in `mail-suggestions/client.ts`, never in the unsubscribe copy.

### Why two columns, not one fused key

`listId` and `senderDomain` stay two `Message` columns (S7 / invariant 8) because **the unsubscribe
safety gate has to tell a real mailing list from a domain heuristic** (§9.2). A fused key destroys
exactly that distinction.

### A domain group means `listId IS NULL AND senderDomain = d`

The miner groups on `COALESCE('list:' || m."listId", 'domain:' || m."senderDomain")`, so mail that
carries a list id belongs to **its own list group and never to the domain fallback**. Two places must
honor that or they describe different sets of mail:

- `mail-unsubscribe/subject-key.ts` — `buildSubjectKeyPredicate` compiles `domain:<d>` to
  `listId IS NULL AND senderDomain = d`, and **throws `BadRequestError` on an unparseable key**
  rather than degrading to "match nothing".
- `mail-suggestions/mine.ts` — `candidateConditions` appends a thread-level `list is empty` condition
  to every `senderDomain` / `from contains` proposal. Without it, accepting the card for
  `stripe.com`'s list-less receipts would also archive `news.stripe.com` — including a newsletter the
  user reads, whose `everReplied` and unread numbers were evaluated **per group** and never reached
  this card. Thread-level `list is empty` is the *narrowing* form, and narrowing is the safe
  direction.

A bare prefix (`list:` with no value) parses as `null`, not as an empty value — that guard is what
stops a malformed key compiling to `listId = ''`.

---

## 5. The Data Model

### `Message` — four derived columns
`packages/database/src/db/schema/message.ts`

| Column | Derived from | Notes |
| --- | --- | --- |
| `listId text` | `List-Id`, RFC 2919 normalized | The **stable** bulk identity — survives VERP and per-campaign from-addresses, which fragment any grouping keyed on the sender address. `ACME News <news.acme.com>` → `news.acme.com`. |
| `senderDomain text` | registrable domain (eTLD+1) of the From address via `tldts` | Fallback grouping, and independently useful as a filter field. |
| `unsubscribeMeta jsonb` | `List-Unsubscribe` + `List-Unsubscribe-Post` | `{ httpUrl?, mailto?, oneClick }`, parsed **once**, here. Never filtered on, so jsonb is right. |
| `senderAuthenticated boolean` | `Authentication-Results` | Tri-state. **NULL means unknown and every read must treat it as "not authenticated"** (§9.2). |

Indexes: partial `(organizationId, listId) WHERE listId IS NOT NULL` and
`(organizationId, senderDomain)` for the mining group-by, plus partial `(listId, threadId)` — that
third one exists because `condition-query-builder.ts` emits correlated `exists(...)` subqueries
against `Message`, and a `list is X` condition without `threadId` in the index degrades to a heap
lookup per candidate thread.

### `MailSuggestion`
`packages/database/src/db/schema/mail-suggestion.ts`

`organizationId` (cascade) · `inboxId` (FK → `EntityInstance`, cascade — a deleted inbox takes its
suggestions with it) · `userId` (set null) · `kind` · `subjectKey` · `evidence` jsonb ·
`proposedConditions` jsonb · `proposedActions` jsonb · `status` · `dismissedAt` · `acceptedAt` ·
`acceptedFilterId` (plain text, no FK) · timestamps.

**`userId` is the member the card is *for*.** Non-null for personal-inbox cards, because read rate is
per user: `ThreadReadStatus` is unique on `(threadId, userId)`, so a five-member shared mailbox has
five answers to "did anyone read this". Shared-inbox cards are org-level and carry `userId IS NULL`.

Unique `(organizationId, inboxId, userId, kind, subjectKey)` **`NULLS NOT DISTINCT`** — without that
modifier every weekly sweep would insert a fresh duplicate of every shared-inbox card, since
`NULL != NULL` under default semantics. Plus `(organizationId, inboxId, status)` for the list read
and `(createdAt)` for the retention sweep.

### `MailUnsubscribe`
Same file. `organizationId` · `inboxId` · `subjectKey` · `method` · `requestedByUserId` ·
`requestedAt` · `status` (`requested | confirmed | failed | ignored`) · `lastSeenAfterAt` ·
`messagesSeenAfter` · timestamps. Unique index on `(organizationId, inboxId, subjectKey)` —
**never unsubscribe twice from the same list**, as a database fact rather than a hope.

`lastSeenAfterAt` / `messagesSeenAfter` earn their place: they are what lets the product say
*"Stripe ignored your unsubscribe — 6 more since. Filter it?"* (§9.4).

### `MailSuggestionEvidence`
`packages/lib/src/mail-suggestions/types.ts`. Beyond the plan's eight fields it carries `listId`,
`senderDomain`, `senderAuthenticated`, `historyDays`, `filteredThreadCount`, and optional
`consistency` / `tagId` / `assigneeId`. The extras are not decoration: a `list:`/`domain:` key alone
does not tell the UI whether the group is a real mailing list (unsubscribable) or a domain guess, and
`mail-suggestion-content.tsx` renders the refusal *explanation* off exactly those fields — with no
query.

---

## 6. The Ingest Derive

`packages/lib/src/ingest/filtering/bulk-mail.ts` → `deriveBulkMailFields()`, called from
`ingest/store-message.ts` (~line 308) in the same block that already computed `detectMachineMail`,
so the four columns land in the same INSERT.

**Inbound only.** Outbound rows on this path are provider sync echoing our own sent mail, which has
no inbound list identity.

### Why this does not violate "the engine never runs inside ingest"

Mail-filters **invariant 13** forbids filter evaluation, filter actions, and new cache reads on the
`storeMessage` path. This derive is compatible because it is a **header derive, not rule
evaluation**: pure string parsing, no query, no `await`, no cache read, no user-authored code, and no
branching on org state. It also **never throws** — a malformed header yields all-nulls, in line with
the channels guide's "ingest must never throw". Anything that needs org state belongs after the
write.

### The header pickers

`BULK_MAIL_HEADER_ALLOWLIST = ['list-unsubscribe', 'list-unsubscribe-post', 'list-id',
'authentication-results']` with `pickBulkMailHeaders` beside it — the **fourth** picker over one
header list. It is deliberately *not* folded into `MACHINE_MAIL_HEADER_ALLOWLIST`, which is the
documented input contract of `detectMachineMail` and must not grow headers it does not read
(`threading-headers.ts:24`).

Providers that persist restricted headers call **`pickPersistedHeaders`**
(`ingest/filtering/persisted-headers.ts`), the merge of the machine-mail and bulk-mail pickers:
`providers/outlook/outlook-provider.ts:893` and `providers/imap/imap-message-parser.ts:47`. Gmail
needs no change — it persists the complete lowercased header map. Where the two allowlists overlap
(`list-id`, `list-unsubscribe`) both pickers resolve the same first-occurrence value, so merge order
is irrelevant.

First-occurrence-wins matters most for `authentication-results`: the topmost one is stamped by the
receiving MTA, the only hop we have any reason to trust.

### Parsing rules worth knowing

- **`listId`** — the angle-bracketed part when present (RFC 2919 puts the human description in
  front), lowercased. A bracket-less value is taken whole.
- **`unsubscribeMeta.oneClick`** — true only when an `httpUrl` exists **and**
  `List-Unsubscribe-Post` contains `list-unsubscribe=one-click`. The flag alone describes a POST with
  no endpoint to send it to.
- **`senderAuthenticated`** — `true` on `dmarc=pass`, or `dkim=pass` + `spf=pass`. `false` on an
  explicit fail. `null` for everything else (header absent, no recognizable method,
  `none`/`neutral`/`temperror`). **Pass is checked before fail**, because a DKIM-aligned DMARC pass
  legitimately sits next to `spf=fail` on forwarded mail — and that is a pass.

### Backfill

`DataMigration 073-backfill-bulk-mail-fields` re-derives the four columns from `metadata.headers` on
existing rows, keyset-paged at 500. Gmail history backfills all four; Outlook/IMAP history backfills
`listId`, `senderDomain` and `unsubscribeMeta.httpUrl`/`.mailto`, but **not** `oneClick` or
`senderAuthenticated` (those headers were not previously persisted). That is a graceful degrade, not
a hole: such a group falls to unsubscribe tier 2 (open the URL for the user) or is refused outright —
the conservative branch, and the reason the null must never be coerced to `true`.

---

## 7. The Mining Job

`packages/lib/src/mail-suggestions/mine.ts` — the whole analysis layer is one SQL statement plus one
pure function. **No rollup counters, no aggregate table** (S8). Personal-vs-shared is a *data*
question here (whose read state counts, whose `userId` the card carries), never an authorization one:
the job runs from a worker with no caller at all, and holds zero permission checks.

### One grouped statement per inbox

`buildInboxGroupQuery(params)` — exported specifically so a test can read the emitted SQL, because
the `MailFilterRun` exclusion is invisible to any assertion made on the returned rows alone. Four
CTEs: `per_thread` → `per_group` → `top_assignee` / `top_tag`. Scope: one inbox, inbound only,
`mergedIntoThreadId IS NULL`, `createdAt >= now − 90d`, and at least one of `listId`/`senderDomain`.

Three things in it are load-bearing rather than incidental:

1. **`per_thread` collapses to one row per thread before any rate is taken.** A newsletter thread with
   12 messages must count once toward `threadCount`; aggregating rates straight off `Message` would
   weight chatty threads into every ratio.
2. **`manual_archived` counts `archived AND NOT filtered`** — threads with a `MailFilterRun` are
   excluded. Without it the job proposes a filter to do what a filter is already doing, every week,
   forever.
3. **`bool_and(m."senderAuthenticated" IS TRUE)`, not `bool_or`.** NULL collapses to `false`, and
   requiring every message in the window to have passed is the conservative branch (§9.2).

`readerUserId` decides what "unread" means: a personal inbox passes its owner; a **shared inbox
passes `null`**, so unread means *no member has read it*.

### Thresholds

| Constant | Value | Meaning |
| --- | --- | --- |
| `SUGGESTION_WINDOW_DAYS` | 90 | the mining window (and the retention window for undecided cards) |
| `MIN_MESSAGES` / `MIN_THREADS` | 5 / 3 | volume floors — without them the first week of a new mailbox generates a wall of cards about mail that arrived twice |
| `MIN_HISTORY_DAYS` | 14 | span between the group's oldest and newest message *inside* the window |
| `UNREAD_RATE_THRESHOLD` | 0.8 | for `unsubscribe` |
| `MANUAL_ARCHIVE_RATE_THRESHOLD` | 0.8 | for `auto-archive` |
| `CONSISTENCY_THRESHOLD` | 0.8 | "the last N all got the same tag/assignee" |
| `ALREADY_FILTERED_RATE` | 0.5 | above this share, the group counts as already handled |
| `MAX_SUGGESTIONS_PER_INBOX` | 5 | the cap |
| `GROUP_SCAN_LIMIT` | 200 | groups pulled back per inbox — bounds memory, not behavior |

`ALREADY_FILTERED_RATE` is a **rate, not "any run at all"**: one unrelated filter firing once on one
of forty threads does not mean the group is handled, and treating it that way would silently blind
the miner to whole senders.

### The four suppression rules

`buildMailSuggestionDrafts` is pure — no database, no clock beyond the group's own timestamps — so
every boundary is unit-testable. In application order:

1. **`everReplied` ⇒ nothing, ever, for that `subjectKey`.** A human replied once; that is not noise,
   and no volume of unread mail afterwards makes it noise. *The single most important rule in the
   feature.*
2. **Already decided ⇒ nothing.** `listSuppressedSubjectKeys` returns both `dismissed` (the user said
   no) and `accepted` (a filter already exists) keys for the inbox.
3. **Already covered by a filter ⇒ nothing**, at `filteredThreadCount / threadCount ≥ 0.5`.
4. **Cap at five per inbox, ranked by `messageCount × unreadRate`.** An inbox-hygiene feature that
   presents forty cards is itself inbox clutter.

Ties break on `messageCount`, then `subjectKey`, then `kind`, so a rerun over unchanged data produces
the same five cards rather than a shuffle.

> **Known consequence of the ranking, stated plainly.** The cap ranks on
> `messageCount × unreadRate`. An `auto-tag` or `auto-assign` group is by definition mail somebody
> *is* handling, so its unread rate is near zero and its score is near zero — those kinds lose the
> cap to any unread-heavy group in the same inbox. That is the accepted trade (the unread pile is the
> louder problem), but it means "auto-assign suggestions never appear" is expected behavior on a busy
> mailbox, not a bug in the consistency thresholds.

### Which kinds a group produces

- `unsubscribe` — `unreadRate ≥ 0.8` **and** a resolvable method **and** the safety gate passes
  (`listId !== null || senderAuthenticated`).
- `auto-archive` — otherwise, when `unreadRate ≥ 0.8` **or** `manualArchiveRate ≥ 0.8`. This is both
  the ordinary archive-by-hand proposal *and* the "offer block/filter instead" branch for a group we
  refuse to unsubscribe from. One card per group either way.
- `auto-tag` / `auto-assign` — a dominant tag/assignee at `≥ 0.8` consistency. Additive: a group can
  carry an archive card *and* a tag card.
- `route-inbox` — reserved by the schema and the type union, **never produced**: there is no "this
  should have gone to the other mailbox" signal in the grouped query.

`proposedActionsFor` maps `unsubscribe` and `auto-archive` to the same
`[suppress-automations, set-status: ARCHIVED]` pair — **the unsubscribe is not in there**, and never
will be (§9.1). Every action set is then run through `assertFilterShape`, the same validator the
tRPC create path uses, and a card whose actions would not be saveable is skipped rather than written.

### Writing and reconciling

- `upsertMailSuggestion` — `ON CONFLICT … DO UPDATE` on the five-column unique key, with
  **`setWhere: status = 'new'`**. A decided row survives the rerun untouched; resurrecting a
  dismissed card is exactly what invariant 7 forbids. The miner also skips those keys up front — this
  is the belt to that braces, for the race where a user dismisses while the sweep is running.
- `pruneStaleMailSuggestions` — deletes the inbox's `new` cards this sweep did **not** re-propose.
  This is what makes the five-per-inbox cap hold **across runs**: capping the drafts alone would let
  week 1's five and week 2's different five accumulate into ten. It also retires a card whose group
  fell back under threshold. `userId IS NOT DISTINCT FROM` rather than `=`, because shared-inbox rows
  carry NULL.
- `sweepStaleMailSuggestions` (`retention.ts`) — deletes `status = 'new'` rows older than 90 days, in
  5000-row batches. **Only `new` rows.** An "expire everything older than 90 days" sweep would
  quietly re-enable every suggestion the org has ever refused.

One inbox's failure never stops the org, and one org's never stops the run: mining is advisory.

---

## 8. ⚠️ The Compile Gate

**This is the single most dangerous property in the feature. Read it before touching
`candidateConditions` or `resolveProposedConditions`.**

`buildConditionGroupsQuery` **drops a condition it cannot dispatch, silently**. When *every*
condition drops, the compiled clause reduces to the bare org scope —
`organizationId = $1 AND mergedIntoThreadId IS NULL` — which means the filter matches **every thread
in the inbox** and acts on all of them. This is mail-filters **invariant 19**, discovered in
production terms as "`Body starts with X` + `set-status: SPAM` + also-apply-to-existing = up to 5000
threads marked spam".

Mail filters fixed it in two layers: the router rejects a save whose conditions produce
`droppedConditions` (`assertFilterConditionsCompile`), and `buildFilterPredicate` AND-s `false` onto
a fully-dropped filter at run time so a pre-existing bad row cannot fire.

**A mined suggestion needs a third layer, at a different time.** `mine.ts`:

```ts
export function resolveProposedConditions(group, organizationId): ConditionGroup[] | null {
  for (const candidate of candidateConditions(group)) {
    try { assertFilterConditionsCompile(candidate, organizationId); return candidate }
    catch (error) { logger.warn('Skipping mail-suggestion condition candidate that does not compile', …) }
  }
  return null            // ← no candidate compiled ⇒ NO CARD IS WRITTEN
}
```

Validating **when the job writes the row** rather than when the user clicks is the difference between
*"we never offered it"* and *"we offered you a rule that archives your entire mailbox"*. Without it
the best case is a card that errors the moment anyone clicks Accept (the router would reject the
save); the worst case is any future path that trusts `proposedConditions` without re-checking.

Candidates are tried in preference order, narrowest-and-most-stable first:

1. `list is <listId>` — the stable identity that survives VERP.
2. `senderDomain is <domain>` **+ `list is empty`** (§4).
3. `from contains @<domain>` **+ `list is empty`** — the substring match that existed before the two
   columns landed.

Only fields the catalog actually offers are considered (`getMailFilterFields()`); the compile check is
what makes that safe rather than merely tidy. Both `list` and `senderDomain` are `FieldType.TEXT` in
`MAIL_VIEW_FIELD_DEFINITIONS`, which advertises the **complete** string operator set, and
`buildMessageTextColumnQuery` (`mail-query/condition-query-builder.ts`) handles **every one of
them** — `is`, `is not`, `contains`, `not contains`, `starts with`, `ends with`, `in`, `not in`,
`empty`, `not empty`. A gap between the two sets is not a missing feature; it is invariant 19 again.
`mail-query/__tests__/condition-query-builder.test.ts` pins the parity.

Equality lowercases the needle and compares with `=` rather than `ILIKE` — the stored value is
already normalized at ingest, and `=` is what lets the partial `(listId, threadId)` index serve the
subquery. `empty` / `not empty` are about the **thread**: "not empty" means at least one of its
messages carries a value.

**Never call the non-diagnostic builder variant from a path that mutates.** That rule generalizes
past mail filters to any future consumer of conditions.

---

## 9. Unsubscribe

`packages/lib/src/mail-unsubscribe/`. Entry point: `executeUnsubscribe(db, input)`.

### 9.1 It is a one-shot command, never a `MailFilterAction`

Decision **S2** / invariant 1. An `{ type: 'unsubscribe' }` arm in the action union would fire an
outbound POST to a third party **on every future match**. This is a user-initiated operation against
a *list*. Nothing in `mail-unsubscribe/` is reachable from the filter engine, and a PR adding that
arm must be rejected.

The pairing is handled at the *suggestion* level instead (**S10**): an unsubscribe card's accept path
runs the unsubscribe **and** creates the ordinary archive filter — one click, two effects. Senders
take days to honor a request and some never do; the filter is the half that works immediately, and it
still runs when the unsubscribe was refused (`use-mail-suggestion-actions.ts`).

### 9.2 The safety gate

`selectUnsubscribeMethod` in `mail-unsubscribe/client.ts` — the gate first, then the tier:

```
  !listId && senderAuthenticated !== true  →  REFUSE ('unverified-sender', alternative: 'block-sender')
  !unsubscribeMeta                         →  REFUSE ('no-unsubscribe-method')
```

**`senderAuthenticated === null` counts as NOT authenticated.** The absence of an
`Authentication-Results` header is not a pass, and coercing the unknown to one is how you end up
POSTing to a spammer's confirmation endpoint. Acting on an unverified sender's unsubscribe confirms a
live address to whoever sent it — for that mail, *block sender / filter to spam* is the better answer
anyway.

A refusal is an **outcome, not an error**: `ExecuteUnsubscribeOutcome` carries
`{ status: 'refused', refusal }` with copy the card renders verbatim, so the UI shows the alternative
rather than a failure toast.

### 9.3 Three tiers, chosen by header, never by provider

| `unsubscribeMeta` | Tier | What we do |
| --- | --- | --- |
| `oneClick: true` **and** `httpUrl` (RFC 8058) | `one-click` | POST `List-Unsubscribe=One-Click`, server-side. |
| `httpUrl` only | `http` | **We POST nothing.** The URL comes back as `openUrl` and the *client* opens it in a new tab. |
| `mailto:` only | `mailto` | A real outbound send from that mailbox's own channel. |

`one-click` requires **both** the flag and a URL. Never POST a URL without the one-click header: a
bare GET target is usually a confirmation page, and POSTing an arbitrary URL on a user's behalf is not
ours to do.

**Tier 1 hardening** (`one-click-post.ts`) — this is the only place in the product that makes an
outbound HTTP request to an address a stranger put in an email header, so the hardening is the point,
not decoration: HTTPS only; `redirect: 'manual'` with each hop re-validated by us and capped at 3
(the runtime's own follower would happily walk `https://` into `http://` or into
`http://169.254.169.254/…`); no cookies, no credentials, no referrer; private/loopback/link-local/
CGNAT/multicast hosts refused; 8s timeout; response drained to at most 64 KB and discarded. DNS is
deliberately **not** resolved, so a name that resolves to a private address still gets through —
accepted, because the request carries no secret, its body is a fixed constant, and the response is
discarded. Egress filtering is the right layer for the rest.

**Tier 3** (`mailto-send.ts`) composes a `SendMessageInput` and hands it to the existing
`MessageSenderService` — deliberately **no new send path**, so the send inherits the usage guard, the
automated-send breaker, the suppression list, provider capability validation, reconciliation and the
`Message` row. `resolveInboxSendChannel` prefers the channel the mail **arrived** on (replying from
the mailbox the list has on file is what makes the unsubscribe recognizable) and requires
`Integration.deletedAt IS NULL` — disconnect is a soft delete, and without that clause a disconnected
channel is a live send target that fails at the provider. `parseUnsubscribeMailto` **refuses**
CR/LF-bearing addresses rather than sanitizing them; a sanitized value is a value we changed silently.
`MessageSenderService` is imported dynamically because it drags the composer, reconciler, thread
manager and provider registry behind it, and this module sits on the tRPC router's import path.

### 9.4 Order of operations, and the record

`executeUnsubscribe` is ordered deliberately:

1. **Already unsubscribed?** Short-circuit to `already-requested`. The unique index is the race-safe
   floor; checking first is what stops us POSTing a third party twice.
2. **Resolve the target** — `resolveUnsubscribeTarget` reads the **newest** inbound message in the
   group (headers change over a campaign's life, and the freshest `List-Unsubscribe` is likeliest to
   still resolve), joins `Thread` for the inbox scope (`Message` carries no `inboxId`) and
   left-joins `Participant` for the CRM contact. Then run the gate.
3. **Execute the tier.**
4. **Write the `MailUnsubscribe` row**, then the signal, then the audit.

The row is written **after** the tier runs, so a failed POST leaves no record claiming we
unsubscribed. The `http` tier is the exception worth naming: it is recorded at the moment we hand the
URL over, because we will never learn whether the user completed it, and a row that only appeared on
success would never appear at all.

**The signal — invariant 2.** `unsubscribe-signal.ts` records
`kind: 'mail:unsubscribed_from'`, registered in `signals/types.ts` with `timeline: 'always'`,
`rollup: 'none'`, `highVolume: false`. It must **never** be recorded as `contact:unsubscribed`: that
kind means *they* unsubscribed from *us*, and `signals/unsubscribe.ts` upserts an org-wide
**suppression** row on it — reusing it would silence our own outbound mail to that address, a silent
and hard-to-trace deliverability bug. `rollup: 'none'` exists precisely so this kind cannot move
`unsubscribedAt` even by accident. `dedupeKey` mirrors the `MailUnsubscribe` unique key
(`mail-unsub:<inboxId>:<subjectKey>`), so a retry re-runs harmlessly instead of stacking timeline
rows. No contact ⇒ no signal, which is normal.

**The audit — invariant 11.** Shared inboxes only (`recordAudit`, category `integrations`, action
`inbox.unsubscribed_from_list`). A shared unsubscribe stops the mail for every colleague using that
inbox, none of whom saw the dialog, so it needs a name attached. A personal inbox affects exactly the
person who clicked, and auditing that would be noise. Best-effort — a failed audit must not turn a
successful operation into an error the user retries.

### 9.5 The "did they actually stop?" sweep

`sweep.ts` + `jobs/maintenance/mail-unsubscribe-sweep-job.ts`, daily.

`countMessagesSinceUnsubscribe` counts inbound mail matching the same `buildSubjectKeyPredicate`
(§4) that the offer used, arriving after `requestedAt`, in that inbox. **Absolute, recounted over the
whole window every pass**, so a retry or an overlapping run converges instead of double-counting.

`resolveSweepUpdate` flips `status → 'ignored'` only when **both** hold:

- ≥ `UNSUBSCRIBE_IGNORED_AFTER_DAYS` (14) since `requestedAt` — senders take days, and flipping
  earlier would call normal latency a broken promise;
- **at least one message actually arrived since** — silence past the deadline is the sender *honoring*
  us, and marking that `ignored` would be exactly backwards.

Only `requested` flips; `confirmed`/`failed`/`ignored` are left alone. It returns `null` when nothing
moved, so the job writes only changed rows. One row's failure (an unparseable key, a transient read
error) is logged and skipped — losing the whole nightly pass to one bad row is the worse outcome. The
row set is tiny by construction: at most one per `(inbox, list)`.

---

## 10. Permissions

Both lib modules hold **zero** permission checks by house rule, so
`apps/web/src/server/api/routers/mail-suggestions.ts` is **the only authorization path for the whole
feature**. Three separate authorities meet there and must not be conflated:

| Operation | Gate |
| --- | --- |
| seeing a card | `loadMailSuggestionScope` → `canUnsubscribeOnInbox` per inbox, applied **in SQL** as `inboxIds` |
| unsubscribing | `assertCanUnsubscribe` — inbox write, and **nothing else** |
| accepting (⇒ creates a filter) | `assertCanAuthorMailFilters` — the ordinary filter-authoring gate |

### Unsubscribe: inbox write only, deliberately not `automationRules.manage`

`mail-unsubscribe/unsubscribe-authority.ts`:

```
  personal_inbox owned by the caller  →  allowed. NO permission key.
  shared inbox (`inbox` def)          →  capabilities.canEditInstance('inbox', id), and nothing else.
```

This diverges from filter authoring **on purpose**. Unsubscribing is a mail operation, not an
automation one; requiring an automation grant to stop a newsletter would gate mail on admin rank,
which the mail guide forbids (mail-filters invariant 7). Per-inbox authority is the whole model here.

The personal branch keys on the inbox's **definition** — def membership is the unforgeable half of
the mail model. The legacy `isPersonal` marker is honored only to *remove* the shared branch, never to
grant the personal one: personal-ness can be self-declared into a stricter rule, never forged into a
laxer one. Same shape as `canAuthorOnInbox` in `mail-filter-authoring-access.ts`.

> ⚠️ **Live wrinkle.** `INSTANCE_ACCESS_RESOURCES.inbox` declares
> `none < metadata < identity < read < admin` with **no `edit` rung**, and `canEditInstance` asks for
> `>= edit` on the ordinal ladder — so on an inbox today the only rung that satisfies it is **`admin`**.
> That is stricter than the design intends. The code deliberately writes the *threshold*
> (`canEditInstance`) rather than `canAdminInstance`, so inserting an `edit` rung into the mail ladder
> **moves** this gate instead of silently leaving it at admin. Same wrinkle, same reasoning, as
> mail-filters §12.4 item 4.

`unsubscribe-authority.ts` lives in lib as an exception justified in its own file header: it is a
**pure predicate** with no session, no cache and no I/O, and nothing else in lib calls it. If it ever
needs a DB or cache read, it belongs in `apps/web/src/server/lib/` beside
`mail-filter-authoring-access.ts`.

### Accepting is a prefill, never an authorization path

`accept` does **not** write a filter itself. It calls `mailFiltersRouter.createCaller(ctx).create(…)`
so the authorship branch, the keyed-action rule, the `move-inbox` destination check,
`assertFilterConditionsCompile` and both plan limits all run exactly as they do for a hand-authored
filter. It *also* asserts `assertCanAuthorMailFilters` up front, so the refusal happens before
anything else runs and a future change to how the filter is created cannot quietly drop the gate.
A second create path in this router is precisely the bug invariant 10 describes.

`matchCount` rides on the accept response so the caller can ask *"also apply to N existing
conversations?"* as a follow-up confirm rather than opening the full filter dialog. It is a **lower
bound** — the preview evaluates under the requesting user's viewer while the engine fires as SYSTEM —
so the copy says "at least".

### Visibility

Card visibility uses `canUnsubscribeOnInbox`, not a reading lens:

- Personal-inbox cards are their **owner's alone**; `isMailAdmin` confers no override, consistent with
  the rest of the mail model.
- The filter-authoring set is a strict **subset** of this one (authoring wants `automationRules.manage`
  *and* inbox write; unsubscribing wants inbox write alone), so scoping visibility this way can never
  hide a card its viewer could have accepted — while a mere *reader* of a shared inbox, who could act
  on nothing, is not shown an action prompt they cannot answer.

One computation, four consumers (`list`, `count`, `dismiss`, `unsubscribe`), so the badge, the cards
and the mutations cannot drift. Scoping is applied **in SQL** (`opts.inboxIds`), never fetch-then-
filter — a post-read `.filter()` still discloses counts and timing. An **empty** `inboxIds` array
means *nothing*, never *everything*; `listMailSuggestions` fails closed on it too. A card on an inbox
the caller cannot see reads as **404, not 403**: someone else's personal-mailbox card must not be
distinguishable from a card that does not exist.

---

## 11. The Surfaces

> The UI shipped alongside the lib layer and is described here from the code as it stands. It was
> still uncommitted at the time of writing, so treat the *contract* below as authoritative and the
> exact markup as subject to change.

### 11.1 Mail toolbar — a doorway, not a list

`apps/web/src/components/mail-suggestions/ui/mail-suggestions-toolbar-button.tsx`, mounted in
`app/(protected)/app/mail/_components/mail-box.tsx` immediately after the `Split`/`List` `RadioTab`.

It renders **no list of its own** — it calls `openApprovals()` on the notification-panel store, the
same deep link kbar and notification rows already use. One surface renders suggestion rows; two
places drawing the same cards is how the two get different answers.

Two hard rules, both the feature's own premise applied to its own affordance:

1. **Hidden entirely at zero.** An inbox-hygiene feature that adds permanent chrome to the mail
   toolbar has failed at its only job.
2. **Never rendered beside `MailFilterRetroactivePrompt`**, which mounts just below the same toolbar.
   The button reads `api.mailFilters.pendingRetroactivePrompt` (the same cached query the prompt
   itself uses, so it costs no extra round trip) and stands down while it is showing. The retroactive
   prompt wins: it is time-boxed and asks about the mail on screen, while this is a standing doorway
   that will still be there tomorrow.

The badge counts `status: 'new'` cards the caller may act on, via `mailSuggestions.count` — the same
scope and the same default status as `list`, because a badge counting a different set than the surface
renders is a bug, not a tuning knob.

### 11.2 Notification panel → Approvals tab → a fourth section

`apps/web/src/components/global/notifications/ui/approvals-tab.tsx` gains a fourth labelled section,
**last**, with `MailSuggestionRow` beside `ConfirmationRow` / `AccessRequestRow` / `SuggestionRow`.

Two properties of that tab's architecture are load-bearing here:

- **It reads source tables and never mints `Notification` rows** (`plans/today/02-approvals-tab.md`
  §2 — a notification per bundle was rejected because it creates two lifecycles over one thing).
  `MailSuggestion` is a source table, so it drops straight in. **Do not mint notifications.**
- **Sections split by urgency.** Mail suggestions sort last because they are the least urgent source
  in the panel: an unanswered workflow confirmation blocks a live run and expires; an unanswered mail
  suggestion costs nothing.

Unlike the other three sources this section does **not** paginate — it renders the whole list, because
the miner already capped it at five per inbox. Counts feed the existing bell badge through
`useApprovalsCount`; there is no second badge source. Mail suggestions are **not** gated on
`FeatureKey.todayInbox`, which gates the AI-suggestions section only — different feature, different
audience.

### 11.3 Thread chip

`mail-suggestions/ui/thread-mail-suggestion-chip.tsx`, mounted in `components/mail/thread-header.tsx`.
Higher conversion because it appears at the moment of annoyance, which is why it is gated hard —
and every gate is **inherited, not restated**:

- It renders only when the mining job already wrote a card whose `evidence.sampleThreadIds` contains
  this thread, so every threshold and suppression rule applies by construction.
- One chip per thread; **unsubscribe wins** when a group carries several cards.
- Dismiss writes the source row's status — the same permanent suppression the panel performs, not a
  local "hide for now".

It reads the same cached list the badge already fetched, so a chip costs no extra query.

### 11.4 Shared card copy

`mail-suggestions/ui/mail-suggestion-content.tsx` holds what must be identical in the panel and on the
chip: the evidence sentence (`describeMailSuggestion`), the refusal explanation, and
`mailSuggestionButtonSpec`. The chrome differs; the sentence must not. Every string is built from the
row's denormalized `evidence` — **no query, ever**. That is the entire reason `evidence` exists.

The card never offers what the router would refuse: the filter half disappears without
`canAuthorFilter`, and the unsubscribe half only exists on a card the miner already cleared through
the safety gate (`canUnsubscribe` is simply `kind === 'unsubscribe'`). `unsubscribeRefusalReason`
restates the gate for the *explanation* only — the executor re-runs the real gate against the freshest
message on every attempt.

Client imports go through `@auxx/lib/mail-suggestions/client`, which has **no `'use client'`
directive** on purpose: server code imports the same file (the miner mints every `subjectKey` through
`toSubjectKey`), and the directive would turn every export into a client-reference proxy there.

---

## 12. Jobs & Schedules

| Job | Schedule | Does |
| --- | --- | --- |
| `mailSuggestionsJob` | **Mondays 05:10** (`10 5 * * 1`) | mine every org → every inbox, then the retention sweep in the same tick |
| `mailUnsubscribeSweepJob` | **daily 05:40** (`40 5 * * *`) | recount mail since each open unsubscribe; flip `ignored` past the deadline |

Both registered in `apps/worker/src/workers/worker-definitions/maintenance-worker.ts` and scheduled in
`apps/worker/src/workers/index.ts`, clear of the 03:00/03:45/04:10/04:25 slots.

Mining is **weekly, not nightly**: the evidence is a 90-day aggregate, so a daily rerun would burn one
grouped query per inbox to move numbers that barely changed. The sweep is **daily, not weekly**:
"they ignored you" is only useful while the annoyance is current.

The mining job takes an optional `organizationId` (superadmin / manual trigger), `batchSize`, and
`skipRetention`. The inbox list comes from the **`inboxes` org-cache key** (both defs, merged) rather
than a fresh join, reached through a lazy `await import('../cache')` for the same reason
`mail-filters/cache.ts` does it: the barrel drags the workflow-app cache — and therefore the workflow
engine — into every importer's graph.

---

## 13. Where the Code Diverged From the Plan

`plans/mail-filter/03-suggestions-plan.md` is a historical document. Verified deltas:

| Plan said | Shipped | Why it matters |
| --- | --- | --- |
| §5.3 r2: a `subjectKey` "already covered by an enabled filter" produces nothing | a **rate**, `ALREADY_FILTERED_RATE = 0.5` | one unrelated filter firing once on one of forty threads must not blind the miner to a whole sender |
| §5.3 r3: **dismissed** keys never return | `dismissed` **and `accepted`** | re-proposing an accepted group asks the user to rebuild what they built |
| §5.2: `manualArchiveRate ≥ 0.8` for auto-archive | `auto-archive` fires on `unreadRate ≥ 0.8` **OR** `manualArchiveRate ≥ 0.8` | it doubles as the "we refuse to unsubscribe — archive instead" branch of §6.2 |
| §4: evidence is eight fields | plus `listId`, `senderDomain`, `senderAuthenticated`, `historyDays`, `filteredThreadCount`, `consistency?`, `tagId?`, `assigneeId?` | the card explains the refusal without a query |
| §4: accept "opens the normal filter dialog prefilled" | one click through `mailFilters.create` via a server-side caller (revised §8.4 / S10) | the dialog version was superseded before implementation |
| §2.2: wire `pickBulkMailHeaders` into Outlook and IMAP directly | a merged **`pickPersistedHeaders`** (machine-mail + bulk-mail) that the two providers call | one call site per provider, and the two allowlists stay separate contracts |
| §5.1: group key `coalesce(listId, 'domain:' || senderDomain)` | `COALESCE('list:' || listId, 'domain:' || senderDomain)` | both halves carry their prefix, matching `toSubjectKey` exactly |
| — (not in the plan) | `pruneStaleMailSuggestions` | the 5-per-inbox cap has to hold **across runs**, not just within one |
| §5.1: "one grouped query per inbox" | one **statement** with four CTEs, including a `FieldValue`/`CustomField` join for the dominant tag | still one round trip; the tag half was not in the plan's sketch |
| §8.2: sections "paginate independently" | the mail section renders its whole list | the miner already caps at five per inbox |
| §8.3: thread chip is phase E, later | shipped now | — |
| §9 phase D: `route-inbox` as a kind | reserved in the schema and the union, **never produced** | no "should have gone elsewhere" signal exists in the grouped query |

**Open gaps in the shipped code**, worth knowing before you extend it:

1. **`MailUnsubscribe.status` never becomes `confirmed` or `failed`.** `executeUnsubscribe` logs a
   non-2xx one-click response and still writes `requested`; `setMailUnsubscribeStatus` exists but no
   caller invokes it. So today only `requested` → `ignored` (by the sweep) is reachable. Wire the POST
   result through if you need the distinction — the sweep's `OPEN_STATUSES` already accounts for both.
2. **`@auxx/lib/mail-unsubscribe/client` is not an exports subpath** (lib exports are codegen from
   consumer imports). Client code therefore cannot import `selectUnsubscribeMethod`, which is why
   `mail-suggestion-content.tsx` restates the refusal reason. If a client consumer ever needs the real
   gate, add the import and regenerate — do not hand-edit `packages/lib/package.json`.
3. **The router's docstring cites `mail-suggestions.test.ts`; that file does not exist yet.** Lib-side
   tests are thorough (`mine*.test.ts`, `mutations.test.ts`, `retention.test.ts`, and seven files in
   `mail-unsubscribe/`), but the only authorization path in the feature is currently unpinned. Write
   the router test before changing anything in §10.
4. **The mining window uses `Message.createdAt` (ingest time) while the sweep counts on
   `receivedAt`.** For a freshly backfilled mailbox the 90-day evidence window is ingest-relative, not
   send-relative.

---

## 14. Gotchas & Invariants

1. **`proposedConditions` must compile, and it is checked when the JOB WRITES THE ROW.** An
   all-dropped condition set reduces to the bare org scope and matches every thread in the inbox.
   Never call the non-diagnostic condition builder from a path that mutates. (§8)
2. **Unsubscribe is never a `MailFilterAction`.** A PR adding `{ type: 'unsubscribe' }` to the union
   fires an outbound POST on every future match and must be rejected.
3. **Never record our outbound unsubscribe as `contact:unsubscribed`** — that kind upserts an org-wide
   suppression and would silence our own mail to that address. Use `mail:unsubscribed_from`
   (`rollup: 'none'`).
4. **`senderAuthenticated IS NULL` means "not authenticated".** In SQL that is
   `bool_and(x IS TRUE)`; in TS it is `senderAuthenticated !== true`.
5. **No `listId` + not authenticated ⇒ offer block/filter to spam, never unsubscribe.**
6. **One reply ever ⇒ no suggestion for that `subjectKey`, permanently.** The most important rule in
   the feature.
7. **Dismissal is a row, not a delete.** Dismissed (and accepted) rows *are* the suppression list;
   retention sweeps `new` rows only.
8. **Keep `listId` and `senderDomain` two columns**, and keep `subjectKey` two prefixes. The safety
   gate depends on telling a real list from a domain guess.
9. **The keyspace is defined once**, in `mail-suggestions/client.ts`. `mail-unsubscribe/client.ts`
   adapts shapes over it. Two copies drift, and the failure is silent — the sweep would report every
   sender as honoring an unsubscribe they ignored.
10. **A `domain:` group means `listId IS NULL AND senderDomain = d`.** Every predicate and every
    proposed condition set must carry the `list is empty` half, or it acts on strictly more mail than
    the evidence was computed from.
11. **The ingest derive stays a pure header parse** — no query, no await, no cache read, no org
    branching, and it never throws. Anything else belongs after the write (mail-filters invariant 13).
12. **The suggestion is a prefill, never an authorization path.** Accept runs the ordinary
    filter-authoring gate, by calling the ordinary mutation.
13. **Unsubscribe needs inbox write only — never `automationRules.manage`.** And note that inbox write
    resolves to `admin` today because the mail ladder has no `edit` rung (§10).
14. **Personal-inbox cards are their owner's alone; `isMailAdmin` confers no override.** Scope in SQL;
    an empty allow-list means nothing, not everything. Invisible ⇒ 404, not 403.
15. **Shared-inbox unsubscribe states its blast radius and writes an audit row.** It affects
    colleagues who never saw the dialog.
16. **`setWhere: status = 'new'` on the upsert, and `NULLS NOT DISTINCT` on the unique key.** Drop
    either and the weekly sweep resurrects decided cards or duplicates shared-inbox ones.
17. **Prune `new` cards the sweep did not re-propose**, or the five-per-inbox cap only holds within a
    single run.
18. **Cap the cards at five per inbox.** An inbox-hygiene feature that clutters the inbox has failed
    at its only job — and the same applies to its own affordance: the toolbar button is hidden at
    zero and stands down for the retroactive prompt.
19. **The Approvals tab reads source tables. Do not mint `Notification` rows.**
20. **Everything a card renders comes from `evidence`.** Adding a display field means adding it to the
    jsonb the miner writes, not a lookup in the renderer.
21. **`mail-suggestions/client.ts` and `mail-unsubscribe/client.ts` carry no `'use client'`
    directive** — server code imports both, and the directive would turn every export into a proxy
    stub there.
22. **Both lib modules hold zero permission checks.** `apps/web/src/server/api/routers/
    mail-suggestions.ts` is the only gate. `unsubscribe-authority.ts` lives in lib only because it is
    a pure predicate that nothing in lib calls.

---

## 15. Key Files

**Mining** — `packages/lib/src/mail-suggestions/`: `mine.ts` (the grouped query, thresholds,
suppression rules, the compile gate), `mutations.ts` (upsert / prune / dismiss / mark-accepted),
`queries.ts` (list, get, `listSuppressedSubjectKeys`), `retention.ts`, `types.ts`, `client.ts`
(**the `subjectKey` keyspace**), `index.ts`. Tests: `mine.test.ts`, `mine-conditions.test.ts`,
`mine-sweep.test.ts`, `mutations.test.ts`, `retention.test.ts`.

**Unsubscribe** — `packages/lib/src/mail-unsubscribe/`: `client.ts` (tiers + **the safety gate**),
`execute-unsubscribe.ts`, `one-click-post.ts` (tier 1 + SSRF hardening), `mailto-send.ts` (tier 3),
`subject-key.ts` (the one `subjectKey` → `Message` predicate), `sweep.ts`, `unsubscribe-authority.ts`
(the §10 predicate the **router** calls), `unsubscribe-signal.ts`, `unsubscribe-queries.ts`,
`unsubscribe-mutations.ts`, `guard.ts`, `types.ts`.

**Ingest** — `packages/lib/src/ingest/filtering/bulk-mail.ts`,
`packages/lib/src/ingest/filtering/persisted-headers.ts`, the derive call in
`packages/lib/src/ingest/store-message.ts`, and the two restricted-header providers
(`providers/outlook/outlook-provider.ts`, `providers/imap/imap-message-parser.ts`).

**Jobs** — `packages/lib/src/jobs/maintenance/mail-suggestions-job.ts`,
`packages/lib/src/jobs/maintenance/mail-unsubscribe-sweep-job.ts`,
`apps/worker/src/workers/worker-definitions/maintenance-worker.ts`,
`apps/worker/src/workers/index.ts`.

**Filter interop** — `packages/lib/src/mail-filters/evaluate.ts`
(`assertFilterConditionsCompile`, `buildFilterPredicate`), `mail-filters/mutations.ts`
(`assertFilterShape`), `mail-filters/seed-suggested-filters.ts` (the *other* producer),
`packages/lib/src/mail-query/condition-query-builder.ts` (`list` / `senderDomain` cases),
`packages/lib/src/mail-views/mail-view-field-definitions.ts` (the two field definitions).

**API & UI** — `apps/web/src/server/api/routers/mail-suggestions.ts` (**the only gate**),
`apps/web/src/components/mail-suggestions/` (`hooks/use-mail-suggestions.ts`,
`hooks/use-mail-suggestion-actions.ts`, `ui/mail-suggestions-toolbar-button.tsx`,
`ui/mail-suggestion-content.tsx`, `ui/thread-mail-suggestion-chip.tsx`),
`apps/web/src/components/global/notifications/ui/approvals-tab.tsx` +
`ui/items/mail-suggestion-row.tsx` + `hooks/use-approvals-count.ts`,
`apps/web/src/app/(protected)/app/mail/_components/mail-box.tsx`,
`apps/web/src/components/mail/thread-header.tsx`.

**Schema & migrations** — `packages/database/src/db/schema/mail-suggestion.ts`,
`packages/database/src/db/schema/message.ts` (the four columns + three indexes),
`packages/database/drizzle/0325_mail_bulk_sender_and_suggestions.sql`,
`packages/lib/src/data-migrations/migrations/073-backfill-bulk-mail-fields.ts`,
`packages/lib/src/signals/types.ts` (`mail:unsubscribed_from`).
