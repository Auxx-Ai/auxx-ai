<!-- docs/duplicate-detection-architecture-guide.md -->

# Duplicate Detection Architecture Guide

**Last Updated:** 2026-08-17
**Scope:** *"These two records look like the same person."* How a background scanner finds pairs of
`EntityInstance` rows that are probably one entity, why it uses the signals it does, how a pair is
scored, stored, banded, surfaced for review, and how it dies — by dismissal, by merge, or by
deletion.

> This is the living reference for `packages/lib/src/dedup` + `packages/lib/src/jobs/dedup` and the
> surfaces over them. The design history lives in `plans/records/duplicate-suggestion-plan-v2.md`,
> which is **not tracked in git** — this file is the durable half. **Where the plan and the code
> disagree, the code is the truth.**
> Companions: `entity-architecture-guide.md` (definitions, fields, `FieldValue`, the lookup core),
> `entity-events-architecture-guide.md` §8 (the sync-change manifest this feature consumes),
> `today-architecture-guide.md` (the Approvals tab this feature adds a section to),
> `lib-module-guide.md` (the module shape: functional Drizzle + `neverthrow`, zero access checks).

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Core Concepts & Vocabulary](#2-core-concepts--vocabulary)
3. [The Genesis Map — where duplicates actually come from](#3-the-genesis-map--where-duplicates-actually-come-from)
4. [Name Matching](#4-name-matching)
5. [The Data Model](#5-the-data-model)
6. [The Engine](#6-the-engine)
7. [The Scan Job](#7-the-scan-job)
8. [Triggers — the four doors](#8-triggers--the-four-doors)
9. [Lifecycle — how a pair dies](#9-lifecycle--how-a-pair-dies)
10. [Reading, Permissions & Clusters](#10-reading-permissions--clusters)
11. [The Surfaces](#11-the-surfaces)
12. [Accepted Tradeoffs & Known Limits](#12-accepted-tradeoffs--known-limits)
13. [The Integration Seam](#13-the-integration-seam)
14. [Gotchas & Invariants](#14-gotchas--invariants)
15. [Key Files](#15-key-files)

---

## 1. Executive Overview

One background job (`duplicateScanJob`) walks records that have changed since their last scan,
blocks each one against the rest of its definition through **two independent arms**, scores the
resulting candidate pairs, and writes `DuplicateSuggestion` rows. Nothing merges automatically —
every row is a suggestion a human accepts, dismisses, or snoozes.

```
  WRITE                      SCAN (one job, three scopes)                 SURFACE
 ─────────────────   ────────────────────────────────────────────   ──────────────────────
  interactive CRUD      watermark: dirty records of one definition      Approvals tab §5
    ↓ mutation seam       ↓                                               → DuplicateRow
  connector / import    ┌─ exact arm ──────────────────────┐             record header
    ↓ sync manifest     │  deriveMatchKeys → blockRecord   │               → DuplicateIndicatorButton
  6h sweep              │  (email, phone, unique,          ├─ merge on ──▶ MergeDialog
    ↓ no scope          │   company_domain, RecordIdentity)│   canonical    (best-established first)
                        ├─ name arm ───────────────────────┤   key
  connector ambiguity   │  blockFuzzyRecord (trigram)      │      ↓
    → direct emit       │  + blockSurnameRecord (exact)    │   scorePair → band
                        │  → readStructuredNames           │      ↓
                        │  → evaluateFuzzyPair             │   upsertPairs
                        │     (compare → corroborate →     │      ↓
                        │      decideNameSignal)           │   rescoreOpenPairsForRecord
                        └──────────────────────────────────┘      ↓
                                                              stamp lastDuplicateScanAt
```

Four properties make this harder than "group by email":

1. **The exact arm is mostly a backfill and enforcement-leak detector, not a live-duplicate
   catcher.** Contact email is enforced org-wide at every `FieldValueService` door, so an exact-email
   hit means one of four leaks happened. What an org generates *day to day* — the email↔phone twin,
   the work-address / personal-address pair — has **no shared exact key and no corroboration
   available**. That is what the name arm exists for (§3).
2. **Trigram cannot rank names.** `john smith` / `jane smith` (different people) measures higher than
   every true nickname pair, because the surname carries the score. Trigram is a *blocker only*;
   discrimination is a structured given/surname comparator, and a nickname dictionary is the only
   mechanism that can recover `bob`/`robert` at all (§4).
3. **A false positive here merges two real people, irreversibly.** This product serves businesses
   whose contact books are full of households. The surname-rarity condition (§4.3) is what keeps a
   family from being proposed as duplicates of itself.
4. **Everything is suggestion-only, and the store's unit is the PAIR.** Clustering happens at read,
   so dismissing one pair never invalidates its neighbours.

The feature is gated on `FeatureKey.duplicateDetection`, seeded `false` on every tier
(`packages/seed/src/domains/billing.domain.ts`) and therefore dark on merge — except self-hosted,
where `isSelfHosted()` short-circuits every feature check platform-wide. There is **no admin off
switch**: a plan feature key is a billing gate. If noise ever needs suppressing, the right mechanism
is an org setting (precedent: `settings['company.autoCreate']`), not a feature key.

---

## 2. Core Concepts & Vocabulary

- **Pair** — one `DuplicateSuggestion` row: two `EntityInstance` ids in the same definition, in
  **canonical order** (`instanceIdLow` < `instanceIdHigh` by string comparison). The stored unit.
- **Cluster** — a connected component over open pairs, computed **at read** by union-find. The
  reviewer's unit. One row in the queue = one cluster.
- **Signal** — one piece of evidence (`packages/lib/src/dedup/types.ts`). Carries `type`,
  `strength`, and **the matched VALUE**, not just the field — multi-value identity fields make
  "matched on: email" ambiguous otherwise.
- **Strength** — `strong` (sufficient for `high` unaided) | `fuzzy` (only the name signal) |
  `corroborating` (never sufficient alone, ever).
- **Band** — `high` (a strong exact key matched) | `medium` (the name-alone rule, or name +
  corroboration). There is deliberately no `low`: a pair we would not ask a human to look at is a
  pair we do not store.
- **Match key** — a field the exact arm blocks on: `EMAIL`/`PHONE_INTL` by type, anything carrying
  `capabilities.unique`, or a systemAttribute promoted in `STRONG_KEY_SYSTEM_ATTRIBUTES`
  (`company_domain`).
- **Blocking** — candidate *generation*. Three exact passes (`blockRecord`, `blockOrgKey`,
  `blockIdentity`) and two name passes (`blockFuzzyRecord`, `blockSurnameRecord`).
- **Watermark** — `EntityInstance.lastDuplicateScanAt`, compared against
  `GREATEST(ei."updatedAt", max(fv."updatedAt"))`. The dirty predicate every scan door runs.
- **Snoozed** — **not** a status. It is `open` plus a future `snoozeUntil`, so the pair returns to
  the queue on its own with no sweep to un-snooze it.
- **Arm** — one of the two independent candidate pipelines inside `scanRecord`: the *exact* arm and
  the *name* (fuzzy) arm. They merge onto the canonical key **before** scoring.

---

## 3. The Genesis Map — where duplicates actually come from

This section is the analytical core. It explains why the feature is shaped as it is, and it is the
first thing to re-read before changing signal selection or thresholds.

### 3.1 The write-time checks that exist

There are eight places this system resolves or blocks a duplicate. **All eight are at write time,
all eight are exact-match on a single key, and none is fuzzy** — which is why post-hoc detection is
worth building, and also why the duplicates it produces are predictable rather than random.

| # | Site | When | Key(s) | On miss |
| --- | --- | --- | --- | --- |
| 1 | `checkUniqueValueTyped` (`field-value-mutations.ts:360,450,595,1550,1892`) | write, blocking | one field, per value | 409 |
| 2 | `checkEmailUniqueness` pre-hook (`resources/hooks/contact-hooks.ts:79`, wired `:159`) | write, blocking | `primary_email` | 409 |
| 3 | Ingest contact resolve (`ingest/contacts/find-or-create.ts:89-95`) | write, match-or-create | `primary_email` **XOR** `phone` | creates |
| 4 | Ingest company auto-link (`ingest/companies/find-or-create.ts:21`) | write, match-or-create | `company_domain`, exact string | creates |
| 5 | Connector `resolveIdentity` (`data-connectors/sinks/entity-sink.ts:230`) | sync, match-or-create | mapped candidates, `limit: 6` | creates |
| 6 | Connector reuse-read + slice dedupe (`entity-sink.ts`) | sync | `(connector, def, externalId)` | creates |
| 7 | Import `findExistingRecord` (`import/planning/find-existing-record.ts`) | plan, match-or-create | ONE identifier field | creates |
| 8 | Extension/API `find-by-value` (`apps/api/src/routes/entities/find-by-value.ts:73`) | on demand | one field, `limit: 1` | returns null |

### 3.2 The generators, and which arm catches each

| Generator | Mechanism | Caught by |
| --- | --- | --- |
| **G1. Email↔phone twins** | A `Participant` carries exactly ONE `identifier` + `identifierType` (`schema/participant.ts:26-27`). Ingest picks one system attribute from it and never checks the other — there is no second value to check. A customer who emails and later texts becomes two contacts, **deterministically**. | **the name arm only** |
| **G2. Anonymous chat visitors** | `isChatVisitor` short-circuits to a bare `create` — the identifier is an opaque cookie cuid with no addressable dedupe key. An *identified* visitor does converge (`find-or-create-from-jwt.ts` runs `RecordIdentity` → `primary_email` → create), so the class is only visitors on a `visitors`-audience widget or with no JWT. | the name arm, when a name exists at all |
| **G3. Non-dialable phone participants** | SMS short codes / alphanumeric sender IDs set `systemAttr = null` → bare create. | nothing (and mostly shouldn't be — these are rarely people) |
| **G4. Connector ambiguity swallow** | `resolveIdentity` fetches several matches; on `>1` it takes the first and proceeds. The loser is a silent duplicate no later scan is guaranteed to find, because neither record need ever go dirty again. | **the sink capture** (`emitPairsFromIdentityMatch`) — the cheapest true positive in the feature |
| **G5. Company domain-shape collisions** | Auto-create matches `company_domain` by exact string. `acme.com` vs `www.acme.com`, or a manual "Acme Inc" whose domain is blank, never match. `company_domain` is enforced **nowhere**. | exact arm (promoted strong key) |
| **G6. Per-connection `RecordIdentity`** | `RecordIdentity_identity_key` COALESCEs `connectionId` (`schema/record-identity.ts:115-121`), so the same customer under two connections is legitimately two identity rows → two records. | exact arm, `blockIdentity` — the only pass that finds it |
| **G7. Documented races** | Reuse-read is best-effort with no lock; the uniqueness gate is check-then-write with no DB constraint. | exact arm |
| **G8. Import backlog** | ONE identifier field per import; a row matching on a *different* field becomes a new record. Plus every duplicate email row predating the org-wide email uniqueness migration. | exact arm |

### 3.3 The honest conclusion

**(a) The exact arm is a backfill and enforcement-leak detector.** It cleans up G4–G8: the import
backlog, the pre-uniqueness email rows, connector ambiguity, cross-connection identities. That is
real value and worth shipping. But it does not surface what an org generates today.

Contact email *is* unique now — `primaryEmail` carries `capabilities.unique` and every
`FieldValueService` door enforces it org-wide, per-value, archived-excluded, with intra-batch claim
tracking. So an exact-email hit means one of exactly four things: a row predating the uniqueness
migration, an archived-excluded match (the gate excludes archived; dedup blocking does not), the
still-absent DB constraint losing a check-then-write race, or a writer that did not funnel through
`FieldValueService`. A hit is worth surfacing *precisely because* one of those happened.

The steady exact producers are the two keys nothing enforces: **company `domain`** (no `unique`
capability anywhere — the field description claiming "Unique per organization" is simply wrong) and
**contact `phone`**, which is deliberately never unique because households and companies share a
line and arming the gate would 409 ordinary ingest writes.

**(b) The highest-volume live generators produce pairs with no shared exact key AND no
corroboration.** The phone-born twin never gets an employer (`linkContactToCompanyByDomain` returns
early unless the identifier is an email), usually has no address, and SMS often carries no name at
all. The same is true of the work-address / personal-address duplicate: two contacts, two different
domains, nothing in common but the human.

**So the name arm is what catches what happens next**, and a blanket "name alone never suggests"
rule would refuse to surface exactly the class users care about most. That is the entire reason §4
exists.

---

## 4. Name Matching

### 4.1 Why trigram cannot rank names

Measured on the dev database with `pg_trgm` at the default 0.3 threshold, over full `displayName`
— which is what a naive fuzzy arm would score on:

| Pair | Same person? | `similarity()` |
| --- | --- | --- |
| `john smith` / `jane smith` | **NO — siblings/spouses** | **0.4666667** |
| `william klooth` / `bill klooth` | yes | 0.4210526 |
| `bob smith` / `robert smith` | yes | 0.3529412 |
| `peggy klooth` / `margaret klooth` | yes | 0.3181818 |

**A different person scores higher than every true nickname pair.** The score is carried almost
entirely by the shared surname, so ranking by it puts the worst false positives at the top of the
review queue. This is not a threshold to tune — it is the wrong measurement.

Given names alone are worse than useless:

| Given names | `similarity()` |
| --- | --- |
| `william` / `bill` | 0.08 |
| `john` / `jane` (different people) | 0.11 |
| `bob` / `robert` | **0.00** |
| `peggy` / `margaret` | **0.00** |

`bob`/`robert` and `peggy`/`margaret` share **zero trigrams**. The relation is lexical convention,
not spelling, so **no string metric can ever recover it and no threshold can be tuned into it**.

Surnames behave fine — `klooth`/`klooth` = 1.0, `klooth`/`kloth` = 0.625 — so typo tolerance on the
*surname* is the one thing trigram is genuinely good for here.

Three rules follow, and all three are enforced by module structure rather than by discipline:

1. **Trigram is a BLOCKER, never a scorer.** `FuzzyCandidate` (`blocking-fuzzy.ts:41`) has **no
   similarity field**, deliberately, so the number cannot be persisted into a `Signal` or reach
   `scorePair` even by accident. It orders the blocking query and is then discarded.
2. **Score on structured names, not `displayName`.** Contacts carry separate `first_name` /
   `last_name` `CustomField` rows; comparing the concatenation throws away exactly the structure
   that makes the decision.
3. **Ship a nickname dictionary.** `nicknames.json` + `nicknames.ts` is the *only* mechanism that
   recovers Peggy/Margaret. "A nickname table is out of scope because trigram won't catch it" is
   exactly backwards: trigram not catching it is the argument **for** the table.

### 4.2 The structured comparator

`compareStructuredNames` (`name-match.ts:163`) runs two different comparators over two different
parts, then retries once with the second record's parts swapped (CSV imports and several locales
put the family name first). The reversed attempt only runs when the direct one failed, so a genuine
direct match is never relabelled.

- **Surname** → exact after `normalizeSurname` (NFD, diacritics dropped, non-letters to a single
  space), else `pg_trgm` similarity ≥ `SURNAME_TRIGRAM_THRESHOLD` (0.6 — a *typo* threshold, tuned
  so `klooth`/`kloth` at 0.625 passes). A **missing surname is never a match**: treating blanks as
  equal would pair every surname-less record in the definition.
- **Given name** → `givenNameEquivalence` (`nicknames.ts:181`), five arms in decreasing confidence:
  `exact`, `nickname` (canonical-set intersection), `initial` (`W.`/`William`), `prefix` (≥3 chars,
  `jon`/`jonathan`), `fuzzy` (edit distance ≤ 1, **same first letter**, longer name ≥ 5 chars).

`trigramSimilarity` is reimplemented in JS (`name-match.ts:106`) rather than called through SQL,
because the comparison happens per candidate pair inside a job that already has both names in
memory. It is pinned by test to reproduce Postgres exactly (`klooth`/`kloth` = 0.625,
`john smith`/`jane smith` = 0.4666667, `bob`/`robert` = 0).

Two guards in the dictionary are load-bearing rather than tidiness:

- **`MIN_FUZZY_LENGTH = 5` and the first-letter check.** Short names are where edit distance goes
  wrong: `bob`/`rob`, `dan`/`don`, `jon`/`ron` are all distance 1 and all different people; without
  the first-letter guard, `kevin`/`devin` and `jenny`/`kenny` are too.
- **Four exclusion classes in `nicknames.json`** (documented in `nicknames.ts`): cross-language
  cognates (`sean`/`juan` are not nicknames for `john`), hypocorisms that became standalone names
  (`liam`/`william` is far more likely father-and-son than one duplicated contact), regional slang,
  and surnames that look like variants. **The list is deliberately not padded to hit a size
  target** — a wrong equivalence merges two different people.

Ambiguity is modelled rather than avoided: `bert` legitimately resolves to albert, gilbert, herbert,
robert and roberta, so equivalence is **set intersection** — `bert`/`robert` matches while
`albert`/`robert` does not.

### 4.3 The name-alone rule, and why surname rarity exists

`decideNameSignal` (`name-match.ts:221`) emits a `name` signal when the names match **and** either
the surname is rare in this org, **or** at least one corroborating signal is present. Spelled out,
the three conditions are:

- **(a)** surnames match exactly or within a typo (trigram ≥ 0.6 on the surname alone), **and**
- **(b)** given names are equivalent under exact / nickname / initial / prefix / edit-distance-≤1,
  **and**
- **(c)** the surname is **rare in this org** — inverse document frequency over the surname field
  within the definition (`surnameIdf`) — *or* corroboration substitutes for (c).

`Bill Klooth` / `William Klooth` passes (a), (b) and (c) → medium on name alone.
`John Smith` / `Jane Smith` fails (b) *and* (c) → nothing.
`Bob Smith` / `Robert Smith` passes (a) and (b), fails (c), and reaches medium **only** through
corroboration.

**Why condition (c) exists, and why it is the most important paragraph in this document.**

Auxx serves Shopify businesses, whose contact books are full of **households** — several people
sharing a surname and an address, differing only in given name. Without condition (c), every such
household is proposed as a pile of duplicates of itself, and a user who accepted one would
**irreversibly merge two real family members into one record**. Rarity is what separates *"one
human entered twice"* from *"a family"*.

This also means the rule not firing is often the rule working. A surname concentrated in one org —
the maintainer's own surname in the dev org, for instance — correctly produces **nothing** on name
alone. Use a genuinely rare surname for fixtures, never a name the seed data is full of.

`surnameIdf` (`surname-rarity.ts:184`) is the **only place inverse frequency is used in this
feature**. An earlier proposal to replace the role-email denylist and the block cap with
Fellegi–Sunter style inverse-frequency weighting on every key was rejected: that solves a
*precision* problem the denylist and cap already handle, while this feature's real difficulty is
*recall*. Surname rarity is the one job where inverse frequency is decisive.

Rarity uses **two bounds, because either one alone breaks**: a surname is rare when it is held by no
more than `max(SURNAME_RARE_MIN_COUNT = 3, ceil(total × SURNAME_RARE_MAX_SHARE = 0.002))` live
records. A pure share test needs 500 contacts before any surname can clear it, so young orgs would
never see the rule fire; a pure count floor stops firing past a few thousand records, where most
surnames appear more than three times.

Three details worth knowing:

- **`count === 0` is treated as unknown, not as maximally rare.** A surname the corpus has never
  seen is a caller passing a value that was never persisted.
- **A definition with no surname field fails closed** (`rare: false`), because it cannot satisfy
  condition (a) either.
- **`unaccent` is not installed**, so the SQL normalization keeps diacritics while the JS side folds
  them. `Müller` and `Muller` count as two surnames, which makes each look marginally *rarer*.
  Bounded, and accepted over adding an extension.

### 4.4 Two blocking passes, not one

The name arm generates candidates from **two** sources, and both are needed:

- **`blockFuzzyRecord`** — trigram neighbours off `EntityInstance_org_displayName_trgm_idx` (and
  `..._secondaryDisplayValue_trgm_idx`), via the shared `recordSearchPredicate` /
  `recordSearchNameScore` builders. Its `%`-operator arm is what makes those indexes usable at all;
  an operator-free `similarity(...) > 0.3` inside an `OR` block forfeits them (measured: 125 ms vs
  32 ms over a 100k-row slice). This is what catches a **misspelled** surname.
- **`blockSurnameRecord`** — an exact match on the *surname field*, normalized with
  `NORMALIZED_SURNAME_SQL`, the same expression `surnameIdf` counts with. This is what catches a
  **nickname behind a common surname**.

The second pass is not redundant. The trigram pass orders by similarity to the whole anchor string
and truncates, so on a common surname the true same-surname candidates compete with — and lose to —
neighbours that merely look alike. Measured on dev: across 19 Smiths, `Bob Smith` did not have
`Robert Smith` among its top neighbours. **Corroboration cannot rescue a pair the blocker never
generated**, so that case was unreachable. Raising `FUZZY_BLOCK_LIMIT` from 5 to 20 was not enough
on its own; the exact-surname pass (`SURNAME_ANCHOR_LIMIT = 50`) is what carries it.

Fixing recall here rather than by loosening the name rule is deliberate: precision on
`John Smith` / `Jane Smith` must not move.

A known recall limit remains, and it is measured: the shared predicate's fuzzy arm clamps at 0.3.
`peggy klooth` / `margaret klooth` scores 0.318 and is found; `peggy lee` / `margaret lee` scores
0.21 and is not, because a short surname cannot carry a nickname pair over the threshold. The
`surname` anchor on `FuzzyBlockAnchors` exists to put the whole burden on the part that actually
matches, and `blockSurnameRecord` closes the rest.

---

## 5. The Data Model

### `DuplicateSuggestion` — `packages/database/src/db/schema/duplicate-suggestion.ts`

One row per canonically-ordered pair.

| Column | Notes |
| --- | --- |
| `organizationId`, `entityDefinitionId` | both sides always share a definition — the engine never pairs across defs. The def id is denormalized so the queue can filter by type without joining either instance |
| `instanceIdLow`, `instanceIdHigh` | **canonical order is a storage invariant**, enforced by `upsertPairs`, not a display preference |
| `score` | `doublePrecision`, clamped `[0,1]`. **Never a raw trigram similarity** |
| `band` | `'high'` \| `'medium'` |
| `signals` | `Signal[]` jsonb — the evidence, each entry carrying the matched value |
| `status` | `'open'` \| `'dismissed'` \| `'merged'` |
| `dismissedByUserId`, `dismissedAt`, `dismissedBand` | `dismissedBand` is what makes reopen-on-upgrade safe |
| `snoozeUntil` | snoozed = `open` + future timestamp. **Not a status** |

Indexes: `DuplicateSuggestion_org_def_pair_key` (unique, the upsert target and the reason `(A,B)`
and `(B,A)` collapse); `DuplicateSuggestion_org_status_score_idx` (the queue, keyset-paged);
`_org_low_idx` / `_org_high_idx` (per-record reads — two indexes, because canonical ordering means a
record can sit on either side and every reader has to `OR` both columns).

FK `onDelete: 'cascade'` on both instance columns is a **backstop, not the working mechanism**: in
this product "delete" is a soft archive, so the cascade essentially never fires for real records
(§9).

### The watermark — `EntityInstance.lastDuplicateScanAt`

Compared against `GREATEST(ei."updatedAt", COALESCE(max(fv."updatedAt"), ei."updatedAt"))` through a
`LEFT JOIN LATERAL`. **`FieldValue.updatedAt` is the only timestamp that always moves**: a connector
sync or CSV import writing with `skipEvents` leaves both `EntityInstance.updatedAt` *and*
`lastActivityAt` untouched (`touchEntityActivity` never runs, and the post-hook gate needs a
`userId`).

`EntityInstance_org_def_dup_scan_idx` (`schema/entity-instance.ts:187-194`) is keyed on
`(organizationId, entityDefinitionId, updatedAt, lastDuplicateScanAt)` and is **partial**
(`WHERE "archivedAt" IS NULL`). It mirrors the suggestion-scan index but on `updatedAt` rather than
`lastActivityAt` — mirroring the latter literally would have produced an index that never serves the
dedup predicate.

---

## 6. The Engine

`packages/lib/src/dedup/` — functional Drizzle + `neverthrow`, `db` first, reads and writes in
separate files, **zero permission checks**. The scan runs as system: it never passes a `scopeWhere`
to the lookup core, because a job has no viewer. Scope lands in `queries.ts` on the read path.

### 6.1 Match keys — `match-keys.ts`

`deriveMatchKeys(fields, config?)` reads nothing; the caller passes what it already has from
`getCachedResourceFields`, so scanning N records costs one cache read.

Three independent reasons a field qualifies:

1. **Field type** — `EMAIL`, `PHONE_INTL`.
2. **`isUnique` / `capabilities.unique`** — a near-free safety net. Still check-then-write with no DB
   constraint, still only covers rows written after the flag was set, still per-field. The block
   usually finds nothing; a hit is an enforcement leak.
3. **`systemAttribute` promotion** — `STRONG_KEY_SYSTEM_ATTRIBUTES` = `['company_domain']`. It is a
   plain TEXT field with no `unique` capability, so rules 1 and 2 would both skip the single
   highest-yield company signal.

Two traps the module handles explicitly:

- **`fieldType` must be folded through `toFieldType`.** The pg enum still carries the legacy `PHONE`
  spelling alongside `PHONE_INTL`; without folding, phone blocking silently disarms on every legacy
  field.
- **Only `valueText` / `valueNumber` are blockable.** A field whose value lands in `optionId`,
  `relatedEntityId` or `valueJson` holds an id or a blob; "the same value" is not a question the
  blocking query can ask. Those fields are **skipped explicitly**, not half-supported.

`multi` (from `options.multi`) is what tells blocking to fan out; `maxValues` comes from the shared
`MAX_MULTI_VALUES` in `field-values/primary-value.ts` and is never redeclared.

### 6.2 Exact blocking — `blocking.ts`

**`blockRecord`** — one lookup-core call **per VALUE, not per field**. A contact with three emails
and two phones issues five calls and can therefore match on any alias, primary or not.

This is the one place the implementation deliberately diverges from the obvious design. Sending all
values as five `LookupCandidate`s in one call does not work, for two independent reasons both
visible in `lookup-entities-by-field-value.ts`: the core **deduplicates hits across candidates by
recordId** and lets the earliest-priority candidate win attribution, so a record matching on BOTH an
email and a phone comes back attributed to the email alone — losing exactly the corroboration a pair
most needs; and `limit` is a **single budget shared by all candidates**, making a per-value block cap
unenforceable. One indexed call per value keeps both properties exact, at the cost of a handful of
extra round-trips in a background job.

Guards, in the order they bite:

- **Empty / blank values are skipped**, always. `''` and NULL block against every other blank cell in
  the org and would pair the whole definition.
- **Over-cap values are discarded whole.** The lookup asks for `cap + 2` so an over-cap value is
  *detected* rather than silently truncated. A shared reception line or a placeholder domain would
  otherwise produce O(n²) rows of noise.
- **Role addresses need a second signal.** A candidate whose ONLY evidence is `info@`-style
  (`ROLE_EMAIL_LOCALS`, ~45 entries) is dropped: that is one mailbox, not one person.
- **Gmail folding is a SECOND LOOKUP, never a rewrite.** `foldGmailAddress` strips dots and `+tags`
  and collapses `googlemail.com`. Folding our own value changes nothing against an exact-equality
  blocker unless the other side is queried too, and the folded form is **never written back** — the
  address the user typed is the address we display and send to.

**`blockOrgKey`** — org-wide sweep for one key: `GROUP BY` the typed value column with the cap in
`HAVING`, served by `FieldValue_lookup_text_idx`. Cheaper than N per-record lookups once a
definition's dirty set is large, and the only way a backfill finds pairs where **neither** side is
dirty. Naturally per-value already (multi-value fields store one row per value). Role addresses are
dropped outright here rather than deferred, because a group produces exactly one signal per pair and
so can never acquire the second signal the guard demands. Note the asymmetry with `blockRecord`:
`GROUP BY valueText` cannot Gmail-fold at all.

**`blockIdentity`** — `RecordIdentity` grouped by `(source, appFieldKey, externalId)`. Note the kind
column is **`appFieldKey`** (e.g. `'customerId'`), not `kind`, and `connectionId` is deliberately
**not** in the grouping — collapsing across connections is the entire point (genesis G6).

### 6.3 Corroboration — `corroborate.ts`

Five corroborators, cheapest first. A corroborating signal **never suggests on its own**, whatever
the arithmetic would say; what it does is promote a name match whose surname is too common to stand
alone.

1. **Same employer** — equal `relatedEntityId` on a shared RELATIONSHIP field. The signal names the
   shared *record*, not its id.
2. **Same address** — equal normalized `valueText` on an ADDRESS field. Deliberately not a postal
   normalizer: no abbreviation expansion, no locale rules. It is worth 0.2 and must never claim a
   match it cannot justify.
3. **Complementary identities** — `RecordIdentity` rows from *different* sources, i.e. two systems
   each know one of the two records. Complementarity, not overlap; a shared externalId under two
   connections is a different, STRONG fact and is `blockIdentity`'s job.
4. **Email domain ↔ employer domain** — one record's email domain equals the other's employer's
   `company_domain`. Domain extraction reuses `classifyForCompany` from `ingest/domain/classifier.ts`
   — the same function `linkContactToCompanyByDomain` uses — and is never re-implemented: it already
   handles eTLD+1, free-provider domains, excluded TLDs and the org's own domains.
5. **Same ingest event** — both records' `firstInteractionAt` on the same second. ⚠️ Measured on dev,
   the busiest second is shared by 11 records, because one thread's participants genuinely do share a
   first-message time. That *is* the signal, but it makes this the loosest of the five — which is
   why it is corroborating and can never move a pair on its own.

`evaluateFuzzyPair` composes the whole name arm for one pair, and the order is not incidental:

1. **Compare names first, and bail if they do not match** — corroboration alone can never suggest, so
   running its five queries for a non-match is pure cost.
2. **Corroborate, then decide** — `decideNameSignal` needs to know whether corroboration exists
   before it can apply the name-alone rule.
3. **Return nothing when the name signal is withheld** — a pair carrying only corroborating signals
   is one `scorePair` gates to zero anyway.

### 6.4 Scoring — `scoring.ts`

`scoreSignals` is a weighted sum over **distinct signal types**, clamped to 1. Distinct *types*, not
distinct signals: two shared email addresses are one fact about the pair, and letting the same
evidence stack would let a multi-value field manufacture confidence out of one match.

Weights (`config.ts`): strong keys `email`/`phone`/`unique`/`identity` = 0.9; `name` = 0.5;
corroborators = 0.2. Bands: `high ≥ 0.9`, `medium ≥ 0.5`. Calibrated so **any single strong signal
clears `high` unaided** and **a bare name match lands exactly on the medium floor**.

Three properties hold this together, each load-bearing:

1. **Strength is read, not just type.** `identity` is worth 0.9 when it means "the same external id
   under two connections" and 0.2 when it means "these two records came from different systems".
   Weighing by type alone would let the second push a pair to `high` on its own.
2. **Corroboration alone scores ZERO.** Not "a little" — zero. `if (anchored.size === 0) return 0`.
3. **Corroboration is capped** at `MAX_CORROBORATION_SCORE = 0.3`. Without the cap, a name match
   (0.5) plus shared employer, shared address, complementary identities and a same-second
   `firstInteractionAt` sums to 1.3 → clamped to 1 → `high`. Two contacts at the same company, the
   same address and the same ingest event are exactly the shape of two **real colleagues**, so that
   is the wrong direction to fail in. Capped, a name-only pair tops out at 0.8 — comfortably
   `medium`, with `high` reserved for exact keys.

🔴 **The name rule is not implemented in `scorePair`, and must never be.** Whether a `name` signal is
warranted at all is decided by `decideNameSignal` *before the signal is constructed*. That keeps
"medium" a statement about evidence rather than a threshold to tune around, and it is why
`bob smith`/`robert smith` and `bill klooth`/`william klooth` can land in different places while
producing the same shape of pair in the scorer.

`toCandidatePair` flips self-oriented signals onto the canonical low/high axis. Blocking emits
`value` = the *scanned* record's value; storage wants `value` = the *low* record's value.

---

## 7. The Scan Job

`packages/lib/src/jobs/dedup/duplicate-scan-job.ts`. **One job, three scopes**, resolved from the
job data — there is no `mode` field, because the three doors differ only in what they know:

| Job data | Scope | Notes |
| --- | --- | --- |
| `recordIds` present | exactly those records | the sync-manifest door; ids carry their definition. Org/def/archived guards still apply, so a manifest cannot steer the scan at another org's rows |
| `organizationId` + `entityDefinitionId` | the watermark query for that definition | the coalesced mutation-seam door |
| neither | walk feature-enabled orgs × allowlisted definitions | the 6h sweep; the only path that runs the org-level passes unconditionally |

`dryRun` blocks, scores and logs but writes no pairs and stamps no watermark.

**The job never throws.** A scan failure must not fail whatever enqueued it, and a per-record failure
is logged and skipped so one garbage row cannot take down the tick.

### 7.1 Per definition

`getDedupConfig(entityType)` resolves the per-type config, checking the **denylist before the
allowlist** so a denied type can never be scanned even if someone adds it to the allowlist by
mistake. v1 allowlist: `['contact', 'company']`. Denylist: `['user', 'thread', 'entity_group',
'inbox', 'personal_inbox']` — not user-mergeable records, and it ships now so the eventual flip to a
derived default cannot forget it. Org-created definitions carry a NULL `entityType` and are never
scanned in v1.

Per-definition state is resolved **once**, not per record: `deriveCorroborationFields`,
`resolveNameFieldIds`, and a surname→rarity memo (`buildFuzzyContext`). A definition with no
surname system attribute — companies — resolves to `null` and skips the name arm entirely. There is
no `firstName`/`lastName` on a company to compare.

⚠️ **`keys.length === 0` short-circuits the whole definition**, including the name arm. A contact
definition with no email, phone, unique or promoted field gets no name matching either. That
coupling is not obviously intended; see §12.

### 7.2 Per record — both arms, merged before scoring

```
exact:  deriveMatchKeys → blockRecord                        → toCandidatePair ┐
name:   blockFuzzyRecord + blockSurnameRecord (in parallel)                    ├→ mergeCandidatePairs
        → readStructuredNames → evaluateFuzzyPair                              ┘
                → scorePair → upsertPairs → rescoreOpenPairsForRecord → stampWatermark
```

🔴 **The two arms MERGE onto the canonical key before scoring, and that is not cosmetic.**
`upsertPairs` dedupes by the conflict key and keeps the last writer, so a pair found by both arms
would be stored with whichever arm happened to be scored last — a `high` exact pair **silently
rewritten as `medium`**. Merging the signal sets first also produces the richer "matched on:" chips
a reviewer actually wants: an email match AND a name match on one card, not one of the two.

The dirty-record projection carries `displayName` and `secondaryDisplayValue`, so the fuzzy anchors
cost no extra read. `readStructuredNames` runs once for the whole candidate set, not per candidate.
Surname rarity is memoized per definition scan, keyed on the *scanned* record's surname — condition
(a) already requires the two surnames to be equal or within a typo.

### 7.3 The watermark stamp

`stampWatermark` is raw SQL touching exactly one column. Historically this was load-bearing:
`EntityInstance.updatedAt` carried `$onUpdate`, so a Drizzle `.update().set({ lastDuplicateScanAt })`
bumped `updatedAt` **in the same statement**, instantly re-dirtying the record against its own fresh
watermark — and the scanner re-scanned it forever. Since D-7 removed `$onUpdate` (content changes now
stamp `updatedAt` explicitly), bookkeeping writes like the watermark stamp no longer move `updatedAt`
and cannot re-dirty the record; the raw single-column statement remains fine and is still pinned by
integration test, but it is no longer the only safe shape.

⚠️ **Stamp the OBSERVED watermark, not `now()`.** The dirty select returns
`GREATEST(ei."updatedAt", max(fv."updatedAt"))` and that value is written back, bound as **text** so
nothing re-interprets a `timestamp without time zone` in the session timezone. Stamping `now()` would
swallow any `FieldValue` write that lands mid-scan; stamping the observed value leaves such a record
dirty for the next tick. Free correctness.

⚠️ **`archivedAt IS NULL` is not optional** on the dirty query. The dup-scan index is partial; without
the matching predicate the planner cannot use it and this degrades to a full scan of the org's
records.

### 7.4 Org passes and continuation

`runOrgPasses` (`blockOrgKey` per key + one `blockIdentity` pass) runs when a definition's dirty set
reaches `ORG_PASS_DIRTY_THRESHOLD = 50`, or unconditionally on the sweep. It only **upserts** —
rescoring stays a per-record responsibility, because only the scanned record has a complete fresh
pair set. The org passes are exact-only; there is no org-level name pass.

`RECORDS_PER_DEFINITION = 500` bounds a tick. The watermark query is oldest-dirty-first, so in a
definition with a larger backlog a freshly created record sorts **last** and would wait for the next
write or the 6h sweep. The handler therefore requeues itself through
`enqueueDuplicateScanContinuation`, and the backlog drains in bounded chunks.

🔴 **The continuation uses a DIFFERENT jobId, and the cursor is part of it.** The org+def jobId is
held by the job that is currently *running* — BullMQ drops a same-jobId `add` in that state, so
reusing it would make the requeue a silent no-op. The continuation jobId is keyed on the watermark
the tick stopped at, which makes each continuation distinct while still collapsing a redundant re-add
at the same position.

---

## 8. Triggers — the four doors

There is **one** handler; four doors reach it, and the only thing that distinguishes them is the
jobId and the delay.

| Door | Enqueue | Coalescing |
| --- | --- | --- |
| Interactive create/update (`unified-handler-mutations.ts:450`, `:559`) | `enqueueDuplicateScan(orgId, defId)` fire-and-forget inside the existing `if (!options.skipEvents)` blocks | jobId `dup-scan:{orgId}:{defId}` + 45 s delay — a burst collapses into ONE delayed job |
| Ingest-created contacts (mail/chat `findOrCreate`, which fires events) | the same seam, the same jobId | a first-connect mailbox sync creating hundreds of contacts still yields ONE job |
| Connector runs + CSV imports (`skipEvents` — the seam never fires) | `handleSyncDuplicateScan` on `sync:records:changed`, with the manifest's `recordIds` | jobId `dup-scan:{runId\|importRef}`, **no delay** — the manifest publishes at the END of a run |
| Scheduled sweep (`apps/worker/src/workers/index.ts:268`) | `upsertJobScheduler('duplicateScanJob', '0 */6 * * *')` | backfill + safety net |

Plus the **sink capture** (`entity-sink.ts:317-322` → `emitPairsFromIdentityMatch`), which writes a
`high` pair directly with no scan and is gated on the feature flag at the call site — writing
suggestion rows for orgs that cannot read them is wrong.

**Why org+def coalescing and not per-record jobs.** A per-record jobId only dedupes re-writes of the
*same* record. Ingest fires the mutation seam live even during a backfill (the same landmine family
as polling backfill mass-firing `message:received`), so an initial mailbox sync would enqueue one job
per created contact. Org+def coalescing absorbs any burst source — including future bulk writers
nobody has thought of — without threading batch-awareness through the CRUD seam. The cost is that a
single interactive edit runs the indexed watermark query instead of a direct-recordId scan:
milliseconds.

**Known race, accepted.** BullMQ drops a same-jobId add while the job is *running* (only the delayed
state coalesces), so records dirtied mid-run wait for the next trigger or the sweep. The watermark
guarantees they are delayed, never lost.

⚠️ **The `sync:records:changed` consumer must NEVER claim the manifest.** `claimManifest` is the
record-rules consumer's once-only latch — rule actions carry no idempotency of their own, so exactly
one claimant may proceed. A second claimant here would win the race sometimes and **starve record
rules** for that run. Dedup needs no latch: the per-run jobId gives at-most-once, and pair upserts
conflict on the canonical pair key, so a duplicate delivery is a no-op beyond a refreshed
`updatedAt`. The handler keeps top-level imports to types and the logger and lazy-imports everything
else, exactly as the rules consumer next door does.

---

## 9. Lifecycle — how a pair dies

**One vocabulary rule ties this whole section together: deletion is how an `open` pair goes away;
`dismissed` and `merged` are the only persisted terminal states.**

An untouched pair records no human decision, so there is nothing to keep. A `dismissed` row carries
the `dismissedBand` that governs reopen. A `merged` row is the audit trail that a suggestion led
somewhere. There is deliberately **no `closed` status** — adding one would force every reader to
learn it, and stamping a synthetic `dismissed` would be actively wrong, because dismissal only
reopens on a *band upgrade* and so would permanently suppress a genuine future re-match at the same
band.

### 9.1 Rescore-on-change

`rescoreOpenPairsForRecord` deletes the open pairs a re-scan no longer supports. **Mandatory, not an
enhancement**: without it the store is upsert-only and a corrected email leaves its duplicate
suggestion standing forever. With no fresh pairs the keep-guard collapses to `undefined` and every
open pair touching the record is closed — which is exactly right.

Only `open` rows are considered. `dismissed` is left alone; `merged` is never touched.

### 9.2 Dismissal, snooze and reopen

`dismissPair` stamps `dismissedBand` **from the row's own stored band, read inside the same
statement**. A caller-supplied band would let a stale client snapshot decide whether a future `high`
re-match is allowed to nag — the one field where trusting the client silently breaks the state
machine.

Snoozing deliberately does **not** stamp `dismissedBand`: a snooze is "not now", not a decision about
the evidence.

`upsertPairs`'s conflict clause holds three things at once:

- **`merged` rows are never touched** (`setWhere: ne(status, 'merged')`).
- **Dismissal is sticky, EXCEPT on a band upgrade.** Only `high` can be an upgrade — `medium` is the
  lowest stored band, so a medium rescan has nothing to reopen and must not disturb status or snooze.
  The reopen clears `dismissedBand` **in the same statement**: an `open` row carrying a
  `dismissedBand` is a dismissal that no longer exists, harmless to readers but a lie in the audit
  trail.
- **A snooze does not survive a band upgrade**, keyed off the row's STORED band so an ordinary rescan
  at the same band leaves it alone.

`upsertPairs` runs **one row at a time**, not one batched statement: the per-row `set` can then use
plain values instead of `excluded.*`, and a batch containing the same pair twice cannot trip
`ON CONFLICT DO UPDATE command cannot affect row a second time`. It also **rejects** a mis-ordered or
self-referential pair rather than silently sorting it — that is a programming error.

### 9.3 Archive

**Hard delete cascades; archive does not — and in this product "delete" IS archive.** The record
delete path sets `archivedAt`; the only true `db.delete(EntityInstance)` is for entity *groups* and
`bulkDeleteEntities`. So the FK cascade is a correctness backstop that almost never fires for real
records.

`archiveEntity` therefore calls `deleteOpenPairsForRecord`, placed **outside** the `skipEvents`
guard — pair cleanup is data hygiene, not an event, and a `skipEvents` bulk archive must still clean
up after itself. `bulkArchiveEntities` delegates per record, so **one call site covers both**.

Archive *cleans up* rather than merely hiding because the "unarchive brings the pair back for free"
argument rests on a path users cannot reach: `api.record.restore` has exactly one UI caller in the
whole app, and it is the tag list. Meanwhile the cost — `open` rows accumulating forever behind a
join that exists purely to hide them — is real.

**No restore hook is needed.** Archive/restore is a content change, so the restore write stamps
`updatedAt` explicitly (D-7 — `$onUpdate` is gone, content stamps are explicit), which re-dirties the
record against `lastDuplicateScanAt` and the next watermark scan recreates any pair that still
qualifies. Self-healing.

### 9.4 Merge

`resolveSuggestionsForMerge` is called **inside the merge transaction** (`merge-service.ts:120`,
between `archiveSourceInstances` and `touchEntityActivity`). It takes a `Transaction`, not a
`Database`: if the merge rolls back, so must the resolution, or the queue would report a merge that
did not happen.

Two different outcomes, deliberately:

- a pair whose **both** sides are in the merge set was the suggestion the user acted on → `merged`,
  terminal;
- any other pair touching a source is **deleted**. It was never acted on, and its surviving side may
  well still duplicate the merge *target* — but that is a fact for the target's next scan to
  establish, not one to migrate blindly.

---

## 10. Reading, Permissions & Clusters

`packages/lib/src/dedup/queries.ts` holds zero permission *decisions*; the router decides which
definitions the caller may read and hands the resolved predicates in as `DuplicateDefScope[]`. But
**the SQL is applied here**, because a pair read is the one shape where a post-fetch filter is not
equivalent: a pair carries the *other* record's display name, so a row dropped in JS has already been
read into the process and would be trivially re-derivable from a count.

### 10.1 The three filters every read path shares

`openPairFilters` — org, `status = 'open'`, **`archivedAt IS NULL` on BOTH sides**, not snoozed, plus
the scope predicate. `list`, `forRecord`, `count` and `getVisibleDuplicatePair` all use it.

The archived filter on both sides is the **invariant**, not the hygiene. `deleteOpenPairsForRecord`
already removes an archived record's open pairs at archive time, but write-path hooks in this
codebase get bypassed routinely (`skipEvents`, `bypassFieldGuards`, bulk paths, direct DB writes), so
correctness must not depend on one having run. Applying it on `list` alone would make `count` — the
notification badge — count pairs the list refuses to render.

### 10.2 Record scope, per join alias

The pair table is joined to `EntityInstance` **twice**, aliased `dupLow` and `dupHigh`. The alias
names are load-bearing: `DUPLICATE_LOW_INSTANCE_ID_SQL` / `DUPLICATE_HIGH_INSTANCE_ID_SQL` are
`sql.raw('"dupLow"."id"')` / `'"dupHigh"."id"'`, because a Drizzle `Column` inside an `sql` fragment
can be rewritten to a bare, unqualified name.

`loadDuplicateScopes` (the router) mirrors `UnifiedCrudHandler.recordScope` with two differences that
fall out of reading pairs rather than rows:

1. It resolves **every definition at once** — the queue is not scoped to one type. Arms 1 (`all`) and
   4 (`none`) are decided from the in-memory capability view with no I/O; only the rare
   `restricted` / grant-only definitions reach for grantee resolution.
2. The scope is resolved **twice per narrowed definition, once per side**, because the two correlate
   against different join aliases. Resolving with the default correlation target would silently point
   both arms at `"EntityInstance"."id"`, which is not in this query's FROM list.

A definition the caller can reach nothing of is **absent from the list entirely**, and an empty scope
list short-circuits to an empty result with no query issued. A pair whose other side is invisible is
excluded outright — half a duplicate card is both useless and a leak.

### 10.3 Clusters

`listDuplicatePairs` orders `(score desc, id desc)` — the id tiebreak is what makes the keyset cursor
total, since `score` is a `double precision` that ties constantly (every `high` pair produced by a
single strong key scores identically).

Union-find over the page then decides **which rows exist**, not merely how they are annotated: one
item per connected component, the best-scoring pair as the representative (the page arrives
score-desc, so the first pair seen for a component wins). `clusterSides` hydrates every member from
the page's own sides, so it costs no extra query.

⚠️ **The cursor tracks the last ROW read, not the last item emitted.** Collapsing happens after
paging, so a page that yields three items still has to resume from the pair it stopped at.

---

## 11. The Surfaces

Three surfaces, and they coexist by design — triage, in-context, and (deferred) prevention.

### 11.1 Approvals tab — a fifth section

`apps/web/src/components/global/notifications/ui/approvals-tab.tsx`. The tab is four (now five)
independently fetched, labelled sections in **fixed urgency order — explicitly not an interleaved
feed**. Duplicates ride the **last** slot: data hygiene is the least urgent lane.

`DuplicateRow` (`ui/items/duplicate-row.tsx`) is a sibling of `MailSuggestionRow`, not a mode of it.
Like mail suggestions, **nothing here is backed by a `Notification` row** — the tab reads source
tables directly. Unlike every other row in the tab, the primary action opens a **dialog**: a merge is
destructive and irreversible-feeling, so it gets the full preview surface `MergeDialog` provides.
Snooze (1 week / 1 month) sits in the overflow, mirroring `SuggestionRow`.

The section is cursor-paged with `useInfiniteQuery` + `InfiniteScroll`, the pattern the sections
above it already use — a fixed-size query left everything past the first page counted by the badge
but unreachable.

The badge is one shared hook, `use-approvals-count.ts`; the bell and the tab badge both read it and
**must not drift**. Add terms there and nowhere else.

### 11.2 Per-record header indicator

`apps/web/src/components/duplicates/ui/duplicate-indicator-button.tsx`, mounted in **both** record
headers — the drawer's `headerActions` cluster and the detail page's action cluster, the same two
mount points `FavoriteStarButton` has.

**It renders nothing when the record has no open pairs**, which is nearly every record. That is the
design constraint: a header badge present-but-empty on every contact would be pure noise, so the
component's default state is *absence*, not an empty popover. The query is doubly lazy — gated on the
feature flag AND on `enabled`, which the drawer passes as `!!open`.

It mounts its **own** `MergeDialog` (the `ticket-row-actions.tsx` precedent); neither header owns one
since merge moved into the shared `RecordActionsMenu`. It passes `targetRecordId={recordId}`
explicitly: a merge started *from* a record is a statement about which one the user is standing on,
and that overrides establishment ordering.

`duplicate-pair-summary.tsx` holds the shared rendering (record cards, band badge, signal chips) so
the Approvals row and the popover agree.

🔴 **Signal chips label from `systemAttribute`/`fieldKey`, not `type` alone.** `company_domain` is
promoted to a strong key and therefore emits `type: 'unique'`; a type-only label called the
highest-yield company signal in the whole engine "Unique field". The signal already carries its
provenance — throwing it away at render was the bug.

### 11.3 Merge-target defaulting

`MergeDialog` defaults its target to the **first** id in `baseRecordIds`, and in canonical pair order
that is whichever cuid2 sorts lower — i.e. arbitrary. Since the merge target is the record whose id
survives while the other's dies, letting pair order pick it is how "merged into the empty stub"
happens.

`orderByEstablishment` therefore orders the cluster best-established-first: **outbound history**
(`Participant.hasReceivedMessage`, one grouped query) → **has any interaction history** → **oldest
`firstInteractionAt`** → **oldest `createdAt`** → id.

The plan's middle term — raw interaction *count* — is deliberately absent: there is no interaction
counter on `EntityInstance`, and computing one means ~50 correlated aggregates over contacts' entire
message histories on a query that runs every time the bell opens.

🔴 **The `createdAt` rung is load-bearing, not a formality.** Two records with no participant rows and
no interaction history — which is **every pair the name rule surfaces** — tie on the first three
terms, and the id fallback is arbitrary. Where nothing else distinguishes the two, the record that
has existed longer is the one other things are most likely to point at.

This ordering is scoped to the suggestion entry point on purpose. Every other `MergeDialog` caller
keeps its own ordering, because elsewhere the first id is a deliberate user selection.

### 11.4 Import preview — specified, not built

The largest single contributor to the backlog is genesis G8: the import wizard buckets rows into
create/update/skip from **one** identifier field, so a row matching an existing record on a
*different* field lands in `create` and becomes a duplicate on execute. Running the blocker over the
`create` bucket during planning — *"12 of these 200 rows look like existing records"* — is the only
**prevention** point in the design, and one decision before the import beats twelve merges after it.

It is deliberately not built yet, because the useful confidence threshold there is stricter than for
a review card: a false positive in a queue is a dismissable card, while a false positive in an import
preview makes someone skip a row they wanted — silent data loss. It waits on real-data precision
numbers for the `high` band.

---

## 12. Accepted Tradeoffs & Known Limits

Stated as decisions, not defects.

1. **The badge counts PAIRS while the list renders CLUSTERS**, so an org with multi-record clusters
   sees a badge above its visible row count. Counting components instead would need an unbounded
   union-find over every open pair in the org, on a query that runs whenever the bell is mounted. The
   badge answers "how much duplicate evidence is outstanding", and the section pages, so everything
   counted is reachable.
2. **Clusters are page-local.** A connected component split across a page boundary — and only that
   case — renders as two rows. Completing clusters across the whole queue needs a second, unbounded
   query per page. Noisier, never wrong.
3. **The typo'd-surname rarity asymmetry.** `rescoreOpenPairsForRecord` treats a record's fresh set as
   a complete statement about every pair it belongs to, which is exactly true for exact blocking
   (scanning A finds B iff scanning B finds A) and for the name arm on an *exact* surname match. On a
   **typo'd** surname the two sides resolve rarity for different normalized strings — `smiht` can be
   rare where `smith` is common — so scanning one side may create a pair the other side's scan then
   closes. It settles once both have been scanned (each runs only while dirty, so there is no loop),
   and it fails toward dropping a borderline pair rather than keeping one. Not worth a second rarity
   lookup per pair.
4. **`unaccent` is not installed**, so SQL surname counting keeps diacritics while JS comparison folds
   them; `Müller` and `Muller` count as two surnames and each looks marginally rarer.
   `fuzzystrmatch` is not installed either — surname trigram at 0.625 already covers typo tolerance,
   and given-name edit distance is computed in JS over the small candidate set.
5. **The org-level passes are exact-only.** A backfill finds name-based pairs only for records that
   are individually dirty; there is no org-wide name sweep.
6. **The name arm is gated on the exact arm having at least one strong key.** `scanDefinition` returns
   early on `keys.length === 0`, before the fuzzy context is built, so a definition with no email,
   phone, unique or promoted field gets no name matching either. This coupling is not obviously
   intended and is worth a second look if a definition ever needs name matching alone.
7. **`scoreRecordMatches` has no production caller.** The scan job composes `toCandidatePair` +
   `scorePair` directly so it can merge both arms first (§7.2). The function survives in the barrel
   and in tests. Given §13, an exported-but-uncalled engine function is exactly the shape worth
   noticing.
8. **No realtime.** The Approvals tab is refetch-driven and mutations invalidate, matching the
   suggestion-bundle and mail-suggestion precedent. A `duplicates:updated` org-room event is a later
   lever.
9. **No off switch below the plan gate.** See §1.

---

## 13. The Integration Seam

The name-matching modules once shipped **dead**. They were merged, unit-tested and **correct** —
`blockFuzzyRecord`, `evaluateFuzzyPair`, `corroboratePair`, `surnameIdf`, `readStructuredNames` and
`decideNameSignal` — and had **zero production callers** anywhere in `packages/lib`, `apps/web` or
`apps/worker`. The scan job called only `blockRecord`. Every stored row was `band: 'high'`; not one
`medium` row existed or could. The entire class of duplicates the feature exists to catch was
invisible.

**The root cause was process, not code.** The wiring and the name modules were built by two parallel
workstreams with deliberately disjoint file sets: the job was forbidden to one, and the name modules
did not exist when the job was written. **The integration seam belonged to neither.** Every unit test
passed on both sides.

Two durable guards came out of it:

1. 🔴 **The regression test lives at the JOB level, not the module level.**
   `packages/lib/src/jobs/dedup/__tests__/duplicate-scan-job.int.test.ts` has a DB-backed
   `the name arm (Phase 2 must actually run)` block that invokes the **job handler** and asserts on
   stored rows — nickname-on-rare-surname → medium on name alone; `peggy`/`margaret` (dictionary
   only); `john smith`/`jane smith` → nothing; the same even when the surname is rare;
   `bob smith`/`robert smith` past a crowd of Smiths via corroboration, and dropped without it; a
   pair stays `high` when both arms fire; no name arm for a definition with no surname field.
   Removing the fuzzy arm from `scanRecord` fails four of those cases. The module-level
   `dedup-fuzzy.int.test.ts` cases **could not** catch the bug, because they compose the pipeline by
   hand — exactly what production was not doing.
2. **When splitting work across parallel workstreams, name an explicit owner for the seam between
   the halves.**

---

## 14. Gotchas & Invariants

1. **Canonical `(low, high)` ordering is a storage invariant.** `upsertPairs` rejects a mis-ordered
   or self-referential pair rather than sorting it. Skip the check and the queue shows every
   duplicate twice.
2. **Deletion is how an `open` pair goes away.** `dismissed` and `merged` are the only persisted
   terminal states. Never invent a `closed` status, and never stamp a synthetic `dismissed`.
3. **The watermark stamp must write the OBSERVED watermark rather than `now()`.** It stays a raw
   single-column SQL statement; since D-7 removed `$onUpdate` from `EntityInstance.updatedAt`
   (content stamps are explicit), a bookkeeping write can no longer re-dirty the record against its
   own fresh watermark, so the raw-SQL shape is hygiene rather than loop prevention.
4. **The `sync:records:changed` consumer must never claim the manifest** — the claim is the
   record-rules consumer's once-only latch and a second claimant starves it. Rely on the per-run
   jobId plus idempotent upserts.
5. **Blocking is ONE lookup-core call per VALUE**, never one call carrying every value as a
   candidate. The core dedupes hits across candidates by recordId (losing the second signal) and
   shares one `limit` budget across all of them (making the per-value cap unenforceable).
6. **Both scan arms must merge onto the canonical key before scoring**, or `upsertPairs`'
   last-writer-wins silently rewrites a `high` pair as `medium`.
7. **Every read path filters `archivedAt IS NULL` on BOTH sides**, and applies record scope **per
   join alias** (`dupLow` / `dupHigh`). `list`, `forRecord`, `count` and the mutation's resolve-read
   all carry the identical filter set, or the badge drifts from the tab.
8. **Trigram similarity must never leak into `score` or `Signal`.** `FuzzyCandidate` has no
   similarity field for exactly this reason. If it ever ranks the queue, the queue leads with
   siblings and spouses.
9. **The name rule lives at the producer (`decideNameSignal`), never in `scorePair`.** `scorePair`
   stays a pure weighted sum over distinct signal types.
10. **Corroboration alone scores zero and is capped at 0.3.** Remove either property and two real
    colleagues at the same company, address and ingest event reach `high`.
11. **A missing surname or a blank given name is never a match.** Blanks would pair every unnamed
    record in the definition.
12. **Surname rarity is the only inverse-frequency use in the feature**, and it is what makes
    "name alone, no corroboration" safe. Do not generalize it into the other keys.
13. **`archivedAt IS NULL` on the dirty query is not optional** — the dup-scan index is partial and
    the query degrades to a full scan without it.
14. **`sql\`… = ANY(${ids}::text[])\`` silently matches NOTHING** under Drizzle's `sql` template — the
    JS array is not serialized into a PG array literal, and there is no error. Use `inArray`, or
    `IN (${sql.join(...)})` with one bind per id. Dangerous here specifically because "zero
    candidates" is indistinguishable from "no duplicates".
15. **Gmail folding is a second lookup, never a rewrite, and never written back.** `blockOrgKey`
    cannot fold at all; that asymmetry is deliberate and documented in the file.
16. **`fieldType` must be folded through `toFieldType`**, or the legacy `PHONE` spelling silently
    disarms phone blocking on legacy fields.
17. **Phone fixtures must be real-shaped E.164 numbers.** `+1 555-…` is rejected by libphonenumber,
    so `normalizeForLookup` returns nothing and phone blocking finds zero candidates — and anyone
    testing with `555` numbers will conclude phone matching is broken when it is working correctly.
    Use e.g. `+12133734253`.
18. **Never use a surname the dev org is full of as a name-rule fixture.** It fails condition (c) and
    produces nothing — which is the rule working, not failing.
19. **`dismissedBand` is stamped from the row's own stored band, inside the statement.** Never from
    the client. And the reopen clears it in the same statement.
20. **Merge resolution runs inside the merge transaction**, taking a `Transaction`. A rolled-back
    merge must roll back its resolution.
21. **Archive cleanup sits OUTSIDE the `skipEvents` guard.** It is hygiene, not an event, and a
    `skipEvents` bulk archive must still clean up after itself.
22. **The engine holds zero permission checks.** `apps/web/src/server/api/routers/duplicates.ts` is
    the only authorization path, and the record-scope half is the load-bearing one.
23. **The Approvals tab reads source tables — do not mint `Notification` rows for pairs.**
24. **Extend `use-approvals-count.ts` and nowhere else** when adding to the badge, or the bell and
    the tab disagree.
25. **A hit on an `isUnique` key is an enforcement leak, not noise.** Surfacing it is the point.

---

## 15. Key Files

**Engine** — `packages/lib/src/dedup/`: `types.ts` (`Signal`, `Band`, `DedupConfig`), `config.ts`
(**allowlist/denylist, weights, thresholds, role-email list, block cap, rarity bounds**),
`match-keys.ts`, `blocking.ts` (exact: record / org-key / identity), `blocking-fuzzy.ts` (trigram +
exact-surname passes), `nicknames.ts` + `nicknames.json` (**the hypocorism dictionary**),
`name-match.ts` (**the structured comparator + `decideNameSignal`**), `surname-rarity.ts`
(**condition (c)**, `NORMALIZED_SURNAME_SQL`), `corroborate.ts` (five corroborators +
`evaluateFuzzyPair`), `scoring.ts` (weights → band, canonicalization), `pairs.ts` (all writes),
`queries.ts` (all queue reads + `orderByEstablishment`), `enqueue-scan.ts`,
`emit-identity-pairs.ts`, `index.ts`.

**Tests** — `packages/lib/src/dedup/__tests__/`: `config.test.ts`, `match-keys.test.ts`,
`nicknames.test.ts`, `name-match.test.ts`, `scoring.test.ts`, `pairs.test.ts`,
`dedup-engine.int.test.ts`, `dedup-fuzzy.int.test.ts`, `queries.int.test.ts`,
`archive-pair-cleanup.int.test.ts`, `enqueue-scan.test.ts`. And **the one that matters most**:
`packages/lib/src/jobs/dedup/__tests__/duplicate-scan-job.int.test.ts` (§13).

**Job & triggers** — `packages/lib/src/jobs/dedup/duplicate-scan-job.ts` (one job, three scopes,
both arms, the watermark), `packages/lib/src/events/handlers/handle-sync-duplicate-scan.ts`,
`packages/lib/src/events/handlers/publish-event-job.ts:195` (the handler array),
`packages/lib/src/resources/crud/unified-handler-mutations.ts:450,559` (mutation seam) and `:628`
(archive cleanup), `packages/lib/src/data-connectors/sinks/entity-sink.ts:317-322` (sink capture),
`packages/lib/src/resources/merge/merge-service.ts:120` (merge resolution),
`apps/worker/src/workers/worker-definitions/maintenance-worker.ts:302` (registration),
`apps/worker/src/workers/index.ts:268` (the 6h schedule).

**Schema** — `packages/database/src/db/schema/duplicate-suggestion.ts`,
`packages/database/src/db/schema/entity-instance.ts` (`lastDuplicateScanAt` +
`EntityInstance_org_def_dup_scan_idx`).

**Flag** — `packages/lib/src/permissions/types.ts` (`FeatureKey.duplicateDetection` +
`FEATURE_REGISTRY`), `packages/seed/src/domains/billing.domain.ts` (`false` on every tier).

**API & UI** — `apps/web/src/server/api/routers/duplicates.ts` (**the only gate**),
`apps/web/src/components/duplicates/ui/duplicate-indicator-button.tsx` +
`ui/duplicate-pair-summary.tsx`,
`apps/web/src/components/global/notifications/ui/items/duplicate-row.tsx`,
`.../notifications/ui/approvals-tab.tsx`, `.../notifications/hooks/use-approvals-count.ts`,
`apps/web/src/components/records/record-drawer.tsx` +
`apps/web/src/components/detail-view/components/detail-view-actions.tsx` (indicator mounts),
`apps/web/src/components/merge/merge-dialog.tsx`.

**Depends on** — `packages/lib/src/resources/lookup/lookup-entities-by-field-value.ts` (the shared
lookup core; multi-value-aware via `DISTINCT ON (entityId)`),
`packages/lib/src/resources/search/record-search-sql.ts` +
`packages/lib/src/search/text-search-sql.ts` (the trigram builders),
`packages/lib/src/ingest/domain/classifier.ts` (`classifyForCompany`),
`packages/lib/src/field-values/primary-value.ts` (`MAX_MULTI_VALUES`),
`packages/lib/src/field-values/stored-field-type.ts` (`toFieldType`).
