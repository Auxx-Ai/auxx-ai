// packages/lib/src/postings/provider-agreement.ts
//
// Do our books and theirs agree, and if not, where.
//
// PURE. No database, no provider, no clock, no io. Same inputs in, same answer
// out, forever - the same contract `chart-import-plan.ts` and
// `opening-fill-plan.ts` hold, and for the same reason: this is the piece a
// person has to trust, so it is the piece that must be testable without a
// connection.
//
// 🛑 This renders a COMPARISON. It never becomes a statement source.
// `postings/reports/*` read our own rows and only our own rows (brief 20 §0.7),
// and nothing here changes that. What closes the gap is the sync WRITING rows
// (§5 to §7), not a report learning to read a provider.
//
// @see plans/accounting/tasks/20-two-authors-one-ledger.md §8.2

import { err, ok, type Result } from 'neverthrow'
import { UnprocessableEntityError } from '../errors'
import { accountLabel, compareAccountsByCodeThenName } from './account-label'
import type { TrialBalanceRow } from './reports/trial-balance'
import type { ProviderBalanceRow } from './types'

/**
 * How one account came out of the comparison.
 *
 * `only_theirs` is the interesting one and it is the whole reason brief 20
 * exists: an account the provider carries a balance on that our ledger has
 * never posted to is, by definition, work authored somewhere we do not look.
 */
export type ProviderAgreementStatus = 'match' | 'differs' | 'only_ours' | 'only_theirs'

/**
 * What each status actually asserts, since two of the four are easy to misread:
 *
 * | status | means |
 * |---|---|
 * | `match` | mapped, both sides read, and they agree |
 * | `differs` | mapped, both sides read, and they do not - **including when theirs is a genuine zero** |
 * | `only_ours` | **UNMAPPED.** We hold no provider link, so no comparison was possible. Not "they lack this account" |
 * | `only_theirs` | a provider row nothing on our side claims - the §1 gap, made visible |
 */

/**
 * One account, both sides, debit-positive.
 *
 * 🛑 **Debit-positive on BOTH sides, always.** `ProviderBalanceRow.minorSigned`
 * already arrives that way from the apps-repo tool; our own side is
 * `debitMinor - creditMinor`, NEVER `TrialBalanceRow.balanceMinor`, which is
 * natural-sign and would invert every liability, equity and revenue row against
 * theirs. One convention beats four.
 */
export interface ProviderAgreementRow {
  /** Our `gl_account` instance id. `null` only when the provider row is unmapped. */
  glAccountId: string | null
  /**
   * Their `Account.Id`. `null` when we hold no link for this account.
   *
   * ⚠️ **That is "we cannot name their account", not "they do not have one."**
   * An unmapped account of ours may well exist over there under a name nothing
   * has joined it to; the comparison cannot see the difference and must not
   * claim to. {@link ProviderAgreementRow.status} carries the observable fact.
   */
  providerAccountId: string | null
  /** Our current code when we know the account, else null. */
  accountCode: string | null
  /** Our name when we know the account, otherwise the provider's rendered name. */
  accountName: string
  /** Debit-positive minor units, our side. `0` for `only_theirs`. */
  oursMinor: number
  /**
   * Debit-positive minor units, their side. `0` for `only_ours`.
   *
   * ⚠️ `0` here does NOT imply `only_ours`. The provider emits **non-zero rows
   * only**, so a MAPPED account absent from their report has a genuine zero
   * balance over there and is a `differs` with `theirsMinor: 0`. That is a real
   * disagreement worth showing, not a missing account.
   */
  theirsMinor: number
  /** `oursMinor - theirsMinor`. Positive means we carry more debit than they do. */
  differenceMinor: number
  status: ProviderAgreementStatus
}

/**
 * The whole comparison, as of one date.
 *
 * `rows` carries every account either side knows about, including the ones that
 * agree - a screen that only listed differences could not distinguish "they
 * agree" from "we failed to read anything".
 */
export interface ProviderAgreement {
  /** The date both sides were read as of, echoed from the provider's own header. */
  asOf: string
  rows: readonly ProviderAgreementRow[]
  /** Sum of `|differenceMinor|` across every row. `0` means the books agree. */
  totalDifferenceMinor: number
  /** Convenience: `totalDifferenceMinor !== 0`. */
  hasDifferences: boolean
  /**
   * `ProviderBalanceSheet.hasData`, carried through. `false` means the provider
   * answered with an empty company, which must render as its own state and
   * never as "everything agrees" - §8.4's rule, one layer out.
   */
  providerHasData: boolean
}

