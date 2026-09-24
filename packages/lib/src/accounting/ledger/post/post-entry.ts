// packages/lib/src/accounting/ledger/post/post-entry.ts
//
// The poster: resolve, balance, claim, persist, delegate, record.
//
// PROVIDER-AGNOSTIC. Nothing in this file names an accounting system, and
// nothing in it imports one. Decision P1 says the ledger is OURS and the
// accounting system is an exporter, so an organization with nothing connected
// runs this whole path unchanged - its entries are built, balanced, claimed and
// persisted, and the only difference is that `NONE_ACCOUNTING_PROVIDER` answers
// `not_connected` at the last step. That is a supported configuration, not a
// degraded one.
//
// ── Why the claim is a Postgres unique index ────────────────────────────────
// A double-posted journal entry silently misstates the financial statements.
// There is no invoice or payment to reconcile it against, so nobody notices
// until a close does not tie out. The primary defence is therefore
// `INSERT … ON CONFLICT (organizationId, postingType, periodKey, revision) DO
// NOTHING RETURNING *`: two concurrent runs of the same period contend on one
// index tuple, the loser gets no row back, reads the winner's row and returns
// `already_posted`. Nothing about that depends on a provider, on a network, or
// on our own code getting the ordering right.
//
// The layers ABOVE this one - a deterministic document number queried before
// insert, a deterministic `requestId` on the push itself, a forensic note in
// the provider's register - belong to the adapter, because they are that
// provider's document number and that provider's idempotency contract. Layer 1
// protects OUR row; layers 2-4 protect THEIRS. See
// plans/money/tasks/10-the-poster.md section 1.
//
// ── This function never throws ──────────────────────────────────────────────
// Every refusal - a closed period, an unmapped role, an imbalance, a provider
// fault - resolves to a typed `PostResult`, so a tRPC mutation or a BullMQ job
// can persist the outcome without a try/catch of its own.
//
// No permission checks here. The router asserts (docs/lib-module-guide.md §6).

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { formatCurrency } from '@auxx/utils'
import {
  AuxxError,
  BadRequestError,
  databaseErrorCodes,
  UnprocessableEntityError,
} from '../../../errors'
import { buildExportBatches } from '../../export/build-batches'
import { sendExportBatch } from '../../export/send'
import { buildDocNumber, DOC_NUMBER_MAX_LENGTH } from '../builders/doc-number'
import { accountLabel } from '../chart/account-label'
import { type CloseBlockerItem, describeUnmappedRoles } from '../periods/close-blockers'
import { resolvePeriodLock } from '../periods/period-lock'
import {
  assertPeriodOpen,
  type PeriodLock,
  parsePeriodKey,
  postingLockKey,
} from '../periods/periods'
import { INVENTORY_ROLES } from '../roles/regime'
import {
  loadRoleAccountCodes,
  type RoleSourceScope,
  resolveAccountLines,
} from '../roles/resolve-roles'
import { avenueOfPostingType } from '../setup/export-settings'
import { LEDGER_CURRENCY } from '../setup/ledger-currency'
import { readExportSettings } from '../setup/read-export-settings'
import type {
  BuiltEntry,
  GlPostingSourceInput,
  PostFailureClass,
  PostingType,
  PostResult,
  PostResultStatus,
} from '../types'
import { withAccountingCommitLock } from './accounting-commit-lock'
import type { PostingAssertions } from './draft'
import {
  type ClaimHolderRow,
  type ClaimOutcome,
  claimSubjectInTx,
  insertPostingInTx,
  insertSourceLinksInTx,
  markReversedInTx,
  type PreparedLine,
  readClaimHolderInTx,
  subjectOf,
} from './insert-posting'

const logger = createScopedLogger('postings:post-entry')

/**
 * The one currency the ledger records for the cutover.
 *
 * Written EXPLICITLY into every claim rather than left to the column's
 * `default('USD')`. A default is invisible at the call site: the day a
 * multi-currency org arrives, every entry it posts would be labelled USD by a
 * line of SQL nobody is reading. When `BuiltEntry` grows a currency this
 * constant becomes a comparison, and a mismatch becomes a refusal.
 */
export { LEDGER_CURRENCY } from '../setup/ledger-currency'

/**
 * QuickBooks caps `requestid` at 50 characters, and we adopt that as ours for
 * the same reason `doc-number.ts` adopts the 21-character `DocNumber` cap: a
 * value that fits everywhere stays portable, and widening it later would mean
 * re-keying entries that are already in a ledger.
 */

