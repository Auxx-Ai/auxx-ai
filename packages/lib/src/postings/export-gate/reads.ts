// packages/lib/src/postings/export-gate/reads.ts
//
// The PRE-EXPORT RECONCILIATION GATE
// (plans/accounting/tasks/53-two-modes-one-ledger.md D12, §2.1, §8 risk 1).
//
// ── What this is, and what it is not ────────────────────────────────────────
//
// 🛑 It is NOT a standing comparison of two general ledgers. D12 settled that:
// the internal ledger is checked against THE SOURCE and THE BANK, before
// anything is sent, and the only two-GL surface that ever needs comparing is the
// one the firm itself authors - a different unit. Divergence WE cause is
// prevented here; divergence THEY cause is detected elsewhere.
//
// ⚠️ And it is not a compliance checkbox. The teardown of the market leader
// (`~/Sites/competition/synder/`) found no destination comparison anywhere and a
// rollback that is a DELETE LIST rather than a diff, with the product telling
// the user to clean up by hand afterwards. An earlier draft of 53 §2.1 excused
// that by saying nothing else writes to their QuickBooks; MK corrected it -
// *"not true about synder. people also write in quickbooks stuff."* Their
// customers have bookkeepers in the file too. So this is a place we are ahead,
// not a tax we are paying.
//
// ── The three questions ─────────────────────────────────────────────────────
//
// | check | asks | severity |
// | --- | --- | --- |
// | `entry_balance` | does this entry tie, and does it have lines | block |
// | `source_completeness` | does the month this entry SUMMARISES still owe the ledger work | block |
// | `bank_reconciliation` | is the cash account it moves reconciled to the bank | warn |
//
// 🔑 Only the first two block, and the reason is D11 plus §7.4.1 consequence
// (4): re-delivery works by DELETING the provider's copy, and a period the
// provider has since closed cannot be re-delivered at all. Sending a figure we
// already know will change is therefore not merely untidy, it can be
// unrecoverable. Everything else warns - see `findings.ts` for why an
// unreconciled bank must not stop a send.
//
// ── Fail OPEN, deliberately ─────────────────────────────────────────────────
//
// 🛑 A check whose read fails produces NO findings and is named in
// `report.unavailable`. It does not refuse. A gate that failed closed on a flaky
// subledger read would stop every export in the organization for a reason that
// has nothing to do with the books - and the queue's whole purpose is to be
// cleared. The honesty lives in `unavailable`: a caller can tell "checked and
// fine" from "never asked", which is the same rule `countIncompleteRevenue`
// follows by returning `null` rather than `0`.
//
// ── Nothing is written ──────────────────────────────────────────────────────
//
// The gate is evaluated at the moment of asking and stored nowhere. There is no
// "verified" stamp on `GlPosting`, and adding one would be a schema change this
// unit does not need: a stamp is only true until the next shipment lands, so a
// check that is cheap to re-run is worth more than a flag that goes stale.
//
// No permission checks. The router asserts (`docs/lib-module-guide.md` §6).

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { BankAccountRow } from '../../banking/client'
import { listBankAccounts } from '../../banking/reads'
import { readQueueStats } from '../../banking/review/reads'
import { countUnissuedChannelCreditMemos } from '../../money/credit-memos/reads'
import { type CloseBlockerItem, describeIncompleteRevenue } from '../close-blockers'
import { periodMonth } from '../periods'
import type { SyncQueueRow } from '../types'
import { listFailedExports, verifyBooksBalance } from '../verify-balance'
import {
  claimedSourceStreams,
  describeBankCoverageGap,
  describeUnbalancedEntry,
  describeUnreviewedBankLines,
  exportGateMessage,
  exportGateStatus,
  liftCloseBlockerItem,
} from './findings'
import { guard } from './guard'
import type {
  ExportGateCheck,
  ExportGateFinding,
  ExportGateReport,
  ExportGateVerdict,
} from './types'

/**
 * How many posting ids go into one `IN (…)` list.
 *
 * The queue is deliberately unbounded (`listFailedExports` has no limit and its
 * whole point is a backlog that spans months), so the one query this module adds
 * has to survive an operator asking about all of it. Chunking is the cheap
 * answer; capping would mean postings silently receiving no verdict, and no
 * verdict reads as "clear".
 */
const ID_CHUNK = 500

/** What to evaluate. Both fields narrow; neither is required. */
export interface EvaluateExportGateInput {
  /**
   * Restrict to these postings. Omit to evaluate the whole sync queue.
   *
   * ⚠️ An id that is not in the queue - already exported, `not_required`, or
   * gone - simply gets no verdict. That is correct rather than lax: nothing the
   * gate could say about a posting that is already in the provider's books would
   * change anything, and `releaseExportsForSync` has its own answer for each of
   * those cases.
   */
  glPostingIds?: string[]
  /** Bound the queue read by accounting MONTH, inclusive. `'2026-08'`. */
  through?: string
}

