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

import { z } from 'zod'
import { UnprocessableEntityError } from '../errors'
import type {
  BuiltEntry,
  MonthEndInventorySnapshot,
  PostingAssertions,
  PostingReason,
  PostingType,
  ResolvedPostingLine,
} from './types'

// `MonthEndInventorySnapshot` and `PostingAssertions` moved to `types.ts` - the
// client-safe leaf - because the close console renders a roll-forward from them
// and a browser must hold the shape without importing this file's validators.
// Re-exported so every existing importer is unaffected. Same move task 13 made
// for `EntryPreview` and the four other read models.
export type { MonthEndInventorySnapshot, PostingAssertions } from './types'

/** The envelope version. Bump only for a shape change readers must branch on. */
export const POSTING_DRAFT_VERSION = 1

const postingAccountingMembershipSchema = z
  .strictObject({
    version: z.literal(1),
    membershipHash: z.string().regex(/^[0-9a-f]{64}$/),
    representation: z.literal('journal'),
    members: z
      .array(
        z.strictObject({
          workId: z.string().min(1),
          effectKey: z.string().min(1),
          basisVersion: z.number().int().positive(),
          basisHash: z.string().regex(/^[0-9a-f]{64}$/),
          expectedCorrectionHeadId: z.string().min(1).nullable(),
        })
      )
      .min(1),
  })
  .refine(
    (value) =>
      new Set(value.members.map((m) => m.workId)).size === value.members.length &&
      new Set(value.members.map((m) => m.effectKey)).size === value.members.length,
    'Accounting membership must contain distinct work and effect keys'
  )

/** Exact effect membership and correction ancestry saved with a local journal. */
export type PostingAccountingMembership = z.infer<typeof postingAccountingMembershipSchema>

/** Refuse malformed or ambiguous saved membership before using it as accounting authority. */
export function parsePostingAccountingMembership(value: unknown): PostingAccountingMembership {
  return postingAccountingMembershipSchema.parse(value)
}

/**
 * The audit record of WHAT WAS POSTED, verbatim.
 *
 * Not a hint for reconstructing the entry later: rebuilding from the subledger
 * gives a different answer once the subledger moves, which is the one property a
 * ledger must not have.
 */
export interface PostingDraftV1 {
  accountingMembership?: PostingAccountingMembership
  v: typeof POSTING_DRAFT_VERSION
  docNumber: string
  revision: number
  memo?: string
  /**
   * The entry as the builder produced it, whole.
   *
   * ⚠️ That includes `BuiltEntry.sources` - the frozen per-source list a
   * SUMMARISED entry carries, because its lines name a period key rather than
   * the fifty orders behind them (49 §2.5). Nothing here has to know the shape:
   * the envelope carries the entry verbatim, so a new optional field on
   * `BuiltEntry` reaches the audit record with no version bump. `v` stays `1`.
   */
  entry: BuiltEntry
  /**
   * Post-resolution. A provider never sees a role.
   *
   * `accountRole` is `null` on a CODE line - a manual or opening entry, where
   * the human named the account itself and there is no role to record. Widened
   * from `string` by HANDOFF slot 1A; `GlPostingLine.accountRole` has always
   * been nullable, so the envelope was the narrower of the two.
   */
  resolvedLines: Array<ResolvedPostingLine & { accountRole: string | null }>
  /** Present only for posting types that assert a balance. See {@link PostingAssertions}. */
  assertions?: PostingAssertions
  /**
   * Why each forked line landed where it did, in words (brief 28 §5). Copied
   * from `BuiltEntry.reasons` at claim time, the same way `sources` rides in,
   * and absent on every entry whose builder emitted none. No version bump: an
   * optional field a reader may ignore is not a shape readers must branch on.
   *
   * A reversal copies the original's list verbatim - the reversed lines keep
   * their line numbers - and the drawer prefixes it with "Reversing:".
   */
  reasons?: PostingReason[]
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
  resolvedLines: Array<ResolvedPostingLine & { accountRole: string | null }>
  assertions?: PostingAssertions
  reasons?: PostingReason[]
  accountingMembership?: PostingAccountingMembership
}): PostingDraftV1 {
  return {
    v: POSTING_DRAFT_VERSION,
    accountingMembership: input.accountingMembership,
    docNumber: input.docNumber,
    revision: input.revision,
    memo: input.memo,
    entry: input.entry,
    resolvedLines: input.resolvedLines,
    assertions: input.assertions,
    // Only ever present with content: `[]` and `undefined` both mean "no forks",
    // and storing one spelling keeps the jsonb honest about it.
    reasons: input.reasons && input.reasons.length > 0 ? input.reasons : undefined,
  }
}

/**
 * Read the reasons off a stored envelope, LENIENTLY.
 *
 * Unlike {@link parsePostingDraft} this never throws: a reason is an explanation
 * beside the entry, not a number the next close computes from, so an envelope
 * that predates the field, or one somebody hand-edited, reads as "no reasons"
 * rather than stopping a reversal. Every entry is checked for shape and the
 * malformed ones are dropped one by one.
 */
export function readDraftReasons(value: unknown): PostingReason[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.reasons)) return undefined
  const reasons: PostingReason[] = []
  for (const item of value.reasons) {
    if (!isRecord(item)) continue
    const { line, sentence } = item
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) continue
    if (typeof sentence !== 'string' || sentence.length === 0) continue
    reasons.push({ line, sentence })
  }
  return reasons.length > 0 ? reasons : undefined
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
    accountingMembership:
      value.accountingMembership == null
        ? undefined
        : parsePostingAccountingMembership(value.accountingMembership),
    docNumber: String(value.docNumber ?? ''),
    revision: typeof value.revision === 'number' ? value.revision : 0,
    memo: typeof value.memo === 'string' ? value.memo : undefined,
    entry: value.entry as BuiltEntry,
    resolvedLines: Array.isArray(value.resolvedLines)
      ? (value.resolvedLines as PostingDraftV1['resolvedLines'])
      : [],
    assertions: parsedAssertions,
    reasons: readDraftReasons(value),
  }
}
