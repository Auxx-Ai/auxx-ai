// packages/lib/src/builds/reconcile-policy.ts

/**
 * What must happen to an order's builds when the order's demand changes.
 *
 * `plans/products/13-order-build-reconciliation.md` **Model B** (decided
 * 2026-08-28: *an order-raised build tracks its order*), which is
 * [events/08](../../../../plans/events/08-derived-parent-reconciler-plan.md)
 * phase 5 — turning the drift reconciler's `apply` on.
 *
 * 🛑 **This is the whole of the decision, and it touches nothing.** No database,
 * no clock, no settings read, no writer. It is handed the order's collapsed
 * demand and the builds already raised from that order, and it returns a list of
 * discrete actions. The reason it is factored out this hard is 13 §6 phase 5's
 * own risk note: *"Every reconciler shipped so far writes a **number**; this one
 * writes **records**."* A record writer whose decision cannot be read back
 * without a database is a record writer nobody can review.
 *
 * ## The rails it exists to enforce (13 §5)
 *
 * - **`source: 'manual'` is never touched.** Not amended, not cancelled, not
 *   counted as the order's build. Enforced here in memory as the second of the
 *   two checks 13 §5 asks for — `listBuilds` silently drops a filter whose field
 *   the org has not materialised, so the SQL-side filter alone is not enough.
 * - **A `completed` build is never amended and never cancelled** (build README
 *   B6/B8). It is reversed, by `reverseBuild`, and convergence does not reverse:
 *   AB6 reverses on *order cancellation*, which is `auto-build-cancel.ts`, not
 *   this pass. An edited line is not a cancelled order.
 * - **An `in_progress` build is never silently amended** — 13 §1.0(a). The
 *   reason is **operational, not ledger-based**: `startBuild` writes no
 *   movements, but material may already be on the saw. It stays *cancellable*
 *   by the order-cancellation sweep and never amendable by this one.
 * - **Never throws.** Total on every input, including a build with a `null`
 *   status, a `null` quantity or a `null` part. 13 §5: one bad line must not
 *   lose the rest of the order.
 *
 * ## Admission versus convergence (Q7 + Q12)
 *
 * The two questions that took the longest to close, and the reason this file has
 * a `canceled`-only branch that looks redundant and is not:
 *
 * - **Q7 — the stock rule is evaluated at raise only.** Quantity on hand is
 *   global and unreserved, so re-testing coverage on every reconcile makes
 *   builds appear and disappear as *unrelated* orders consume stock.
 * - **Q12 — but coverage is decided once per `(order, part)` **pair**, at that
 *   pair's first admission**, not once per order. A part that has never had a
 *   build against this order is a new pair and gets its coverage check now; a
 *   pair that was decided before — built, or built and then cancelled — is never
 *   re-checked, only quantity-converged. Read Q7 as "once ever, per order" and a
 *   part skipped as `covered-by-stock` at 3 units could be edited to 10 and
 *   still never build: a permanent hole where the projection quietly stops
 *   projecting, which is 13 §0's defect wearing a different hat.
 *
 * A `canceled` build is therefore evidence, not noise: it is the record that
 * this pair was admitted once, and it is why {@link planOrderBuildConvergence}
 * raises for a part carrying only cancelled builds **even when stock would have
 * covered it**.
 *
 * ## Where the status gate lives
 *
 * `canAmendBuild` is in `builds/client.ts` beside `canStartBuild`,
 * `canCancelBuild`, `canCompleteBuild` and `canReverseBuild` — one file that
 * answers "what may be done to a build in this status", not one gate per
 * caller. It is narrower than `canCancelBuild` on purpose; the argument is
 * there.
 *
 * ## What is deliberately NOT here
 *
 * The **enablement window** (AB8, 13 Q11) and the `inventory.autoBuildFromOrders`
 * switch. Both are order-level gates that belong to the caller, ahead of this
 * call: an order outside the window must not reach convergence at all, because
 * under Model B *a reconcile is a raise door* — the entire interactive-path fix
 * is "a late line raises the first build" — so an unwindowed apply manufactures
 * against five years of back-filled Shopify history. Keeping the gate at the
 * caller rather than as a parameter here means the pure layer cannot be handed a
 * clock, and the gate is one `isWithinEnablementWindow` call in the same place
 * the deleted `runAutoBuildForOrders` made it — today that is
 * `reconcile-order-builds.ts`, which is the only caller.
 */