/**
 * Check the internal ledger against the source and the bank, per posting,
 * BEFORE anything is sent.
 *
 * Reuses the reads that already exist rather than opening a parallel one:
 * `listFailedExports` supplies the candidate set (it is already the sync
 * queue's own read, so the gate and the queue cannot disagree about which rows
 * exist), `verifyBooksBalance` supplies the balance half, and the three
 * subledger counts behind `describeIncompleteRevenue` supply the source half -
 * the same three the close refuses on, so a month that blocks a close and a
 * month that blocks a send say the identical sentence.
 *
 * The one new query is the posting-to-GL-account map for the bank half, and it
 * is new because nothing existing answers it: `readTrialBalance` aggregates
 * across postings by date range, and a gate has to speak about one row.
 *
 * @param db Pool or transaction.
 * @param organizationId Scope. Applied in SQL on every read.
 * @param input What to evaluate. Defaults to the whole queue.
 * @returns A verdict per posting, plus the checks that never ran.
 */
export async function evaluateExportGate(
  db: Database,
  organizationId: string,
  input: EvaluateExportGateInput = {}
): Promise<Result<ExportGateReport, Error>> {
  return guard(
    async () => {
      const queue = await listFailedExports(db, organizationId, { through: input.through })
      if (queue.isErr()) throw queue.error

      const wanted = input.glPostingIds ? new Set(input.glPostingIds) : null
      const candidates = wanted
        ? queue.value.filter((row) => wanted.has(row.glPostingId))
        : queue.value

      const unavailable: ExportGateCheck[] = []
      if (candidates.length === 0) {
        return emptyReport(unavailable)
      }

      const unbalanced = await readUnbalancedPostingIds(db, organizationId, unavailable)
      const completeness = await readCompletenessItems(db, organizationId, candidates, unavailable)
      const bank = await readBankFindings(db, organizationId, candidates, unavailable)

      const verdicts = candidates.map((row) =>
        judge(row, {
          unbalanced,
          completeness,
          bank,
        })
      )

      return {
        checkedAt: new Date().toISOString(),
        postingsChecked: verdicts.length,
        blocked: verdicts.filter((verdict) => verdict.status === 'block').length,
        warned: verdicts.filter((verdict) => verdict.status === 'warn').length,
        verdicts,
        unavailable,
      }
    },
    'Failed to evaluate the pre-export gate',
    { organizationId }
  )
}

/** The answer when there is nothing to judge. Not an error, and not a pass. */
function emptyReport(unavailable: ExportGateCheck[]): ExportGateReport {
  return {
    checkedAt: new Date().toISOString(),
    postingsChecked: 0,
    blocked: 0,
    warned: 0,
    verdicts: [],
    unavailable,
  }
}

/** Everything the three checks found, indexed the way {@link judge} reads it. */
interface GateEvidence {
  /** Posting ids whose lines do not tie, mapped to whether they have lines at all. */
  unbalanced: Map<string, { hasLines: boolean }>
  /** Month key -> the close blockers that month is carrying. */
  completeness: Map<string, CloseBlockerItem[]>
  /** Posting id -> the bank warnings its accounts carry. */
  bank: Map<string, ExportGateFinding[]>
}

/**
 * One posting's verdict, assembled out of evidence gathered once for all of them.
 *
 * PURE given the evidence, which is what makes the whole gate testable without a
 * database: the interesting behaviour is which findings ATTACH to which posting,
 * and that is decided here.
 */
function judge(row: SyncQueueRow, evidence: GateEvidence): ExportGateVerdict {
  const findings: ExportGateFinding[] = []

  const discrepancy = evidence.unbalanced.get(row.glPostingId)
  if (discrepancy) {
    findings.push(describeUnbalancedEntry({ docNumber: row.docNumber ?? '', ...discrepancy }))
  }

  // 🛑 Only the streams this posting type is a CLAIM about. See
  // `CLAIMED_SOURCE_STREAMS` - blocking a manual journal because somebody's
  // shipments are unposted is how a gate earns its way around.
  const streams = claimedSourceStreams(row.postingType)
  if (streams.length > 0) {
    const month = monthOf(row.periodKey)
    const items = month ? (evidence.completeness.get(month) ?? []) : []
    for (const item of items) {
      if (!streams.includes(item.key)) continue
      // Lifted verbatim. `describeIncompleteRevenue` was handed the MONTH as its
      // `periodKey`, so the item's own `ref` is already the month the counts are
      // about rather than the posting's key - which is what the lead reads when
      // it names the period, and why a day-keyed summary names its month.
      findings.push(liftCloseBlockerItem(item, 'source_completeness', 'block'))
    }
  }

  findings.push(...(evidence.bank.get(row.glPostingId) ?? []))

  return {
    glPostingId: row.glPostingId,
    docNumber: row.docNumber ?? '',
    postingType: row.postingType,
    periodKey: row.periodKey,
    status: exportGateStatus(findings),
    findings,
    message: exportGateMessage({
      docNumber: row.docNumber ?? '',
      periodKey: row.periodKey,
      findings,
    }),
  }
}