/**
 * Minor units to a string a bookkeeper reads - `1234000` -> `$12,340.00`.
 *
 * Delegates to `@auxx/utils`'s `formatCurrency` rather than dividing by 100
 * here. The local version hardcoded a two-decimal scale, which is right for USD
 * and wrong for JPY (0) and KWD (3) - latent rather than live only because
 * {@link LEDGER_CURRENCY} pins the ledger to USD for the cutover. When that
 * pin comes off, this is one of the places that would have been silently wrong.
 */
function formatMinor(minor: number): string {
  return formatCurrency(minor, { currencyCode: LEDGER_CURRENCY })
}

export interface PostEntryOptions {
  organizationId: string
  entry: BuiltEntry
  actorUserId?: string
  memo?: string
  /**
   * Preview context only. The commit re-reads the authoritative period setting through
   * its transaction; neither a stale open nor a stale closed value controls acceptance.
   */
  lock: PeriodLock
  /**
   * Set only by {@link reverseEntry}. Presence makes this a reversal: the
   * `GlPosting_reversal_check` constraint requires it to be in the INSERT, and
   * the original flips to `reversed` in the same transaction that marks this
   * one `posted`.
   */
  reversesId?: string
  revision?: number
  /**
   * Set only by {@link reverseEntry}: the original's stored number plus `-R<n>`,
   * so a pair matches in the register whichever format the original carries.
   * Absent, the number is minted from the period key.
   */
  docNumber?: string
  /**
   * Balance assertions recorded on the `built` envelope.
   *
   * ⚠️ No posting type writes these since MIGRATION step 5 deleted the monthly
   * assertion. The envelope still carries them so entries written before that
   * still render their roll-forward.
   *
   * Typed, not a loose `Record`: the poster stays generic because
   * {@link PostingAssertions} is discriminated on `kind`, not because the field
   * is untyped.
   */
  assertions?: PostingAssertions
  /** Recheck a caller-owned source constraint under the accounting lock before accepting the entry. */
  beforeCommit?: (tx: Transaction) => Promise<void>
  /**
   * Which SOURCE this entry's money came from, for the roles that read one
   * (task 47 §5).
   *
   * Absent on every caller that cannot know - a month-end plug, a hand-keyed
   * journal, a vendor bill - and absent means "the org default", which is what
   * every role resolved to before this brief. Supplied by the revenue and
   * settlement paths, which do know: a shipment carries its store, a payout
   * carries the merchant account it settled through.
   *
   * 🛑 A miss falls back rather than failing. Connecting a second store must
   * never stop the books (decision D6).
   */
  scope?: RoleSourceScope
  /**
   * What this entry is FOR. Exactly one `subject`, whose `GlPostingSource` row
   * IS the claim; `parent`, `counterparty` and `member` rows are the index the
   * ledger cards read (TARGET §1).
   */
  sources: GlPostingSourceInput[]
  /** `FinancialSourceAccount.id` this entry resolved through, for the summary grouping. */
  storeId?: string | null
  /** `payment_gateway` instance id this entry resolved through. */
  railId?: string | null
  /** The provider's payout id, for the summary's payout grain; null until brief 94 stamps it. */
  payoutId?: string | null
}

export interface PreviewEntryOptions {
  organizationId: string
  entry: BuiltEntry
  lock: PeriodLock
  /**
   * Which SOURCE this entry's money came from, for the roles that read one
   * (task 47 §5).
   *
   * Absent on every caller that cannot know - a month-end plug, a hand-keyed
   * journal, a vendor bill - and absent means "the org default", which is what
   * every role resolved to before this brief. Supplied by the revenue and
   * settlement paths, which do know: a shipment carries its store, a payout
   * carries the merchant account it settled through.
   *
   * 🛑 A miss falls back rather than failing. Connecting a second store must
   * never stop the books (decision D6).
   */
  scope?: RoleSourceScope
}

// `EntryPreview` moved to `types.ts` (client-safe) so a browser can hold the
// shape without importing this file, which pulls `@auxx/database`. Re-exported
// here so existing importers are unaffected.
export type { EntryPreview } from '../types'

import type { EntryPreview } from '../types'

interface Refusal {
  status: PostResultStatus
  failureClass: PostFailureClass
  error: string
  /**
   * The refusal as the individual pieces of work it is made of, when it has
   * several. Today that is `account_unmapped`, whose message names every
   * offending role: the console renders one row with its own "Map role" button
   * per role instead of one button under the whole list.
   *
   * 🛑 Derived from the refusing error's own `details`, never by re-splitting
   * `error`. Parsing prose back into structure is how a card ends up naming a
   * role that was never the problem.
   */
  items?: CloseBlockerItem[]
}