import { type AutoBuildStockRule, isCoveredByStock } from './auto-build-policy'
import { canAmendBuild, resolvePartKind } from './client'
import type { BuildRecord } from './types'

/**
 * Why a `(order, part)` pair produced no write. Every one of these is normal,
 * and the set is closed on purpose — mirroring the `AutoBuildSkipReason` set Q13
 * deleted, so a
 * caller can render, count and test them exhaustively rather than parse a
 * sentence.
 */
export type ConvergenceSkipReason =
  /** Section 5.3 step 3 — a `component` (or an unclassified part) is purchased, not built. */
  | 'not-a-built-part'
  /** Section 5.3 step 2 — no bill of materials, so a build would consume nothing. */
  | 'no-bill-of-materials'
  /** AB4 + Q12 — first admission of this pair, and the shelf already covers it. */
  | 'covered-by-stock'
  /** The planned build already says exactly what the order says. The no-op. */
  | 'already-current'
  /** 13 §1.0(a) — cancellable, but never silently amendable. Material may be cut. */
  | 'in-progress-not-amendable'
  /** B6/B8 — reversed, never edited or deleted, and never by this pass. */
  | 'completed-immutable'
  /** 13 §5 — `source: 'manual'` (or a row predating the field). Never touched. */
  | 'not-order-raised'
  /** A reversing build (B6). It undoes another build; it is not demand. */
  | 'is-a-reversal'
  /** `resolveBuildStatus` returned `null`. A data problem, not a lifecycle state. */
  | 'unknown-status'
  /** A second `planned` build for the same pair. See {@link planOrderBuildConvergence}. */
  | 'duplicate-build'

/**
 * One decision, for one build or one part.
 *
 * A discriminated union rather than a bag of arrays so that the plan reads in
 * one pass and an unhandled `kind` is a type error at the apply site.
 */
export type BuildConvergenceAction =
  /** Create a `planned` build for the whole ordered quantity (Q5 — never a shortfall). */
  | { kind: 'raise'; partId: string; quantity: number }
  /** Rewrite an existing `planned` build's `quantityPlanned`. */
  | { kind: 'amend'; buildId: string; partId: string; from: number | null; to: number }
  /** `cancelBuild` — never a delete (AB6: we took the trigger and refused the verb). */
  | { kind: 'cancel'; buildId: string; partId: string }
  /** No write, with the reason a person can act on. `buildId` is `null` for a part-level skip. */
  | { kind: 'skip'; partId: string; buildId: string | null; reason: ConvergenceSkipReason }

/** Everything the decision is allowed to see. No db, no clock, no settings. */
export interface OrderBuildConvergenceInput {
  /**
   * `partId` -> units this order wants, ALREADY collapsed by `sumQuantityByPart`
   * — one entry per part, never one per line (12 §5.3 step 6).
   *
   * A part absent from this map, or present with a non-positive or non-finite
   * quantity, is *not wanted*: the same reading `sumQuantityByPart` and
   * `orderDemandFingerprint` already take, restated here so the function stays
   * total against a caller that built the map some other way.
   */
  desired: ReadonlyMap<string, number>
  /**
   * Every build already raised against this order — all sources, all statuses.
   *
   * ⚠️ Pass the **unfiltered** set. The `source: 'manual'` and reversal rows are
   * what make the skip list honest, and dropping them upstream would let a
   * missing `build_source` filter (13 §5) reach the writer unnoticed.
   */
  existing: readonly BuildRecord[]
  /** `partId` -> raw `part_kind` option value, exactly as stored. `null` reads as `component`. */
  partKinds: ReadonlyMap<string, string | null>
  /** `partId` -> does the part have at least one direct subpart? Absent reads as `false`. */
  hasBom: ReadonlyMap<string, boolean>
  /** `partId` -> `part_quantity_on_hand`. Absent reads as `0`. */
  quantitiesOnHand: ReadonlyMap<string, number>
  /** `inventory.autoBuildStockRule`. Consulted at admission only — Q7/Q12. */
  stockRule: AutoBuildStockRule
}