/**
 * The balance half, straight off the existing sweep.
 *
 * ⚠️ `verifyBooksBalance` is org-wide and unbounded, and that is fine here for
 * the reason its own header gives: at roughly thirty entries a month a full
 * sweep is a few hundred rows a year. Running a second, posting-scoped copy of
 * the same grouped LEFT JOIN would be a parallel implementation of the one
 * guarantee this repo deliberately keeps in exactly one place.
 *
 * No month is passed. The completeness half of that report is per-month and
 * org-wide; this module needs it per posting, and asks for it separately.
 */
async function readUnbalancedPostingIds(
  db: Database,
  organizationId: string,
  unavailable: ExportGateCheck[]
): Promise<Map<string, { hasLines: boolean }>> {
  const balance = await verifyBooksBalance(db, organizationId)
  if (balance.isErr()) {
    unavailable.push('entry_balance')
    return new Map()
  }
  const unbalanced = new Map<string, { hasLines: boolean }>()
  for (const discrepancy of balance.value.discrepancies) {
    unbalanced.set(discrepancy.glPostingId, {
      hasLines: discrepancy.totalDebitMinor !== 0 || discrepancy.totalCreditMinor !== 0,
    })
  }
  return unbalanced
}

/**
 * The source half: what each relevant MONTH still owes the ledger.
 *
 * Counted once per distinct month rather than once per posting - a queue holding
 * forty August fulfillments asks the three subledger counts once, not a hundred
 * and twenty times.
 *
 * ⚠️ A month is only counted when some candidate posting is a CLAIM about it
 * (`claimedSourceStreams`). A queue of nothing but manual journals reaches no
 * subledger at all, and the check is recorded neither as run nor as unavailable:
 * it is not applicable, which is a third thing.
 */
async function readCompletenessItems(
  db: Database,
  organizationId: string,
  candidates: readonly SyncQueueRow[],
  unavailable: ExportGateCheck[]
): Promise<Map<string, CloseBlockerItem[]>> {
  const months = new Set<string>()
  for (const row of candidates) {
    if (claimedSourceStreams(row.postingType).length === 0) continue
    const month = monthOf(row.periodKey)
    if (month) months.add(month)
  }

  const byMonth = new Map<string, CloseBlockerItem[]>()
  let failed = false

  for (const month of months) {
    // `shipments` and `unposted` are pinned at 0: both avenues post eagerly
    // now (step 1b, TARGET §1), so there is no batch/effect backlog left to
    // count. TODO(step 3): the export gate is rewritten onto export batches;
    // this whole read goes with it.
    const shipments = 0
    const unposted = 0
    let drafts: number | null = null
    try {
      drafts = await countUnissuedChannelCreditMemos(db, { organizationId, month })
    } catch {
      drafts = null
    }

    // 🛑 A failing draft count makes the whole month's answer partial, so the
    // check is declared unavailable rather than reported with a hole in it.
    if (drafts === null) {
      failed = true
      continue
    }

    byMonth.set(
      month,
      describeIncompleteRevenue({
        periodKey: month,
        shipments,
        draftChannelMemos: drafts,
        unpostedCreditMemos: unposted,
      })
    )
  }

  if (failed) unavailable.push('source_completeness')
  return byMonth
}

/**
 * The bank half: is the cash account this posting moves reconciled?
 *
 * 🔑 The only bridge from a bank account to the ledger is
 * `BankAccountRow.glAccountId` - a plain text id, no foreign key - so the
 * question is answered by finding which of a posting's line accounts a bank
 * account claims, and asking that account's review queue how it is doing.
 *
 * ⚠️ An organization with no bank account mapped to a GL account has an
 * UNANSWERED bank question, not a reconciled one, and lands in `unavailable`.
 * An org that has never run the entity migration behind `bank_account` reads as
 * empty rather than erroring, which is exactly the shape that would otherwise
 * report a green gate for a check that cannot run at all.
 */