/**
 * The posting types that get the inventory-by-name refusal below.
 *
 * A builder-produced type is absent because it emits ROLES, and
 * `findWriterConflicts` in `regime.ts` already governs which of those may drive
 * an asserted account - declared once, by a human, in that file.
 *
 * 🛑 **`opening_balance` was here and is deliberately not any more** (HANDOFF
 * slot 1C). It is the one hand-keyed entry that MUST name `1310`/`1320`/`1330`:
 * without those three lines the ledger's inventory opens at zero, and the first
 * close - which posts `target − baseline` - would then report the entire
 * opening stock as a movement.
 *
 * It is the inventory baseline the close measures from (`readOpeningInventoryLedger`),
 * and any gap to the parts' value is posted once by `postOpeningInventoryAdjustment`.
 *
 * `manual_journal` keeps the refusal in full. A bookkeeper's adjusting entry
 * against an asserted account IS reversed by the next close, with the residual
 * landing in the COGS plug where it reads exactly like consumption.
 *
 * `bank_transaction` keeps it for the same reason and it is not optional: the
 * review queue's CODE treatment posts `Dr <the GL code a reviewer picked> /
 * Cr <the bank account's own GL code>` (bank plan B5), the picker is the whole
 * chart, and `SINGLE_WRITER_ROLES_BY_POSTING_TYPE.bank_transaction` is `[]` -
 * correctly, because the entry carries no role at all. So without this line
 * nothing anywhere stops a reviewer coding a bank line straight into `1310`,
 * and the next month-end assertion absorbs it into the COGS plug silently.
 *
 * `vendor_bill` keeps it for exactly the reason `bank_transaction` does. An
 * unmatched line's debit leg is `vendor_bill_line.glAccount`, a picker over the
 * WHOLE chart, and `SINGLE_WRITER_ROLES_BY_POSTING_TYPE.vendor_bill` is `[]` -
 * correctly, because its accrual and variance legs name roles that are not
 * inventory accounts. Without this line nothing stops a bill line being coded
 * straight into `1310`, and the next month-end assertion absorbs it into the
 * COGS plug silently.
 *
 * `recurring_journal` keeps it because it IS a `manual_journal` that a
 * scheduler re-types every month (brief 21 §1). More urgently, in fact: a
 * hand-keyed line against `1310` is one mistake a bookkeeper can be shown,
 * while a monthly template against it is twelve of them, found at the year's
 * close.
 *
 * Every other ENABLED type emits ROLES (`fulfillment`, `payment`, `payout`,
 * `bank_deposit`, `month_end_inventory`) and is governed by
 * `findWriterConflicts`. `write_off` is the one hybrid - its DEBIT leg takes an
 * optional account code - and it is in this set for that leg.
 */
const CODE_ENTRY_TYPES = new Set<PostingType>([
  'manual_journal',
  'bank_transaction',
  'write_off',
  'vendor_bill',
  'recurring_journal',
])

/**
 * Refuse a hand-keyed entry that names one of the three inventory accounts.
 *
 * Resolves the org's OWN accounts for `INVENTORY_ROLES` and compares them
 * against the ACCOUNT ID the entry actually resolved to (task 15), never the
 * code - the code is a label the owner may rename or clear entirely (task 15
 * §5), and keying this guard on it would let a renumbered or uncoded
 * inventory account slip a hand-keyed line straight past it. `glAccountId` is
 * what `G8` protects, read backwards. An org that has not mapped a given
 * inventory role has nothing to protect for it and contributes no id, rather
 * than refusing everything.
 *
 * 🛑 `loadRoleAccountCodes` is misnamed for what it does here - it has always
 * returned full accounts, never bare codes - but is left as-is because it is
 * imported by name from files outside this lane (`opening-trial-balance/reads.ts`,
 * `reports/aging.ts`, `reports/balance-sheet.ts`, `postings/index.ts`).
 *
 * The message names the account AND the remedy, because "you may not touch
 * 1320" with no next step is how a bookkeeper ends up creating a duplicate
 * account called "WIP adjustment" and posting there instead.
 */
