// packages/lib/src/postings/register.ts
//
// The REGISTER, level A: the per-transaction journal we already store, projected
// into something a screen can render
// (plans/accounting/tasks/53-two-modes-one-ledger.md §7.3, decision D16).
//
// PURE. No database, no clock, no io. The db read is `read-register.ts`; this
// file is the projection it hands its rows to, and the reason the two are apart
// is that everything interesting here is a shape question that deserves tests
// without a Postgres.
//
// ── What this is a projection OF ────────────────────────────────────────────
//
// `AccountingEffect.acceptedBasis` already holds an immutable, sha256-hashed,
// independently BALANCED, account-resolved `contribution[]` per transaction
// (`effect-types.ts`: *"Immutable, independently balanced contribution pinned to
// one ready work version."*). That is a register line. It has simply never been
// rendered. So the register is a READ, and level B - writing those
// contributions as `GlPosting`/`GlPostingLine` rows as well - is explicitly NOT
// taken: a DERIVED register appearing in the trial balance double-counts every
// summary it rolls into, and both sides still balance, so nothing detects it
// (§7.3.2).
//
// ── 🛑 Why the parse here is LOOSE, and `effect-types.ts`'s is strict ────────
//
// `acceptedFulfillmentEffectBasisSchema` and its siblings are `strictObject`s
// with cross-field `superRefine`s, and they must stay that way - they are the
// gate an effect passes before it is frozen and hashed. Running one of them on
// the READ path would be a different and much worse contract: a row written
// under an older policy, or under a family D19 has not taught this file about
// yet, would make the whole panel refuse rather than show what it does know.
// A reader is not an admission gate. So this reads STRUCTURALLY - the handful of
// fields every accepted basis has in common - and reports `unreadable` on the
// row rather than throwing.
//
// ⚠️ For the same reason nothing in this file switches on `effectKind` or
// `policyKey`. §7.3.3's D19 gives seven more transaction-driven families an
// `AccountingWork`, and the register is meant to GAIN rows as they land without
// anyone editing this file.

import { z } from 'zod'
import type { CounterpartyType, PostingDirection } from './types'

/** A `documentRef` off the frozen basis: what transaction this effect is about. */
export interface RegisterDocumentRef {
  /**
   * The resource the id belongs to - `order`, `fulfillment`, `credit_memo`,
   * `money_transaction` today. A plain string on purpose: it is whatever the
   * family that wrote the basis called itself, and this file must not hold a
   * list that D19 would have to keep updating.
   */
  resourceKind: string
  entityInstanceId: string
}

/** The account snapshot a register line borrows from the posting it rolls into. */
export interface RegisterAccountLabel {
  accountCode: string | null
  accountName: string | null
}

/** One contribution line: the per-transaction equivalent of a `GlPostingLine`. */
export interface RegisterContributionLine {
  /** The key that ties the contribution to its `accountResolution` entry. */
  lineKey: string
  glAccountId: string
  /**
   * The code/name as they stood WHEN THE SUMMARY POSTED, borrowed from
   * `GlPostingLine`. Null when this contribution's account is not among the
   * summary's lines, which should not happen - `assertExactContributions`
   * refuses an acceptance whose contributions do not aggregate into the lines -
   * and is left visibly empty rather than filled from the live chart.
   */
  accountCode: string | null
  accountName: string | null
  /** The role the resolution recorded, when it named one. */
  accountRole: string | null
  /** Which branch chose the account: `route`, `org_role`, `tax_mapping`, … */
  selectedBy: string | null
  direction: PostingDirection
  /** Integer minor units, always > 0. `direction` is the only carrier of sign. */
  amountMinor: number
  counterpartyType: CounterpartyType | null
  counterpartyId: string | null
  dimensions: Record<string, string> | null
}