async function readBankFindings(
  db: Database,
  organizationId: string,
  candidates: readonly SyncQueueRow[],
  unavailable: ExportGateCheck[]
): Promise<Map<string, ExportGateFinding[]>> {
  const accounts = await listBankAccounts(db, { organizationId })
  if (accounts.isErr()) {
    unavailable.push('bank_reconciliation')
    return new Map()
  }

  const byGlAccount = new Map<string, BankAccountRow>()
  for (const account of accounts.value) {
    if (account.glAccountId) byGlAccount.set(account.glAccountId, account)
  }
  if (byGlAccount.size === 0) {
    unavailable.push('bank_reconciliation')
    return new Map()
  }

  const touched = await readTouchedBankAccounts(
    db,
    organizationId,
    candidates.map((row) => row.glPostingId),
    byGlAccount
  )
  if (touched.size === 0) return new Map()

  // Deduped by account id, not by object identity: two GL accounts pointing at
  // one bank account would otherwise ask its review queue twice.
  const distinct = new Map<string, BankAccountRow>()
  for (const list of touched.values()) {
    for (const account of list) distinct.set(account.id, account)
  }

  const findingsByAccount = new Map<string, ExportGateFinding[]>()
  let failed = false
  for (const account of distinct.values()) {
    const stats = await readQueueStats(db, { organizationId, bankAccountId: account.id })
    if (stats.isErr()) {
      failed = true
      continue
    }
    const name = account.name ?? 'this bank account'
    const findings: ExportGateFinding[] = []
    if (stats.value.unreviewedCount > 0) {
      findings.push(
        describeUnreviewedBankLines({
          bankAccountId: account.id,
          bankAccountName: name,
          unreviewedCount: stats.value.unreviewedCount,
          oldestUnreviewedDate: stats.value.oldestUnreviewedDate,
        })
      )
    }
    if (stats.value.coverageGapCount > 0) {
      findings.push(
        describeBankCoverageGap({
          bankAccountId: account.id,
          bankAccountName: name,
          gapCount: stats.value.coverageGapCount,
        })
      )
    }
    findingsByAccount.set(account.id, findings)
  }
  if (failed) unavailable.push('bank_reconciliation')

  const byPosting = new Map<string, ExportGateFinding[]>()
  for (const [glPostingId, accountsTouched] of touched) {
    const findings = accountsTouched.flatMap((account) => findingsByAccount.get(account.id) ?? [])
    if (findings.length > 0) byPosting.set(glPostingId, findings)
  }
  return byPosting
}

/**
 * Which bank-backed GL accounts each posting touches.
 *
 * The one query this module adds. Narrowed on BOTH sides - the candidate
 * postings and the handful of GL accounts a bank account claims - so it reads a
 * few rows per posting rather than the whole line table, and chunked because the
 * queue has no upper bound.
 */
async function readTouchedBankAccounts(
  db: Database,
  organizationId: string,
  glPostingIds: readonly string[],
  byGlAccount: ReadonlyMap<string, BankAccountRow>
): Promise<Map<string, BankAccountRow[]>> {
  const glAccountIds = [...byGlAccount.keys()]
  const touched = new Map<string, BankAccountRow[]>()

  for (let index = 0; index < glPostingIds.length; index += ID_CHUNK) {
    const chunk = glPostingIds.slice(index, index + ID_CHUNK)
    const rows = await db
      .selectDistinct({
        glPostingId: schema.GlPostingLine.glPostingId,
        glAccountId: schema.GlPostingLine.glAccountId,
      })
      .from(schema.GlPostingLine)
      .where(
        and(
          eq(schema.GlPostingLine.organizationId, organizationId),
          inArray(schema.GlPostingLine.glPostingId, [...chunk]),
          inArray(schema.GlPostingLine.glAccountId, glAccountIds)
        )
      )

    for (const row of rows) {
      const account = byGlAccount.get(row.glAccountId)
      if (!account) continue
      const list = touched.get(row.glPostingId)
      if (list) list.push(account)
      else touched.set(row.glPostingId, [account])
    }
  }

  return touched
}

/**
 * The accounting month a period key sits in, or `null` when it sits in none.
 *
 * `GlPosting.periodKey` may hold a payout or build id rather than a date, and
 * such a row cannot be placed in a month at all. It gets no completeness
 * finding - which is the right direction here, unlike in `listFailedExports`
 * where an unplaceable row is INCLUDED: there, dropping a row hides unfinished
 * work; here, inventing a month would refuse an export on a count that was never
 * about it.
 */
function monthOf(periodKey: string): string | null {
  try {
    return periodMonth(periodKey)
  } catch {
    return null
  }
}
