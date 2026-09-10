// packages/lib/src/postings/provider-sync/plan.ts
//
// The PURE half of the inbound sync: given one chunk of a provider's general
// ledger, our own exported entries and the account map, decide what to write,
// what to check and what to refuse to touch.
//
// PURE. No database, no provider, no clock, no io. Same inputs in, same answer
// out, forever - the contract `chart-import-plan.ts`, `opening-fill-plan.ts`
// and `provider-agreement.ts` hold, and for the same reason: this is the piece
// a person has to trust, so it is the piece that must be testable without a
// connection.
//
// Two things in this file can destroy a set of books, and both are silent:
//
//  1. 🛑 **Letting one of our own entries through into `theirs`.** The general
//     ledger report contains every journal entry auxx has ever pushed. Writing
//     one back doubles it, both copies balance, every statement still ties, and
//     nothing downstream can detect it. {@link isOurs} is the guard and
//     `__tests__/provider-sync-excludes-our-own.test.ts` is the test.
//  2. 🛑 **Writing one line per report ROW.** A row is one journal LINE. The
//     2026-09-10 sandbox is 336 emitted rows and 128 transactions; one posting
//     per row is 336 single-sided postings instead of 128 balanced entries.
//
// @see plans/accounting/tasks/20-two-authors-one-ledger.md §5.2, §5.3