/** One member effect of a summary posting - one register row. */
export interface RegisterEntry {
  effectId: string
  workId: string
  /**
   * `AccountingWork.effectKind`. Typed as a plain string deliberately: D19 adds
   * seven families and a union here would make each of them a change to a
   * read-only view.
   */
  effectKind: string
  effectKey: string
  /** `original` or `correction` - the only edit path a frozen basis has. */
  operation: string
  componentKey: string
  basisVersion: number
  basisHash: string
  /** `YYYY-MM-DD`, off the column. Never re-derived. */
  effectiveDate: string
  currency: string
  /** The frozen policy that produced the contribution. Null when unreadable. */
  policyKey: string | null
  /**
   * D13's reserved basis dimension. `null` on every row written so far -
   * `basis-dimension.ts` reserves the field and nothing writes it yet - and it
   * is surfaced rather than dropped because §7.3.2's level C (the cash book)
   * is exactly this projection with that field populated.
   */
  basis: 'accrual' | 'cash' | null
  documentRefs: RegisterDocumentRef[]
  lines: RegisterContributionLine[]
  /** Debit total in minor units. Equals the credit total: the basis balances. */
  totalMinor: number
  /**
   * The stored basis could not be read structurally, so `lines` and
   * `documentRefs` are empty BECAUSE OF THAT and not because the effect has
   * none. The two readings must never be shown as the same thing.
   */
  unreadable: boolean
}

/** Every member effect of one summary posting, plus what the summary itself says. */
export interface PostingRegister {
  glPostingId: string
  currency: string
  /** The summary's own recorded total. Not a sum of anything below. */
  postingTotalMinor: number
  /**
   * The member effects, oldest accounting date first.
   *
   * 🛑 EMPTY is a legitimate answer, not a failure. §7.3.3: seven posting
   * families have no upstream transaction at all - a manual journal, an opening
   * balance, a `provider_sync` row authored in the provider - and for those the
   * posting IS the register row, 1:1. The register is the UNION of
   * per-transaction effects and standalone postings.
   */
  entries: RegisterEntry[]
  /** Debits summed across the member effects. `0` when there are none. */
  totalMinor: number
}

/** The raw shape `read-register.ts` reads, before projection. */
export interface RegisterEffectRow {
  effectId: string
  workId: string
  effectKind: string
  effectKey: string
  operation: string
  componentKey: string
  basisVersion: number
  basisHash: string
  effectiveDate: string
  currency: string
  /** The jsonb column, verbatim and unparsed. */
  acceptedBasis: unknown
}

/**
 * The common spine of every accepted basis. Non-strict on purpose: `calculation`
 * and everything else family-specific is stripped rather than refused, and the
 * whole `calculation` blob is deliberately NOT carried to a browser - it is the
 * largest thing in the row and a register does not render it.
 */
const registerBasisSchema = z.object({
  policyKey: z.string().min(1).optional(),
  basis: z.enum(['accrual', 'cash']).optional(),
  documentRefs: z
    .array(z.object({ resourceKind: z.string().min(1), entityInstanceId: z.string().min(1) }))
    .optional(),
  accountResolution: z
    .array(
      z.object({
        lineKey: z.string().min(1),
        glAccountId: z.string().min(1),
        accountRole: z.string().nullish(),
        selectedBy: z.string().nullish(),
      })
    )
    .optional(),
  contribution: z
    .array(
      z.object({
        lineKey: z.string().min(1),
        glAccountId: z.string().min(1),
        direction: z.enum(['debit', 'credit']),
        amountMinor: z.union([z.string(), z.number()]),
        counterpartyType: z.enum(['customer', 'vendor']).nullish(),
        counterpartyId: z.string().nullish(),
        dimensions: z.record(z.string(), z.string()).nullish(),
      })
    )
    .min(1),
})

/**
 * Minor units off a basis that stores them as a decimal STRING.
 *
 * Returns `null` rather than `NaN` or `0` for anything that is not a whole,
 * non-negative, safe integer. A zero would render as a real line worth nothing,
 * which is the one answer a register must not invent; `null` promotes the whole
 * entry to `unreadable` instead.
 */