async function findInventoryAccountRefusal(
  db: Database | Transaction,
  organizationId: string,
  lines: PreparedLine[]
): Promise<Refusal | undefined> {
  const guarded = await loadRoleAccountCodes(db, organizationId, [...INVENTORY_ROLES])
  if (guarded.size === 0) return undefined

  const byAccountId = new Map<string, string>()
  for (const [role, account] of guarded) byAccountId.set(account.glAccountId, role)

  const offending: string[] = []
  for (const line of lines) {
    const role = byAccountId.get(line.resolved.glAccountId)
    if (!role) continue
    offending.push(
      `${accountLabel({ code: line.resolved.accountCode, name: line.resolved.accountName ?? '' })} (${role})`
    )
  }
  if (offending.length === 0) return undefined

  return {
    status: 'inventory_role_refused',
    failureClass: 'data',
    error:
      `This entry names ${[...new Set(offending)].join(', ')}. ` +
      'The three inventory accounts are asserted to the subledger by the month-end close, so a ' +
      'hand-keyed line against them is reversed by the next close and its residual lands in COGS. ' +
      'Adjust inventory with a stock movement and let the close console post the difference.',
  }
}

export interface PreparedEntry {
  docNumber: string
  lines: PreparedLine[]
  totalMinor: number
  /** Set when the entry must not be claimed. Everything above is best-effort. */
  refusal?: Refusal
}

/** A supplied number gets the same cap the minted one does. */
function assertDocNumberLength(docNumber: string): string {
  if (docNumber.length > DOC_NUMBER_MAX_LENGTH) {
    throw new UnprocessableEntityError(
      `Document number '${docNumber}' is ${docNumber.length} characters, over the ${DOC_NUMBER_MAX_LENGTH}-character cap.`,
      { docNumber, length: String(docNumber.length) }
    )
  }
  return docNumber
}

/**
 * Everything that happens BEFORE anything is written, for both `postEntry` and
 * `previewEntry`.
 *
 * Deliberately best-effort rather than fail-fast: a preview that refuses on a
 * closed period should still show the bookkeeper the lines it would have
 * posted. So each stage records its refusal and the caller reads the first one,
 * in the order the poster refuses: period, roles, balance, document number.
 */