import { formatCurrency } from '@auxx/utils'
import { err, ok, type Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import { accountLabel } from '../account-label'
import type { GlPostingLineInput } from '../types'
import {
  isOurs,
  type OurEntryCheck,
  type OurPostedEntry,
  type OurPostedLine,
  PROVIDER_SYNC_SOURCE_TYPE,
  type ProviderLedger,
  type ProviderLedgerEntry,
  type ProviderLedgerLine,
  type ProviderSyncPlan,
} from './client'

export interface PlanProviderSyncInput {
  /** One chunk of their general ledger, exactly as the provider answered. */
  ledger: ProviderLedger
  /**
   * 🛑 **Every `GlPosting.providerEntryId` this org holds for an entry AUXX
   * AUTHORED.** Completeness is the whole safety property: an id missing from
   * this set is an entry of ours that gets written back as though it were
   * theirs. `reads.ts`'s `readOurProviderEntryIds` is the query.
   */
  ourProviderEntryIds: ReadonlySet<string>
  /**
   * Our own copies of the entries being checked (§5.3): every exported entry
   * whose id appears in this chunk, PLUS every exported entry dated inside the
   * chunk. The second half is what makes a `'missing'` verdict possible at all.
   */
  ourEntries: readonly OurPostedEntry[]
  /**
   * `glAccountId -> providerAccountId`, the links `chart-import.ts` stamps.
   * Their side of the comparison is keyed by provider account id and ours by
   * `glAccountId`, so this is what brings the two into one keyspace.
   */
  accountMap: ReadonlyMap<string, string>
}

/**
 * Group a chunk's rows into entries, partition them by authorship, check ours
 * and hand back everything that is theirs.
 *
 * 🛑 **An unbalanced entry never reaches `theirs`.** It lands in `unbalanced`
 * instead, unwritten. An unbalanced entry in the ledger is worse than a missing
 * one: a missing entry makes a statement wrong by a nameable amount, while an
 * unbalanced one breaks every statement that ties and gives a reader no way to
 * find out why.
 *
 * 🛑 **A mismatch on one of OUR entries is REPORTED, never repaired.** There is
 * deliberately no path here that restates our posting from theirs, re-pushes
 * ours over theirs, or picks a winner in any other way. Each of those makes one
 * entry answer to two authors, which is exactly what §3.1's single-writer rule
 * exists to prevent (§11.1 refused both on principle, and §12.13 records that
 * this is the one default that is not reversible).
 *
 * @returns `err` only when one provider account is claimed by more than one of
 *   our accounts - see {@link invertAccountMap}. An empty chunk is a valid plan
 *   with three empty lists, not an error.
 */
export function planProviderSync(input: PlanProviderSyncInput): Result<ProviderSyncPlan, Error> {
  const { ledger, ourProviderEntryIds, ourEntries, accountMap } = input

  const inverted = invertAccountMap(accountMap, labelIndex(ourEntries))
  if (inverted.isErr()) return err(inverted.error)
  const glAccountIdByProviderId = inverted.value

  const entries = groupProviderLedgerEntries(ledger.lines)

  const theirs: ProviderLedgerEntry[] = []
  const unbalanced: ProviderLedgerEntry[] = []
  const oursByProviderEntryId = new Map<string, ProviderLedgerEntry>()

  for (const entry of entries) {
    // 🛑 Authorship first, ALWAYS. Keyed on the (type, id) PAIR, never the id
    // alone: their ids are per entity type in Intuit's model, and a `Purchase`
    // sharing an id with one of our `JournalEntry` rows would otherwise drop a
    // real expense silently (§4.5).
    if (isOurs(entry, ourProviderEntryIds)) {
      oursByProviderEntryId.set(entry.txnId, entry)
      continue
    }
    // Balance second. An unbalanced entry is never a write candidate, whatever
    // else is true about it.
    if (!entry.balanced) {
      unbalanced.push(entry)
      continue
    }
    theirs.push(entry)
  }

  const ours = checkOurEntries({
    ourEntries,
    theirs: oursByProviderEntryId,
    glAccountIdByProviderId,
    from: ledger.from,
    to: ledger.to,
  })

  return ok({ from: ledger.from, to: ledger.to, theirs, ours, unbalanced })
}

/**
 * Fold report ROWS into entries, one per `(txnType, txnId)`.
 *
 * 🛑 The single most important structural fact in the spike (§4.4): one row is
 * one journal LINE. Grouping by the pair - not by the id, not by the document
 * number, which is null on most rows and duplicated across others - is what
 * reconstructs a balanced entry.
 *
 * 🛑 **Zero-amount rows are KEPT.** §4.7 suggests dropping them as a
 * convenience and it is wrong: nine of the sandbox's 336 lines carry no money
 * in either column (the Inventory Qty Adjust opening rows, BOTH legs), and
 * dropping them deletes transactions 110-113 outright - 124 entries instead of
 * 128. A zero LEG is dropped much later, by the writer, because `buildEntry`
 * refuses one and says so ("drop it upstream"); an entry that is zero on both
 * sides is a non-event `sync.ts` skips without refusing. Neither decision
 * belongs here, whose only job is reconstructing what their report said.
 *
 * ⚠️ **A row with no transaction id is DROPPED, and it is the only drop this
 * function makes.** A "Beginning Balance" row typically carries none, and there
 * is nothing to group one on: the alternative to dropping it is inventing a
 * key, which mints an entry the provider does not have. The apps-repo mapper
 * already skips these with a warning, so one arriving here means that skip
 * regressed. 🔴 Unverified against a real mid-range call - the saved fixture
 * starts in 2015, which predates all of the company's data, so it contains no
 * beginning-balance rows at all.
 *
 * Entry order follows first appearance, and line order follows the report, so
 * a re-read of the same range plans in the same order.
 */
export function groupProviderLedgerEntries(
  lines: readonly ProviderLedgerLine[]
): ProviderLedgerEntry[] {
  const byKey = new Map<string, ProviderLedgerEntry>()

  for (const line of lines) {
    if (line.txnId.trim().length === 0 || line.txnType.trim().length === 0) continue

    // NUL cannot occur in either half, so the composite key cannot be forged
    // by a transaction type whose name happens to contain the separator.
    const key = `${line.txnType}\u0000${line.txnId}`
    let entry = byKey.get(key)
    if (!entry) {
      entry = {
        txnType: line.txnType,
        txnId: line.txnId,
        txnDate: line.txnDate,
        docNumber: line.docNumber,
        lines: [],
        totalDebitMinor: 0,
        totalCreditMinor: 0,
        balanced: true,
      }
      byKey.set(key, entry)
    }
    entry.lines.push(line)
    entry.totalDebitMinor += line.debitMinor
    entry.totalCreditMinor += line.creditMinor
    // The report renders a document number on some rows of an entry and not
    // others, so the first non-null one wins rather than the last row's null
    // overwriting it.
    if (entry.docNumber === null && line.docNumber !== null) entry.docNumber = line.docNumber
  }

  const entries = [...byKey.values()]
  for (const entry of entries) {
    entry.balanced = entry.totalDebitMinor === entry.totalCreditMinor
  }
  return entries
}

/**
 * Invert `glAccountId -> providerAccountId` into `providerAccountId ->
 * glAccountId`.
 *
 * 🛑 **Built by COLLECTING, not by `set`-ting in a loop.** Nothing in the schema
 * enforces that the provider link is one-to-one: `setQuickbooksAccountMapping`
 * writes one cell on one record and never checks whether another `gl_account`
 * already claims the same `providerAccountId` (brief 19 §0.6 found this and it
 * is still unfixed). A provider id claimed by more than one of our accounts is
 * a **refusal naming both**, never a guess about which one the money belongs
 * to - the same call `provider-agreement.ts` makes one layer over, and the same
 * correction the role map needed (#2112) where `set`-per-role silently dropped
 * every inventory role but the last on a shared account.
 *
 * Here the stakes are higher than a comparison's: a guess would post a real
 * entry of the accountant's into the wrong account, balanced, and nothing
 * downstream would say so.
 *
 * @param labels how to name one of our accounts in the refusal, by id.
 */
export function invertAccountMap(
  accountMap: ReadonlyMap<string, string>,
  labels: ReadonlyMap<string, string> = new Map()
): Result<Map<string, string>, Error> {
  const claimantsByProviderId = new Map<string, string[]>()
  for (const [glAccountId, providerAccountId] of accountMap) {
    const claimants = claimantsByProviderId.get(providerAccountId) ?? []
    claimants.push(glAccountId)
    claimantsByProviderId.set(providerAccountId, claimants)
  }

  const inverted = new Map<string, string>()
  for (const [providerAccountId, claimants] of claimantsByProviderId) {
    if (claimants.length > 1) {
      const named = claimants.map((id) => labels.get(id) ?? id)
      return err(
        new UnprocessableEntityError(
          `Provider account '${providerAccountId}' is mapped from more than one account in your ` +
            `chart: ${named.join(' and ')}. Fix the extra mapping on the Account map page before ` +
            'syncing - a synced entry cannot guess which one the money belongs to.',
          { providerAccountId, glAccountIds: claimants.join(',') }
        )
      )
    }
    inverted.set(providerAccountId, claimants[0]!)
  }
  return ok(inverted)
}

/**
 * Turn one of their entries' lines into ours, or refuse naming every provider
 * account that stopped it.
 *
 * 🛑 **An unmapped provider account is a REFUSAL naming it - never a guess and
 * never a fallback account.** A guess that lands on a real account produces an
 * entry that balances and is wrong, and nothing downstream can detect it. This
 * is the same rule `G19` states for the outbound direction ("never guess: there
 * is no default-account fallback"), read backwards.
 *
 * Batched on purpose: an entry naming three unmapped accounts refuses once
 * naming three, the way `resolveAccountLines` refuses a role. Fixing one
 * mapping and rediscovering the next on the following run is the shape of
 * refusal that makes people stop reading them.
 *
 * ⚠️ **The line invariant is "never BOTH non-zero", not "exactly one
 * non-zero".** Nine of the sandbox's 336 rows carry no money in either column -
 * both legs of the Inventory Qty Adjust opening entries - so an exclusivity
 * check would refuse four real transactions. A zero LEG is dropped HERE rather
 * than at grouping, because `buildEntry` refuses a zero-amount line and says
 * "drop it upstream", while grouping has to keep the row or those four
 * transactions disappear entirely. Both columns populated on one row is a
 * different thing: the report cannot render it, so it means the mapper is
 * wrong, and it refuses.
 *
 * @param glAccountIdByProviderId from {@link invertAccountMap}, so a
 *   double-claimed provider id has already been refused before this is reached.
 */
export function resolveProviderSyncLines(
  entry: ProviderLedgerEntry,
  glAccountIdByProviderId: ReadonlyMap<string, string>
): Result<GlPostingLineInput[], Error> {
  const unmapped: string[] = []
  const malformed: string[] = []
  const lines: GlPostingLineInput[] = []

  entry.lines.forEach((line, index) => {
    if (line.debitMinor > 0 && line.creditMinor > 0) {
      malformed.push(
        `${line.providerAccountName || line.providerAccountId} carries a debit and a credit on ` +
          'one line'
      )
      return
    }
    // A leg that moves nothing. Dropped, not refused, and not counted as
    // unmapped either - the account it names may be one we have never linked,
    // and refusing a whole transaction over a leg worth nothing would take out
    // the four Inventory Qty Adjust entries on every run, forever.
    if (line.debitMinor === 0 && line.creditMinor === 0) return
    const glAccountId = glAccountIdByProviderId.get(line.providerAccountId)
    if (!glAccountId) {
      unmapped.push(
        `'${line.providerAccountId}'${line.providerAccountName ? ` (${line.providerAccountName})` : ''}`
      )
      return
    }
    lines.push({
      glAccountId,
      direction: line.debitMinor > 0 ? 'debit' : 'credit',
      amount: line.debitMinor > 0 ? line.debitMinor : line.creditMinor,
      memo: line.memo ?? undefined,
      // The audit pair: which transaction on their side produced this line.
      sourceType: PROVIDER_SYNC_SOURCE_TYPE,
      sourceId: entry.txnId,
      sortOrder: index,
    })
  })

  if (malformed.length > 0) {
    return err(
      new UnprocessableEntityError(
        `${entry.txnType} ${entry.txnId} could not be read: ${malformed.join('; ')}. A general ` +
          'ledger row never populates both money columns at once.',
        { txnId: entry.txnId, txnType: entry.txnType }
      )
    )
  }
  if (unmapped.length > 0) {
    return err(
      new UnprocessableEntityError(
        `${entry.txnType} ${entry.txnId} dated ${entry.txnDate} posts to ` +
          `${unmapped.length === 1 ? 'a provider account' : 'provider accounts'} nothing in your ` +
          `chart is mapped to: ${unmapped.join(', ')}. Import or map ` +
          `${unmapped.length === 1 ? 'it' : 'them'} on the Account map page and run the sync ` +
          'again - a synced entry never guesses an account and never falls back to one.',
        { txnId: entry.txnId, txnType: entry.txnType, providerAccountIds: unmapped.join(',') }
      )
    )
  }
  return ok(lines)
}

// ─── §5.3, verify on read ───────────────────────────────────────────────────

interface CheckInput {
  ourEntries: readonly OurPostedEntry[]
  theirs: ReadonlyMap<string, ProviderLedgerEntry>
  glAccountIdByProviderId: ReadonlyMap<string, string>
  from: string
  to: string
}

/**
 * Compare each of our entries against the provider's copy of it.
 *
 * ⚠️ **`'missing'` is only reported for an entry dated INSIDE the range that was
 * actually read.** An entry dated outside the chunk is absent for a benign
 * reason, and the range tested against is the one the provider ECHOED
 * (`ProviderLedger.from`/`.to`), never the one we asked for - Intuit silently
 * ignores some date parameters, and a comparison that trusted the request would
 * declare a whole month of our entries deleted the first time it did.
 *
 * An entry of ours that neither appeared nor is dated in range yields no check
 * at all. Reporting it as anything would be reporting on a range this call did
 * not read.
 */
function checkOurEntries(input: CheckInput): OurEntryCheck[] {
  const { ourEntries, theirs, glAccountIdByProviderId, from, to } = input
  const checks: OurEntryCheck[] = []

  for (const entry of ourEntries) {
    const their = theirs.get(entry.providerEntryId)

    if (!their) {
      // Out of range: absent for a benign reason, so there is nothing to say.
      if (entry.txnDate < from || entry.txnDate > to) continue
      checks.push({
        glPostingId: entry.glPostingId,
        providerEntryId: entry.providerEntryId,
        docNumber: entry.docNumber,
        verdict: 'missing',
        differences: [
          `${entry.docNumber} is dated ${entry.txnDate}, inside the ${from}..${to} range that ` +
            `was read, but transaction ${entry.providerEntryId} does not appear in it. The ` +
            'entry has been deleted or re-dated in the provider. Our books still carry it.',
        ],
      })
      continue
    }

    const differences = describeDifferences(entry, their, glAccountIdByProviderId)
    checks.push({
      glPostingId: entry.glPostingId,
      providerEntryId: entry.providerEntryId,
      docNumber: entry.docNumber,
      verdict: differences.length === 0 ? 'matches' : 'edited',
      differences,
    })
  }

  return checks
}

interface Sides {
  debit: number
  credit: number
}

/**
 * The four questions §5.3 asks, in the order a reader wants them answered:
 * same date, same total, same account set, same debit and credit per account.
 *
 * Every message names BOTH versions. "These differ" is not actionable; "ours
 * says 1,200.00 and theirs says 1,500.00 on 6100 Rent" is.
 */
function describeDifferences(
  ours: OurPostedEntry,
  theirs: ProviderLedgerEntry,
  glAccountIdByProviderId: ReadonlyMap<string, string>
): string[] {
  const differences: string[] = []

  if (ours.txnDate !== theirs.txnDate) {
    differences.push(
      `Date: ours is ${ours.txnDate}, theirs is ${theirs.txnDate}. A re-dated entry moves ` +
        'between periods, so two months disagree at once.'
    )
  }

  const ourTotal = ours.lines.reduce(
    (sum, line) => sum + (line.direction === 'debit' ? line.amountMinor : 0),
    0
  )
  if (ourTotal !== theirs.totalDebitMinor) {
    differences.push(
      `Total: ours is ${formatCurrency(ourTotal)}, theirs is ` +
        `${formatCurrency(theirs.totalDebitMinor)}.`
    )
  }

  const ourSides = new Map<string, Sides>()
  const names = new Map<string, string>()
  for (const line of ours.lines) {
    names.set(line.glAccountId, ourAccountName(line))
    add(ourSides, line.glAccountId, line.direction, line.amountMinor)
  }

  const theirSides = new Map<string, Sides>()
  for (const line of theirs.lines) {
    // A row with no money in either column contributes nothing to either side.
    // ⚠️ It is NOT a malformed row - nine of the sandbox's 336 lines are like
    // this - so it must not be reported as a difference, and it must not be
    // read as a zero CREDIT either, which is what a bare
    // `debitMinor > 0 ? 'debit' : 'credit'` would make of it.
    if (line.debitMinor === 0 && line.creditMinor === 0) continue
    const glAccountId = glAccountIdByProviderId.get(line.providerAccountId)
    if (!glAccountId) {
      // Not foldable anywhere. This is our OWN entry, so we had a mapping when
      // we pushed it - an unmapped account here means the link has been cleared
      // or the account replaced since, and quietly dropping the line would
      // shrink their total and report the wrong difference.
      differences.push(
        `Their line on provider account '${line.providerAccountId}'` +
          `${line.providerAccountName ? ` (${line.providerAccountName})` : ''} is not mapped to ` +
          'any account in your chart, so that line cannot be compared.'
      )
      continue
    }
    if (!names.has(glAccountId)) names.set(glAccountId, line.providerAccountName)
    add(theirSides, glAccountId, 'debit', line.debitMinor)
    add(theirSides, glAccountId, 'credit', line.creditMinor)
  }

  for (const glAccountId of union(ourSides, theirSides)) {
    const mine = ourSides.get(glAccountId) ?? { debit: 0, credit: 0 }
    const yours = theirSides.get(glAccountId) ?? { debit: 0, credit: 0 }
    if (mine.debit === yours.debit && mine.credit === yours.credit) continue
    const name = names.get(glAccountId) ?? glAccountId
    differences.push(
      `${name}: ours is ${side(mine)}, theirs is ${side(yours)}.` +
        (ourSides.has(glAccountId) ? '' : ' That account is not on our copy of the entry at all.') +
        (theirSides.has(glAccountId)
          ? ''
          : ' That account is not on their copy of the entry at all.')
    )
  }

  return differences
}

function add(
  sides: Map<string, Sides>,
  key: string,
  direction: 'debit' | 'credit',
  amount: number
) {
  const current = sides.get(key) ?? { debit: 0, credit: 0 }
  if (direction === 'debit') current.debit += amount
  else current.credit += amount
  sides.set(key, current)
}

function side(sides: Sides): string {
  return `Dr ${formatCurrency(sides.debit)} Cr ${formatCurrency(sides.credit)}`
}

function union(a: ReadonlyMap<string, Sides>, b: ReadonlyMap<string, Sides>): string[] {
  return [...new Set([...a.keys(), ...b.keys()])]
}

/** How one of our accounts is named in a message. The frozen snapshots, never a live read. */
function ourAccountName(line: OurPostedLine): string {
  const label = accountLabel({ code: line.accountCode, name: line.accountName ?? '' })
  return label || line.glAccountId
}

/** `glAccountId -> label`, harvested from the lines we already hold, for refusals. */
function labelIndex(ourEntries: readonly OurPostedEntry[]): Map<string, string> {
  const labels = new Map<string, string>()
  for (const entry of ourEntries) {
    for (const line of entry.lines) {
      if (!labels.has(line.glAccountId)) labels.set(line.glAccountId, ourAccountName(line))
    }
  }
  return labels
}