function toMinor(value: string | number): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null
  return parsed
}

/**
 * One member effect, projected for rendering.
 *
 * @param row the effect joined to its work, straight off the read.
 * @param accountLabels `glAccountId` → the code/name SNAPSHOT carried on the
 *   summary's own `GlPostingLine` rows. Optional: a caller with no summary to
 *   borrow from gets unlabelled lines rather than a join to the live chart,
 *   which would restate history the moment somebody renames an account (the
 *   rule `read-posting.ts` keeps for the same reason).
 */
export function projectRegisterEntry(
  row: RegisterEffectRow,
  accountLabels?: ReadonlyMap<string, RegisterAccountLabel>
): RegisterEntry {
  const base = {
    effectId: row.effectId,
    workId: row.workId,
    effectKind: row.effectKind,
    effectKey: row.effectKey,
    operation: row.operation,
    componentKey: row.componentKey,
    basisVersion: row.basisVersion,
    basisHash: row.basisHash,
    effectiveDate: row.effectiveDate,
    currency: row.currency,
  }
  const unreadable: RegisterEntry = {
    ...base,
    policyKey: null,
    basis: null,
    documentRefs: [],
    lines: [],
    totalMinor: 0,
    unreadable: true,
  }

  const parsed = registerBasisSchema.safeParse(row.acceptedBasis)
  if (!parsed.success) return unreadable

  const resolutions = new Map(
    (parsed.data.accountResolution ?? []).map((resolution) => [resolution.lineKey, resolution])
  )

  const lines: RegisterContributionLine[] = []
  let totalMinor = 0
  for (const contribution of parsed.data.contribution) {
    const amountMinor = toMinor(contribution.amountMinor)
    // 🛑 One unreadable amount discards the WHOLE entry rather than the line.
    // A register row missing one of its own contributions still balances
    // nowhere and still shows a total - it would read as a smaller, complete
    // transaction, which is worse than declining to read it.
    if (amountMinor === null) return unreadable
    const resolution = resolutions.get(contribution.lineKey)
    const label = accountLabels?.get(contribution.glAccountId)
    lines.push({
      lineKey: contribution.lineKey,
      glAccountId: contribution.glAccountId,
      accountCode: label?.accountCode ?? null,
      accountName: label?.accountName ?? null,
      accountRole: resolution?.accountRole ?? null,
      selectedBy: resolution?.selectedBy ?? null,
      direction: contribution.direction,
      amountMinor,
      counterpartyType: contribution.counterpartyType ?? null,
      counterpartyId: contribution.counterpartyId ?? null,
      dimensions: contribution.dimensions ?? null,
    })
    if (contribution.direction === 'debit') totalMinor += amountMinor
  }

  return {
    ...base,
    policyKey: parsed.data.policyKey ?? null,
    basis: parsed.data.basis ?? null,
    documentRefs: parsed.data.documentRefs ?? [],
    lines,
    totalMinor,
    unreadable: false,
  }
}

/**
 * Debits across every member effect.
 *
 * ⚠️ Compared against the summary's own `postingTotalMinor` by the panel, and
 * only when there is at least one entry. With no entries the two figures are
 * answering different questions - a 1:1 posting has no register members and its
 * zero here means "none", never "short by the whole amount".
 */
export function registerTotalMinor(entries: readonly RegisterEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.totalMinor, 0)
}

/**
 * Whether the members add up to the summary they are members of.
 *
 * `null` when there is nothing to compare - no entries, or an entry whose basis
 * could not be read, in which case a "does not tie" verdict would be describing
 * this file's own blind spot rather than the books.
 */
export function registerTiesToPosting(register: PostingRegister): boolean | null {
  if (register.entries.length === 0) return null
  if (register.entries.some((entry) => entry.unreadable)) return null
  return register.totalMinor === register.postingTotalMinor
}
