// packages/lib/src/postings/draft.ts
//
// The `GlPosting.draft` envelope: its type, its single construction site, its
// runtime parser, and the reversal swap.
//
// PURE. No database, no clock, no io - `parsePostingDraft` reads a value that
// came out of a jsonb column, but it does not go and get it.
//
// ── Why this file exists ────────────────────────────────────────────────────
//
// The envelope used to be an anonymous object literal inside `claimPeriod`.
// That was fine while the poster was the only thing that ever touched it: it
// wrote the shape and nothing read it back. The L1 month-end inventory entry
// (plans/money/tasks/09-month-end-inventory-entry.md) changes that - it READS
// the previous month's envelope to learn what balance was last asserted, which
// is the number its whole delta is computed from.
//
// The moment a shape is written by one module and read by another, an inline
// literal is a contract nobody declared. So it is declared here, versioned, with
// a parser that fails loudly rather than letting `undefined` flow into
// arithmetic that decides what a journal entry says.

import { UnprocessableEntityError } from '../errors'
import type { BuiltEntry, PostingType, ResolvedPostingLine } from './types'

/** The envelope version. Bump only for a shape change readers must branch on. */
export const POSTING_DRAFT_VERSION = 1

/**
 * The three inventory balances and the three cumulative activity totals, as one
 * posting asserted them.
 *
 * Every number is integer minor units. `inventoryAdjustments` is SIGNED - a
 * shrinkage is negative - and it is the only one of the six that may be, because
 * the other five are balances and cumulative absorption, which cannot go
 * negative in any state the subledger can reach.
 *
 * 🛑 The activity totals are CUMULATIVE from the opening cutoff through the
 * period end, not the amounts in this one entry. That is what lets a build or an
 * adjustment entered after its accounting month has closed appear in the next
 * open entry carrying its own frozen labour, overhead and 5095 classification,
 * instead of vanishing into the COGS plug.
 */
export interface MonthEndInventorySnapshot {
  balances: {
    inventory_raw_materials: number
    inventory_wip: number
    inventory_finished_goods: number
  }
  activityTotals: {
    absorbedLabor: number
    absorbedOverhead: number
    /** Signed. Negative is shrinkage. */
    inventoryAdjustments: number
  }
}

/**
 * What a posting asserts about the world on either side of itself.
 *
 * ## Why BOTH sides, and why a reversal never re-reads the subledger
 *
 * `after` is what the next month's entry computes its delta from. `before` looks
 * redundant with the previous posting's `after` - and it is, on the happy path.
 * It earns its place twice.
 *
 * 1. **It makes the chain testable.** Row N's `before` must equal row N-1's
 *    `after`. Nothing else in this design can detect a broken prior-row
 *    selection rule, because a wrong prior still produces a *balanced* entry.
 * 2. **It is what a reversal swaps.** See {@link reverseAssertions}.
 *
 * 🛑 The rejected alternative was to reconstruct a reversal's assertions by
 * re-running the month-end reader against the prior-prior period. That is wrong:
 * movements that arrived AFTER the original posted would be included, and the
 * reversal would assert figures unrelated to the lines it is backing out. A
 * reversal must reverse the FROZEN posting, never reinterpret today's subledger
 * - the same rule that stops a standard-cost change from restating a movement.
 *
 * `kind` is a discriminant so a second assertion-carrying posting type is
 * additive rather than a reshape.
 */
export interface PostingAssertions {
  kind: 'month_end_inventory'
  before: MonthEndInventorySnapshot
  after: MonthEndInventorySnapshot
}

/**
 * The audit record of WHAT WAS POSTED, verbatim.
 *
 * Not a hint for reconstructing the entry later: rebuilding from the subledger
 * gives a different answer once the subledger moves, which is the one property a
 * ledger must not have.
 */
export interface PostingDraftV1 {
  v: typeof POSTING_DRAFT_VERSION
  docNumber: string
  revision: number
  memo?: string
  entry: BuiltEntry
  /** Post-resolution. A provider never sees a role. */
  resolvedLines: Array<ResolvedPostingLine & { accountRole: string }>
  /** Present only for posting types that assert a balance. See {@link PostingAssertions}. */
  assertions?: PostingAssertions
}

/**
 * Posting types that MUST carry {@link PostingAssertions}.
 *
 * `month_end_inventory` asserts a balance rather than accumulating one, so the
 * next month's entry is computable only from what this one recorded. A
 * month-end posting written without assertions is not merely missing metadata -
 * it silently ends the chain, and the next close reads a delta from nothing.
 */
const ASSERTION_REQUIRED_TYPES = new Set<PostingType>(['month_end_inventory'])

/** Whether this posting type refuses to be claimed without assertions. */
export function requiresAssertions(postingType: PostingType): boolean {
  return ASSERTION_REQUIRED_TYPES.has(postingType)
}