export async function prepareEntry(
  db: Database | Transaction,
  options: {
    organizationId: string
    entry: BuiltEntry
    lock: PeriodLock
    revision: number
    /** See {@link PostEntryOptions.scope}. Absent means the org default. */
    scope?: RoleSourceScope
    /** See {@link PostEntryOptions.docNumber}. */
    docNumber?: string
  }
): Promise<PreparedEntry> {
  const { organizationId, entry, lock, revision, scope } = options
  let refusal: Refusal | undefined

  // ── 1. The period ────────────────────────────────────────────────────────
  // `assertPeriodOpen` THROWS and this function must not, so it is caught and
  // mapped - and it throws TWO different things, which must not collapse into
  // one result. `UnprocessableEntityError` is the period being closed;
  // `BadRequestError`, out of `parsePeriodKey`, is a key that is not a date at
  // all. Reporting the second as `period_closed` sends a bookkeeper to reopen a
  // month that was never the problem.
  try {
    postingLockKey(entry)
    if (parsePeriodKey(entry.txnDate).granularity !== 'day')
      throw new BadRequestError('A journal requires a valid calendar book date')
    assertPeriodOpen(entry.txnDate, lock)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    refusal =
      error instanceof UnprocessableEntityError
        ? { status: 'period_closed', failureClass: 'configuration', error: message }
        : {
            status: 'error',
            failureClass: 'configuration',
            error:
              `Cannot tell whether the accounting period for this posting is open: ${message} ` +
              'Refusing rather than posting blind.',
          }
  }

  // ── 2. Every role, in one batch, BEFORE the claim ────────────────────────
  // A configuration error is never retried and must never leave a claimed row
  // behind. `resolveRoles` answers once for the whole set and its message names
  // every offending role - a bookkeeper fixing a close needs the list, not a
  // treasure hunt.
  // Sorted once, here: `lineNumber` is derived from this order and is unique
  // per posting, so the order the rows are written in IS the order a
  // bookkeeper reads them in. The sort happens BEFORE resolution so the row
  // numbers in a refusal message match the rows a bookkeeper is looking at.
  const ordered = [...entry.lines].sort((a, b) => a.sortOrder - b.sortOrder)
  const resolved = await resolveAccountLines(db, organizationId, ordered, scope)

  const lines: PreparedLine[] = []
  if (resolved.isErr()) {
    // A code line that names nothing in the chart is `account_invalid`, not
    // `account_unmapped`: "you never mapped this role" and "there is no such
    // account" send two different people to two different screens, and the
    // remedy card branches on the status.
    const hasCodeLine = ordered.some((line) => !!line.accountCode)
    // ⚠️ Roles only, and only on `account_unmapped`. `account_invalid` is about
    // a ROW naming an account the chart does not hold, and a card listing role
    // names under that title would send somebody to remap a role that resolved
    // perfectly well.
    const items = hasCodeLine
      ? []
      : describeUnmappedRoles(
          resolved.error instanceof AuxxError ? resolved.error.details : undefined
        )
    refusal ??= {
      status: hasCodeLine ? 'account_invalid' : 'account_unmapped',
      failureClass: 'configuration',
      error: resolved.error.message,
      ...(items.length ? { items } : {}),
    }
  } else {
    for (const [index, line] of ordered.entries()) {
      const account = resolved.value[index]
      if (!account) {
        // Unreachable: `resolveAccountLines` refuses rather than omit a line.
        // Asserted because the alternative is a line with no account code.
        refusal ??= {
          status: 'account_unmapped',
          failureClass: 'configuration',
          error: `Row ${index + 1} resolved to nothing. Refusing to post a line with no account.`,
        }
        break
      }
      lines.push({
        accountRole: line.accountRole ?? null,
        resolved: {
          direction: line.direction,
          amount: line.amount,
          memo: line.memo,
          sourceType: line.sourceType,
          sourceId: line.sourceId,
          sortOrder: line.sortOrder,
          // The IDENTITY (task 15 §2). `accountCode` and `accountName` beside it
          // are SNAPSHOTS. Renaming 2160 next year must not rewrite last year's
          // ledger, exactly as a standard-cost change does not restate a
          // movement's frozen cost.
          glAccountId: account.glAccountId,
          accountCode: account.code,
          accountName: account.name || undefined,
          // Carried from the input, unresolved: the builder already named it
          // (brief 13 §1.1), and it is FROZEN onto the stored line below so a
          // retry exports under the attribution the ledger asserted rather than
          // one re-resolved after a merge or a rename.
          counterpartyType: line.counterpartyType,
          counterpartyId: line.counterpartyId,
          // Carried from the input verbatim (brief 13 §5) - a reporting
          // dimension is never resolved against the chart, it just rides
          // along to the stored line.
          dimensions: line.dimensions,
        },
      })
    }

    // ── 2b. The single-writer refusal, for a CODE-POSTING entry ───────────
    // A manual journal, a coded bank line or a write-off's expense override can
    // name `1310` by code, which would make it a
    // second writer of an account the L1 month-end assertion ASSERTS to a
    // computed balance. The two are not additive and the conflict is
    // undetectable downstream: the next close moves the account back to the
    // subledger's number and dumps the residual into the COGS plug, where it
    // reads exactly like consumption. Both entries balance. `regime.ts`'s
    // `findWriterConflicts` cannot see this, by construction - a code line
    // carries no role - which is why the refusal is here, by NAME.
    //
    // 🛑 `cash` is deliberately NOT refused. An opening trial balance must name
    // the bank balance, and a bookkeeper correcting a deposit has to be able to
    // reach it. Only `INVENTORY_ROLES` are asserted monthly.
    //
    // 🛑 And `opening_balance` is not checked at all: it must name all three
    // inventory accounts, and it is not a second writer because the month-end
    // assertion measures from the `accounting.opening*` settings rather than
    // from this entry. See `CODE_ENTRY_TYPES`.
    if (!refusal && CODE_ENTRY_TYPES.has(entry.postingType)) {
      refusal = await findInventoryAccountRefusal(db, organizationId, lines)
    }
  }

  // ── 3. Balance, re-asserted in integer minor units ───────────────────────
  // `buildEntry` refuses to produce an unbalanced entry, so this can only fire
  // on a hand-assembled `BuiltEntry`. It is re-asserted anyway because the cost
  // of being wrong is a general ledger that does not tie out, and because the
  // message is USER-FACING: a bookkeeper reads it at 11pm on the 3rd and needs
  // both totals and the difference, in dollars, not a boolean.
  let totalDebit = 0
  let totalCredit = 0
  for (const line of entry.lines) {
    if (line.direction === 'debit') totalDebit += line.amount
    else totalCredit += line.amount
  }
  if (
    entry.lines.length === 0 ||
    entry.lines.some(
      (line) =>
        !Number.isSafeInteger(line.amount) ||
        line.amount <= 0 ||
        !['debit', 'credit'].includes(line.direction)
    ) ||
    !Number.isSafeInteger(totalDebit) ||
    !Number.isSafeInteger(totalCredit)
  ) {
    refusal ??= {
      status: 'error',
      failureClass: 'data',
      error: 'Posting lines and totals must be positive safe integer minor units.',
    }
  }
  if (entry.totalDebit !== totalDebit || entry.totalCredit !== totalCredit) {
    refusal ??= {
      status: 'unbalanced',
      failureClass: 'data',
      error: 'Posting totals differ from the supplied journal lines.',
    }
  }
  if (totalDebit !== totalCredit) {
    const difference = Math.abs(totalDebit - totalCredit)
    refusal ??= {
      status: 'unbalanced',
      failureClass: 'data',
      error:
        `Posting does not balance: debits ${formatMinor(totalDebit)} vs credits ` +
        `${formatMinor(totalCredit)}, off by ${formatMinor(difference)}.`,
    }
  }

  // ── 4. The deterministic keys ────────────────────────────────────────────
  let docNumber = ''
  try {
    docNumber = options.docNumber
      ? assertDocNumberLength(options.docNumber)
      : buildDocNumber({
          postingType: entry.postingType,
          periodKey: entry.periodKey,
          revision,
        })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    refusal ??= { status: 'error', failureClass: 'data', error: message }
  }

  return {
    docNumber,
    lines,
    totalMinor: totalDebit,
    refusal,
  }
}