export interface PlanProviderAgreementInput {
  /** `ProviderBalanceSheet.rows`. `kind: 'net_income'` rows carry no account and are excluded. */
  provider: readonly ProviderBalanceRow[]
  /** `readTrialBalance(...).rows` for the same date, cumulative from the beginning. */
  ours: readonly TrialBalanceRow[]
  /** `glAccountId` -> `providerAccountId`, from the links `chart-import.ts` stamps. */
  accountMap: ReadonlyMap<string, string>
  /** Echoed onto the result. */
  asOf: string
  /** `ProviderBalanceSheet.hasData`. */
  providerHasData: boolean
}

/**
 * Compare a provider's balances against our trial balance, account by account.
 *
 * 🛑 **Builds the inverse map by COLLECTING, not overwriting.** Nothing in the
 * schema enforces that the provider link is one-to-one:
 * `setQuickbooksAccountMapping` writes one cell on one record and never checks
 * whether another `gl_account` already claims the same `providerAccountId`
 * (brief 19 §0.6 found this and it is still unfixed). A provider id claimed by
 * more than one of our accounts is a **refusal naming both**, never a guess
 * about which one the money belongs to.
 *
 * This is the same correction the opening-trial-balance overlay needed one
 * layer over, in the ROLE map, where `set`-per-role silently dropped every
 * inventory role but the last on a shared account (#2112). Collect and sum;
 * never `set` in a loop over something that can repeat.
 *
 * @returns `err` only for a double-claimed provider id. An empty provider
 *   answer is a valid result with `providerHasData: false`, not an error.
 */