/** What one order's builds must become. */
export interface OrderBuildPlan {
  /**
   * Every decision, in a deterministic order: parts ascending by id, one
   * contiguous group per part, and per-build rows oldest first within it.
   *
   * Determinism is not cosmetic — it is what lets the apply layer's tests assert
   * on the whole array, and what keeps a log line comparable between runs.
   */
  actions: BuildConvergenceAction[]
  /**
   * Does anything here actually write? `false` when every action is a `skip`.
   *
   * The cheap gate before opening a write session. It does **not** replace the
   * fingerprint no-op check upstream (events/08 R9) — that one avoids the reads
   * this plan is built from; this one avoids the write those reads led to.
   */
  hasWrites: boolean
}

/**
 * Decide what to do to one order's builds, given what the order now wants.
 *
 * The pass, per `(order, part)` pair. Every build for the pair is classified
 * first, then one quantity decision is taken:
 *
 * | state of the pair | action |
 * | --- | --- |
 * | no build at all, part wanted | `raise` if it is a built part **and** has a BOM **and** is not covered by stock; otherwise the matching `skip` |
 * | only `canceled` builds, part wanted | `raise` — kind and BOM still checked, **coverage is not** (Q12: the pair was admitted once) |
 * | a `planned` build, quantity differs | `amend` to the desired quantity (Q3 — the order wins, and Q5 — the whole quantity) |
 * | a `planned` build, quantity equal | `skip` `already-current` |
 * | a `planned` build, part no longer wanted | `cancel` |
 * | an `in_progress` build | `skip` `in-progress-not-amendable` — 13 §1.0(a) |
 * | a `completed` build | `skip` `completed-immutable` — B6/B8 |
 * | `source !== 'order'` | `skip` `not-order-raised` — 13 §5, the in-memory half of the two checks |
 * | `reversalOfBuildId` set | `skip` `is-a-reversal` |
 * | `status` is `null` | `skip` `unknown-status` |
 *
 * ## 🛑 Several builds for one pair — a real, pre-existing hazard
 *
 * ⚠️ **Q13 narrowed this, and it is worth being exact about how.** The way a pair
 * got several builds was `runAutoBuildForOrders`, which had no existing-build
 * check at all (13 §1.4), so a re-dispatch against the same order raised a
 * second full set. **Q13 deleted that door**, so no NEW duplicate can arise that
 * way — this function is now the only raiser and it never raises past an active
 * build. But the rows the old door already made are still in the database, and a
 * person may raise a `source: 'manual'` build for a part at any time. The rule here is stated loudly because it is the one
 * place this function is knowingly asymmetric:
 *
 * - **An active build blocks a raise.** `planned`, `in_progress`, `completed` —
 *   and `unknown-status`, because a row we cannot classify may well *be* a
 *   planned build with a broken option value, and creating a record next to it
 *   is not a recoverable mistake. Never a top-up build alongside one that exists.
 * - **At most ONE `planned` build is amended** — the oldest by `createdAt`. The
 *   rest are `duplicate-build` skips. Amending all of them would multiply the
 *   demand by their count: three builds each amended to 5 is 15 units on the
 *   floor for an order of 5.
 * - **But every `planned` build is cancelled** when the part is no longer
 *   wanted. The asymmetry is deliberate: cancelling writes no movements (B2),
 *   is exactly what the order-cancellation sweep already does to the same set
 *   (`auto-build-cancel.ts`), and cancelling only the oldest would leave a live
 *   build for a part the order does not want — 13 §0's defect, re-created by the
 *   very pass that exists to remove it. Amend-one is convergent because the next
 *   pass sees the same primary; cancel-one would not be, because nothing fires
 *   a second pass once the fingerprint stops moving.
 *
 * ⚠️ A `source: 'manual'` build does **not** block a raise. It is a person's own
 * build, deliberately raised, and AB7 exists precisely so the two can coexist —
 * blocking on it would let one manual build suppress an order's build set
 * forever. This matched what `runAutoBuildForOrders` did before Q13 deleted it.
 *
 * ⚠️ A pair whose build was `completed` and then **reversed** never raises
 * again: the completed original is still there and still blocks. That is the
 * conservative direction — automation must not decide that a reversal means
 * "build it again" — and the escape hatch is the one 13 Q3 names, a
 * `source: 'manual'` build.
 */