/** Postgres `unique_violation`, however Drizzle happens to have wrapped it. */
/** Read a PostgreSQL unique violation without mistaking another database failure for a collision. */
export function uniqueViolationConstraint(error: unknown): string | null {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    const { code, constraint } = candidate as { code?: unknown; constraint?: unknown }
    if (code === databaseErrorCodes.uniqueViolation) {
      return typeof constraint === 'string' ? constraint : ''
    }
  }
  return null
}

/**
 * Persist NOTHING. Build the entry, resolve its roles, and return what a post
 * WOULD write.
 *
 * The cutover trigger is a person clicking Post (decision G5, ~30 entries a
 * month), and the whole value of a preview is that they can look at an entry
 * before it reaches the financial statements. So this issues the same reads and
 * runs the same refusals as {@link postEntry} - including the ones that would
 * block it - and writes nothing at all.
 */
export async function previewEntry(
  db: Database,
  options: PreviewEntryOptions
): Promise<EntryPreview> {
  const { organizationId, entry, lock, scope } = options
  // A preview is always of an original. A reversal is previewed by reading the
  // posting it reverses, which is `reverseEntry`'s job.
  const prepared = await prepareEntry(db, { organizationId, entry, lock, revision: 0, scope })

  return {
    postingType: entry.postingType,
    periodKey: entry.periodKey,
    txnDate: entry.txnDate,
    docNumber: prepared.docNumber,
    lines: prepared.lines.map((line) => line.resolved),
    totalMinor: prepared.totalMinor,
    blockedBy: prepared.refusal
      ? {
          status: prepared.refusal.status,
          error: prepared.refusal.error,
          ...(prepared.refusal.items?.length ? { items: prepared.refusal.items } : {}),
        }
      : undefined,
  }
}

/**
 * The write half, inside the caller's transaction and under the accounting lock:
 * insert the row, then take the claim on the subject - the loser reads the
 * winner and its own row rolls back with the savepoint.
 */
async function writePostingInTx(
  tx: Transaction,
  input: {
    organizationId: string
    entry: BuiltEntry
    revision: number
    reversesId?: string
    prepared: PreparedEntry
    sources: GlPostingSourceInput[]
    storeId?: string | null
    railId?: string | null
    payoutId?: string | null
    memo?: string
    actorUserId?: string
    assertions?: PostingAssertions
  }
): Promise<ClaimOutcome> {
  const { organizationId, entry, revision, reversesId, prepared, sources } = input
  const subject = subjectOf(sources)

  const row = await insertPostingInTx(tx, {
    organizationId,
    entry,
    revision,
    reversesId,
    docNumber: prepared.docNumber,
    totalMinor: prepared.totalMinor,
    lines: prepared.lines,
    sources,
    storeId: input.storeId,
    railId: input.railId,
    payoutId: input.payoutId,
    memo: input.memo,
    actorUserId: input.actorUserId,
    assertions: input.assertions,
  })

  const held = await claimSubjectInTx(tx, { organizationId, glPostingId: row.id, subject })
  if (held) {
    const winner = await readClaimHolderInTx(tx, { organizationId, glPostingId: held.heldBy })
    // Roll the row this transaction wrote back out; the winner's stands.
    throw new AlreadyClaimed(winner)
  }

  await insertSourceLinksInTx(tx, { organizationId, glPostingId: row.id, sources })
  if (reversesId) await markReversedInTx(tx, { organizationId, reversesId, entry, revision })
  return { kind: 'claimed', row }
}

/**
 * Thrown out of {@link writePostingInTx} so the losing transaction ROLLS BACK
 * its own row before `postEntry` answers `already_posted`. Never leaves this file.
 */
class AlreadyClaimed extends Error {
  constructor(readonly row: ClaimHolderRow) {
    super('The source is already claimed by another posting')
  }
}