export function planProviderAgreement(
  input: PlanProviderAgreementInput
): Result<ProviderAgreement, Error> {
  const { provider, ours, accountMap, asOf, providerHasData } = input

  // Our side, debit-positive, by account id. NEVER `balanceMinor` - that is
  // natural-sign, so it would arrive positive for a liability, an equity or a
  // revenue account and read as the exact negative of theirs on every one of
  // them. `debitMinor - creditMinor` is the one convention both sides share.
  const oursMinorById = new Map<string, number>()
  const ourRowById = new Map<string, TrialBalanceRow>()
  for (const row of ours) {
    oursMinorById.set(
      row.glAccountId,
      (oursMinorById.get(row.glAccountId) ?? 0) + ourDebitPositive(row)
    )
    ourRowById.set(row.glAccountId, row)
  }

  // §8.2: invert the account map by COLLECTING, never `set`-per-iteration.
  // Nothing in the schema stops two of our accounts naming one provider
  // account, and the one thing this must not do is pick a winner.
  const glAccountIdsByProviderId = new Map<string, string[]>()
  for (const [glAccountId, providerAccountId] of accountMap) {
    const claimants = glAccountIdsByProviderId.get(providerAccountId) ?? []
    claimants.push(glAccountId)
    glAccountIdsByProviderId.set(providerAccountId, claimants)
  }
  for (const [providerAccountId, claimants] of glAccountIdsByProviderId) {
    if (claimants.length < 2) continue
    const labels = claimants.map((id) => ourAccountLabel(ourRowById.get(id), id))
    return err(
      new UnprocessableEntityError(
        `Provider account '${providerAccountId}' is mapped from more than one account in your ` +
          `chart: ${labels.join(' and ')}. Fix the extra mapping on the Account map page before ` +
          'comparing - the comparison cannot guess which one the money belongs to.',
        { providerAccountId, glAccountIds: claimants.join(',') }
      )
    )
  }

  // Their side, summed by provider account id. The same collect-and-sum rule:
  // a report that renders one account across two rows must not lose one.
  // `net_income` is computed and carries no account, so it is not comparable
  // and is excluded rather than folded anywhere.
  const theirsMinorById = new Map<string, number>()
  const theirNameById = new Map<string, string>()
  const unidentifiedTheirs: ProviderBalanceRow[] = []
  for (const row of provider) {
    if (row.kind === 'net_income') continue
    if (row.providerAccountId === null) {
      unidentifiedTheirs.push(row)
      continue
    }
    const id = row.providerAccountId
    theirsMinorById.set(id, (theirsMinorById.get(id) ?? 0) + row.minorSigned)
    if (!theirNameById.has(id)) theirNameById.set(id, row.name)
  }

  const rows: ProviderAgreementRow[] = []
  const claimedProviderIds = new Set<string>()

  // Every account of ours that has a trial-balance row, plus every account of
  // ours that is linked to a provider account the report carries - the second
  // is the account we have never posted to, which reads `0` against their
  // balance and is the whole point of the view.
  const ourAccountIds = new Set<string>([...oursMinorById.keys()])
  for (const [glAccountId, providerAccountId] of accountMap) {
    if (theirsMinorById.has(providerAccountId)) ourAccountIds.add(glAccountId)
  }

  for (const glAccountId of ourAccountIds) {
    const ourRow = ourRowById.get(glAccountId)
    const providerAccountId = accountMap.get(glAccountId) ?? null
    const oursMinor = oursMinorById.get(glAccountId) ?? 0
    // A MAPPING is what makes the two sides comparable, not a row in the
    // report: the report carries non-zero rows only, so a mapped account
    // missing from it has a zero balance over there, which is a comparison
    // that came out to a difference rather than an account they lack. Only an
    // UNMAPPED account is `only_ours` - there we genuinely cannot say.
    if (providerAccountId !== null) claimedProviderIds.add(providerAccountId)
    const theirsMinor =
      providerAccountId !== null ? (theirsMinorById.get(providerAccountId) ?? 0) : 0
    const differenceMinor = oursMinor - theirsMinor
    rows.push({
      glAccountId,
      providerAccountId,
      accountCode: ourRow?.accountCode ?? null,
      accountName:
        ourRow?.accountName ||
        (providerAccountId !== null ? (theirNameById.get(providerAccountId) ?? '') : ''),
      oursMinor,
      theirsMinor,
      differenceMinor,
      status:
        providerAccountId === null ? 'only_ours' : differenceMinor === 0 ? 'match' : 'differs',
    })
  }

  // Theirs, unclaimed by any account of ours.
  for (const [providerAccountId, theirsMinor] of theirsMinorById) {
    if (claimedProviderIds.has(providerAccountId)) continue
    rows.push({
      glAccountId: null,
      providerAccountId,
      accountCode: null,
      accountName: theirNameById.get(providerAccountId) ?? providerAccountId,
      oursMinor: 0,
      theirsMinor,
      differenceMinor: -theirsMinor,
      status: 'only_theirs',
    })
  }

  // An `account` row with no id is out of the provider contract, but dropping
  // it would silently shrink the difference. It is carried as theirs, named,
  // with both ids null - `status` is what disambiguates it from a row of ours.
  for (const row of unidentifiedTheirs) {
    rows.push({
      glAccountId: null,
      providerAccountId: null,
      accountCode: null,
      accountName: row.name,
      oursMinor: 0,
      theirsMinor: row.minorSigned,
      differenceMinor: -row.minorSigned,
      status: 'only_theirs',
    })
  }

  rows.sort(compareAgreementRows)

  const totalDifferenceMinor = rows.reduce((sum, row) => sum + Math.abs(row.differenceMinor), 0)

  return ok({
    asOf,
    rows,
    totalDifferenceMinor,
    hasDifferences: totalDifferenceMinor !== 0,
    providerHasData,
  })
}

/**
 * 🛑 Debit-positive, from the two raw sums. `TrialBalanceRow.balanceMinor` is
 * natural-sign and is the wrong number here - see {@link ProviderAgreementRow}.
 */
function ourDebitPositive(row: TrialBalanceRow): number {
  return row.debitMinor - row.creditMinor
}

/** How one of our accounts is named in the refusal. Falls back to the raw id. */
function ourAccountLabel(row: TrialBalanceRow | undefined, glAccountId: string): string {
  if (!row || !row.accountName) return glAccountId
  return accountLabel({ code: row.accountCode, name: row.accountName })
}

/**
 * Task 15 §5's one sort - code, then name, uncoded last - with the two ids as
 * a final tiebreak so the order is total. Two accounts may legitimately share
 * a name, and a comparison a person re-runs must come back in the same order.
 */
function compareAgreementRows(a: ProviderAgreementRow, b: ProviderAgreementRow): number {
  const byAccount = compareAccountsByCodeThenName(
    { code: a.accountCode, name: a.accountName },
    { code: b.accountCode, name: b.accountName }
  )
  if (byAccount !== 0) return byAccount
  const byOurs = (a.glAccountId ?? '').localeCompare(b.glAccountId ?? '')
  if (byOurs !== 0) return byOurs
  return (a.providerAccountId ?? '').localeCompare(b.providerAccountId ?? '')
}