/**
 * Build the envelope. The SINGLE construction site - nothing else may assemble
 * this object, so there is exactly one place the version is stamped.
 */
export function buildPostingDraft(input: {
  docNumber: string
  revision: number
  memo?: string
  entry: BuiltEntry
  resolvedLines: Array<ResolvedPostingLine & { accountRole: string }>
  assertions?: PostingAssertions
}): PostingDraftV1 {
  return {
    v: POSTING_DRAFT_VERSION,
    docNumber: input.docNumber,
    revision: input.revision,
    memo: input.memo,
    entry: input.entry,
    resolvedLines: input.resolvedLines,
    assertions: input.assertions,
  }
}

/**
 * The assertions a REVERSAL of this posting must carry: the pair, swapped.
 *
 * ```
 *   original   before: A   after: B
 *   reversal   before: B   after: A
 * ```
 *
 * Reversing the reversal swaps them again and lands back on the original, so
 * this is self-consistent at any revision depth. It reads only frozen data.
 */
export function reverseAssertions(assertions: PostingAssertions): PostingAssertions {
  return { kind: assertions.kind, before: assertions.after, after: assertions.before }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMinor(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new UnprocessableEntityError(
      `Posting draft ${path} must be an integer number of minor units, got ${String(value)}`,
      { path, value: String(value) }
    )
  }
  return value
}

function parseSnapshot(value: unknown, path: string): MonthEndInventorySnapshot {
  if (!isRecord(value)) {
    throw new UnprocessableEntityError(`Posting draft ${path} is missing or not an object`, {
      path,
    })
  }
  const balances = value.balances
  const activityTotals = value.activityTotals
  if (!isRecord(balances) || !isRecord(activityTotals)) {
    throw new UnprocessableEntityError(
      `Posting draft ${path} must carry both 'balances' and 'activityTotals'`,
      { path }
    )
  }
  return {
    balances: {
      inventory_raw_materials: parseMinor(
        balances.inventory_raw_materials,
        `${path}.balances.inventory_raw_materials`
      ),
      inventory_wip: parseMinor(balances.inventory_wip, `${path}.balances.inventory_wip`),
      inventory_finished_goods: parseMinor(
        balances.inventory_finished_goods,
        `${path}.balances.inventory_finished_goods`
      ),
    },
    activityTotals: {
      absorbedLabor: parseMinor(
        activityTotals.absorbedLabor,
        `${path}.activityTotals.absorbedLabor`
      ),
      absorbedOverhead: parseMinor(
        activityTotals.absorbedOverhead,
        `${path}.activityTotals.absorbedOverhead`
      ),
      inventoryAdjustments: parseMinor(
        activityTotals.inventoryAdjustments,
        `${path}.activityTotals.inventoryAdjustments`
      ),
    },
  }
}

/**
 * Parse a `GlPosting.draft` jsonb value.
 *
 * 🛑 **Throws rather than returning a `Result`, and that is deliberate.** A draft
 * that does not parse is not a runtime failure the caller can recover from - it
 * means a row this code wrote cannot be read by this code, and the only honest
 * response is to stop. Silently treating it as absent would make the next
 * month's entry assert a delta from zero and restate the whole opening balance,
 * which balances perfectly and is invisible until somebody reconciles by hand.
 *
 * @throws {UnprocessableEntityError} on an unknown version or a malformed shape.
 */
export function parsePostingDraft(value: unknown): PostingDraftV1 {
  if (!isRecord(value)) {
    throw new UnprocessableEntityError('Posting draft is missing or not an object')
  }
  if (value.v !== POSTING_DRAFT_VERSION) {
    throw new UnprocessableEntityError(
      `Unsupported posting draft version ${String(value.v)} (this build reads v${POSTING_DRAFT_VERSION})`,
      { version: String(value.v) }
    )
  }

  const assertions = value.assertions
  let parsedAssertions: PostingAssertions | undefined
  if (assertions !== undefined && assertions !== null) {
    if (!isRecord(assertions) || assertions.kind !== 'month_end_inventory') {
      throw new UnprocessableEntityError(
        `Posting draft carries assertions of an unknown kind ${String(isRecord(assertions) ? assertions.kind : assertions)}`
      )
    }
    parsedAssertions = {
      kind: 'month_end_inventory',
      before: parseSnapshot(assertions.before, 'assertions.before'),
      after: parseSnapshot(assertions.after, 'assertions.after'),
    }
  }

  return {
    v: POSTING_DRAFT_VERSION,
    docNumber: String(value.docNumber ?? ''),
    revision: typeof value.revision === 'number' ? value.revision : 0,
    memo: typeof value.memo === 'string' ? value.memo : undefined,
    entry: value.entry as BuiltEntry,
    resolvedLines: Array.isArray(value.resolvedLines)
      ? (value.resolvedLines as PostingDraftV1['resolvedLines'])
      : [],
    assertions: parsedAssertions,
  }
}