/**
 * What a freshly claimed row still owes the export once its transaction has
 * committed. Absent on `already_posted` and on every refusal.
 */
export interface PendingEntryExport {
  organizationId: string
  glPostingId: string
  postingType: PostingType
  txnDate: string
  docNumber: string
}

/** A {@link PostResult} plus the export a committed claim still owes. */
export type InTxPostResult = PostResult & { pendingExport?: PendingEntryExport }

/** The shape refusals that happen before anything is written come back in. */
function refusalResult(prepared: PreparedEntry): PostResult {
  const refusal = prepared.refusal!
  return {
    status: refusal.status,
    failureClass: refusal.failureClass,
    // A configuration or data refusal is never retried: retrying cannot change
    // the answer, and the operator has to change something first.
    retryable: false,
    error: refusal.error,
    ...(refusal.items?.length ? { items: refusal.items } : {}),
    docNumber: prepared.docNumber || undefined,
  }
}

/**
 * The poster on the CALLER'S transaction: resolve, balance, claim, persist.
 *
 * Use it when the source write and its posting must commit or roll back
 * together - a shipment and its revenue entry, a document and its movements
 * (MIGRATION follow-up 2). The caller owns the transaction and
 * {@link withAccountingCommitLock}; this function takes neither.
 *
 * 🛑 It does NOT push to the provider. A network call inside an open
 * transaction holds the claim's index tuple for the length of an HTTP round
 * trip, which is exactly how a concurrent loser turns into a timeout instead of
 * an `already_posted`. A fresh claim comes back with a {@link PendingEntryExport}
 * the caller hands to {@link exportPostedEntry} after the commit.
 *
 * Unlike {@link postEntry} this THROWS: an `AuxxError` or a database failure
 * propagates so the caller's transaction rolls back. A REFUSAL is not a throw -
 * nothing has been written at that point, so it comes back as a `PostResult`
 * and the caller decides whether its own work still stands.
 */
export async function postEntryInTx(
  tx: Transaction,
  options: PostEntryOptions
): Promise<InTxPostResult> {
  const { organizationId, entry, actorUserId, memo, reversesId, assertions } = options
  const revision = options.revision ?? 0

  // `GlPosting_reversal_check` is `(revision = 0 AND reversesId IS NULL) OR
  // (revision > 0 AND reversesId IS NOT NULL)`. Caught here so the caller
  // gets a sentence instead of a constraint name.
  if (revision === 0 && reversesId) {
    return {
      status: 'error',
      failureClass: 'data',
      retryable: false,
      error:
        'A posting that reverses another must claim a revision above 0. ' +
        'Revision 0 is the original.',
    }
  }
  if (revision > 0 && !reversesId) {
    return {
      status: 'error',
      failureClass: 'data',
      retryable: false,
      error: `Revision ${revision} must name the posting it reverses. Only an original is revision 0.`,
    }
  }

  await options.beforeCommit?.(tx)
  const authoritativeLock = await resolvePeriodLock(organizationId, tx)
  const prepared = await prepareEntry(tx, {
    organizationId,
    entry,
    lock: authoritativeLock,
    revision,
    scope: options.scope,
    docNumber: options.docNumber,
  })
  if (prepared.refusal) {
    logger.warn('Refusing to post', {
      organizationId,
      postingType: entry.postingType,
      periodKey: entry.periodKey,
      status: prepared.refusal.status,
      error: prepared.refusal.error,
    })
    return refusalResult(prepared)
  }
  const docNumber = prepared.docNumber

  let claim: ClaimOutcome
  try {
    // A SAVEPOINT, so the loser of a claim race rolls back its own row without
    // taking the caller's work with it.
    claim = await tx.transaction((nested) =>
      writePostingInTx(nested, {
        organizationId,
        entry,
        revision,
        reversesId,
        prepared,
        sources: options.sources,
        storeId: options.storeId,
        railId: options.railId,
        payoutId: options.payoutId,
        memo,
        actorUserId,
        assertions,
      })
    )
  } catch (error) {
    // The loser of a claim race. Its own row rolled back with the savepoint;
    // the winner's stands, and `already_posted` is a SUCCESS.
    if (error instanceof AlreadyClaimed) {
      claim = { kind: 'existing', row: error.row }
    } else {
      // 🛑 The claim's `ON CONFLICT DO NOTHING` swallows a conflict on
      // `GlPostingSource_claim_key` and no other. A violation of
      // `GlPosting_org_docNumber_key` still raises SQLSTATE 23505 out of a
      // statement that looks defended, and without this it escapes as an
      // anonymous 500 naming a constraint the reader has never heard of.
      const constraint = uniqueViolationConstraint(error)
      if (constraint !== null) {
        logger.error('Claim rejected by a constraint other than the source claim', {
          organizationId,
          docNumber,
          constraint,
        })
        throw new UnprocessableEntityError(
          constraint === 'GlPosting_org_docNumber_key'
            ? `Document number ${docNumber} is already used by a different posting in this organization. ` +
                'Two posting identities minted the same number - the document-number keyspace is wrong, not the entry.'
            : `A unique constraint (${constraint || 'unknown'}) rejected the claim for ${docNumber}.`,
          { organizationId, docNumber, constraint }
        )
      }
      throw error
    }
  }

  if (claim.kind === 'existing') {
    // A SUCCESS: the row that holds this claim is in the books, whatever its
    // export did. Logged at info, never as an error - training everyone to
    // ignore this channel is how a real double-post would go unnoticed.
    logger.info('Source already claimed - not posting again', {
      organizationId,
      postingType: entry.postingType,
      periodKey: entry.periodKey,
      revision,
      glPostingId: claim.row.id,
      existingStatus: claim.row.status,
    })
    return {
      status: 'already_posted',
      glPostingId: claim.row.id,
      docNumber: claim.row.docNumber ?? undefined,
    }
  }

  const glPostingId = claim.row.id
  return {
    status: 'posted',
    glPostingId,
    docNumber,
    pendingExport: {
      organizationId,
      glPostingId,
      postingType: entry.postingType,
      txnDate: entry.txnDate,
      docNumber: claim.row.docNumber ?? docNumber,
    },
  }
}