export function planOrderBuildConvergence(input: OrderBuildConvergenceInput): OrderBuildPlan {
  const buildsByPart = groupByPart(input.existing)

  const partIds = [...new Set([...input.desired.keys(), ...buildsByPart.keys()])].sort(compareIds)

  const actions: BuildConvergenceAction[] = []
  for (const partId of partIds) {
    planOnePart(input, partId, buildsByPart.get(partId) ?? [], actions)
  }

  return { actions, hasWrites: actions.some((action) => action.kind !== 'skip') }
}

/**
 * Group by `partId`, oldest first.
 *
 * A build with no part is dropped without a skip row: it names no pair, so there
 * is nothing for a reader to act on and nothing convergence could do to it.
 */
function groupByPart(builds: readonly BuildRecord[]): Map<string, BuildRecord[]> {
  const byPart = new Map<string, BuildRecord[]>()
  for (const build of builds) {
    if (!build.partId) continue
    const bucket = byPart.get(build.partId)
    if (bucket) bucket.push(build)
    else byPart.set(build.partId, [build])
  }
  for (const bucket of byPart.values()) bucket.sort(compareByAge)
  return byPart
}

/** Oldest first, tie-broken on id so the primary of a same-instant pair is stable. */
function compareByAge(a: BuildRecord, b: BuildRecord): number {
  const delta = a.createdAt.getTime() - b.createdAt.getTime()
  return delta !== 0 ? delta : compareIds(a.buildId, b.buildId)
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * How many units the order wants of this part.
 *
 * Non-positive and non-finite both read as *not wanted*, matching
 * `sumQuantityByPart`: a part whose lines sum to nothing does not get a build
 * for nothing, and — under Model B — loses the one it has.
 */
function desiredQuantity(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return 0
  return raw
}

function skip(
  partId: string,
  buildId: string | null,
  reason: ConvergenceSkipReason
): BuildConvergenceAction {
  return { kind: 'skip', partId, buildId, reason }
}

/** The decision for one `(order, part)` pair. Appends to `out`; never throws. */
function planOnePart(
  input: OrderBuildConvergenceInput,
  partId: string,
  builds: readonly BuildRecord[],
  out: BuildConvergenceAction[]
): void {
  const wanted = desiredQuantity(input.desired.get(partId))

  const amendable: BuildRecord[] = []
  const classified: BuildConvergenceAction[] = []
  let blocked = false
  let admitted = false

  for (const build of builds) {
    // 13 §5, in memory as well as in SQL. A manual build is not this order's
    // build: never touched, and never allowed to block the order's own.
    if (build.source !== 'order') {
      classified.push(skip(partId, build.buildId, 'not-order-raised'))
      continue
    }
    // Before the status test: `reverseBuild` copies the original's source and
    // lands the reversal `completed`, so this would otherwise read as one.
    if (build.reversalOfBuildId) {
      classified.push(skip(partId, build.buildId, 'is-a-reversal'))
      continue
    }
    if (build.status === null) {
      classified.push(skip(partId, build.buildId, 'unknown-status'))
      blocked = true
      continue
    }
    admitted = true
    if (build.status === 'completed') {
      classified.push(skip(partId, build.buildId, 'completed-immutable'))
      blocked = true
      continue
    }
    if (build.status === 'in_progress') {
      classified.push(skip(partId, build.buildId, 'in-progress-not-amendable'))
      blocked = true
      continue
    }
    if (canAmendBuild(build.status)) {
      amendable.push(build)
    }
    // `canceled` — terminal, and the marker that this pair was admitted once
    // (Q12). It produces no action of its own, which is why it produces no skip.
  }

  if (amendable.length > 0) {
    out.push(...quantityDecision(partId, amendable, wanted))
    out.push(...classified)
    return
  }

  out.push(...classified)

  // Nothing to converge and nothing wanted: the steady state after a cancel.
  if (wanted <= 0) return
  // An active — or unclassifiable — build already answered for this pair.
  if (blocked) return

  out.push(admissionDecision(input, partId, wanted, admitted))
}

/**
 * The pair has at least one `planned` build. Converge its quantity.
 *
 * Q3 — the order wins: a hand edit to a `planned` order-raised build is not
 * durable, and the amend overwrites it. Q5 — the amount is the whole ordered
 * quantity; nothing subtracts on-hand stock from a build quantity, and the day
 * something does it is an allocation model (13 Model D), not a tweak.
 */
function quantityDecision(
  partId: string,
  amendable: readonly BuildRecord[],
  wanted: number
): BuildConvergenceAction[] {
  if (wanted <= 0) {
    return amendable.map((build) => ({ kind: 'cancel', partId, buildId: build.buildId }))
  }

  const primary = amendable[0]
  // Unreachable — the caller only enters this branch with an amendable build.
  // Written as a guard rather than a `!` so the function stays total by
  // construction rather than by the caller's promise.
  if (!primary) return []
  const duplicates = amendable.slice(1)

  const decision: BuildConvergenceAction =
    primary.quantityPlanned === wanted
      ? skip(partId, primary.buildId, 'already-current')
      : {
          kind: 'amend',
          buildId: primary.buildId,
          partId,
          from: primary.quantityPlanned,
          to: wanted,
        }

  return [decision, ...duplicates.map((build) => skip(partId, build.buildId, 'duplicate-build'))]
}

/**
 * The pair has no build to converge. May it have one?
 *
 * The same three tests `runAutoBuildForOrders` applied at raise before Q13 deleted
 * it (12 §5.3 steps
 * 3, 2 and 4, in that order — a `component` never needs its bill of materials
 * read), with one difference that is the whole of Q12: **coverage is tested only
 * at a pair's first admission.** `admitted` is true when this order has raised a
 * build for this part before and it has since been cancelled, and such a pair is
 * quantity-converged forever after, never re-admitted.
 */
function admissionDecision(
  input: OrderBuildConvergenceInput,
  partId: string,
  wanted: number,
  admitted: boolean
): BuildConvergenceAction {
  if (resolvePartKind(input.partKinds.get(partId)) === 'component') {
    return skip(partId, null, 'not-a-built-part')
  }
  if (input.hasBom.get(partId) !== true) {
    return skip(partId, null, 'no-bill-of-materials')
  }
  if (
    !admitted &&
    isCoveredByStock(input.stockRule, input.quantitiesOnHand.get(partId) ?? 0, wanted)
  ) {
    return skip(partId, null, 'covered-by-stock')
  }
  return { kind: 'raise', partId, quantity: wanted }
}