/**
 * Build and send this entry's own export batch, if the org asked for that.
 *
 * **Never throws.** Called AFTER the claim's transaction commits - see
 * {@link postEntryInTx}'s 🛑.
 *
 * Only the Transaction-mode, `autoSend`-on case does anything here. Everything
 * else is the sweep's and the export queue's work: a summary batch cannot be
 * built from one posting, and a held avenue is waiting for a person (TARGET §4).
 */
export async function exportPostedEntry(
  db: Database,
  pending: PendingEntryExport
): Promise<PostResult> {
  const { organizationId, glPostingId, postingType, txnDate, docNumber } = pending
  const posted: PostResult = { status: 'posted', glPostingId, docNumber }
  try {
    const avenue = avenueOfPostingType(postingType)
    if (!avenue) return posted
    const settings = await readExportSettings(organizationId)
    if (settings.mode !== 'transaction' || !settings.autoSend[avenue]) return posted

    const built = await buildExportBatches(db, {
      organizationId,
      from: txnDate,
      to: txnDate,
      glPostingIds: [glPostingId],
    })
    if (built.isErr()) {
      logger.warn('Could not build the export batch for a posted entry; the sweep will', {
        organizationId,
        glPostingId,
        error: built.error.message,
      })
      return posted
    }
    for (const batchId of built.value.batchIds)
      await sendExportBatch(db, { organizationId, batchId })
    return posted
  } catch (error) {
    logger.error('Exporting a posted entry failed; the sweep will pick it up', {
      organizationId,
      glPostingId,
      error: error instanceof Error ? error.message : String(error),
    })
    return posted
  }
}

/**
 * Claim the period, persist the entry, hand it to whichever provider the
 * organization has connected, and record what happened.
 *
 * **Never throws.** Every outcome is a {@link PostResult} status.
 *
 * Its own transaction and its own {@link withAccountingCommitLock} around
 * {@link postEntryInTx}, then the provider - which is deliberately outside that
 * transaction. Use `postEntryInTx` directly when the source write must commit
 * with its posting.
 */
export async function postEntry(db: Database, options: PostEntryOptions): Promise<PostResult> {
  const { organizationId, entry } = options

  let result: InTxPostResult
  try {
    result = await db.transaction(async (tx) => {
      await withAccountingCommitLock(tx, organizationId)
      return postEntryInTx(tx, options)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Posting failed', {
      organizationId,
      postingType: entry.postingType,
      periodKey: entry.periodKey,
      error: message,
    })
    if (error instanceof AuxxError) {
      return { status: 'error', failureClass: 'data', retryable: false, error: message }
    }
    // `transport` because an unexpected throw on this path is overwhelmingly an
    // io failure - a dropped connection, a timed-out statement. `retryable` is
    // decided separately and conservatively: see `classifyProviderFailure`.
    return { status: 'error', failureClass: 'transport', retryable: false, error: message }
  }

  const { pendingExport, ...posted } = result
  if (!pendingExport) return posted
  return exportPostedEntry(db, pendingExport)
}
