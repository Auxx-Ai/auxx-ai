// packages/lib/src/postings/post-entry.ts
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

import { createHash } from 'node:crypto'
import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { formatCurrency } from '@auxx/utils'
import { and, eq, sql } from 'drizzle-orm'
import { AuxxError, BadRequestError, databaseErrorCodes, UnprocessableEntityError } from '../errors'
import { accountLabel } from './account-label'
import { withAccountingCommitLock } from './accounting-commit-lock'
import { type CloseBlockerItem, describeUnmappedRoles } from './close-blockers'
import { buildDocNumber } from './doc-number'
import { type PostingAssertions, parsePostingDraft, requiresAssertions } from './draft'
import {
  type ClaimHolderRow,
  type ClaimOutcome,
  claimSubjectInTx,
  insertPostingInTx,
  insertSourceLinksInTx,
  markPostedInTx,
  markReversedInTx,
  type PreparedLine,
  readClaimHolderInTx,
  subjectOf,
} from './insert-posting'
import { LEDGER_CURRENCY } from './ledger-currency'
import { resolvePeriodLock } from './period-lock'
import { assertPeriodOpen, type PeriodLock, parsePeriodKey, postingLockKey } from './periods'
import { NONE_ACCOUNTING_PROVIDER, resolveAccountingProvider } from './provider'
import { EXPORT_ROUTE_BY_POSTING_TYPE, INVENTORY_ROLES } from './regime'
import { loadRoleAccountCodes, type RoleSourceScope, resolveAccountLines } from './resolve-roles'
import type {
  BuiltEntry,
  GlPostingSourceInput,
  PostEntryInput,
  PostEntryStatus,
  PostFailureClass,
  PostingType,
  PostResult,
  PostResultStatus,
} from './types'
import { ProviderPostError } from './types'

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
export { LEDGER_CURRENCY } from './ledger-currency'

/**
 * QuickBooks caps `requestid` at 50 characters, and we adopt that as ours for
 * the same reason `doc-number.ts` adopts the 21-character `DocNumber` cap: a
 * value that fits everywhere stays portable, and widening it later would mean
 * re-keying entries that are already in a ledger.
 */
const REQUEST_ID_MAX_LENGTH = 50

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
   * Balance assertions recorded on the draft envelope.
   *
   * 🛑 **Required for every posting type {@link requiresAssertions} names**, and
   * refused as a `data` failure when absent. `month_end_inventory` ASSERTS a
   * balance rather than accumulating one, so the next month's entry is
   * computable only from what this one recorded - a month-end posting written
   * without them silently ends the chain, and the next close reads its delta
   * from nothing. That entry balances perfectly, which is why the check is here
   * and not left to a reviewer.
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
  /**
   * `'draft'` writes the row with its lines and no doc number and takes no
   * claim - {@link postDraft} promotes it. `'post'` claims, numbers and posts in
   * one transaction. Per-avenue `accounting.autoPost` decides which a writer asks for.
   */
  mode: 'draft' | 'post'
  /** `FinancialSourceAccount.id` this entry resolved through, for the summary grouping. */
  storeId?: string | null
  /** `payment_gateway` instance id this entry resolved through. */
  railId?: string | null
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
export type { EntryPreview } from './types'

import type { EntryPreview } from './types'

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
 * It does not become a second writer, because the month-end assertion never
 * reads this entry. `gather-month-end-inventory.ts` takes its prior assertion
 * from `readOpeningBaseline`, i.e. the `accounting.opening*` SETTINGS, so the
 * ledger lands on `opening + (target − opening) = target` exactly once. And the
 * two numbers cannot disagree: the wizard prefills those three rows FROM those
 * settings and locks them.
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
 * `expense_bill` keeps it for exactly the reason `bank_transaction` does
 * (brief 21 §3.2). Its debit legs are `vendor_bill_line.glAccount`, a picker
 * over the WHOLE chart, and `SINGLE_WRITER_ROLES_BY_POSTING_TYPE.expense_bill`
 * is `[]` - correctly, because only its A/P credit carries a role. Without this
 * line nothing stops a bill line being coded straight into `1310`, and the next
 * month-end assertion absorbs it into the COGS plug silently. (Inventory
 * bought on a purchase order is the L3 `vendor_bill`/`receipt` story, which is
 * governed by `findWriterConflicts` and is not this type.)
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
  'expense_bill',
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
  requestId: string
  lines: PreparedLine[]
  totalMinor: number
  /** Set when the entry must not be claimed. Everything above is best-effort. */
  refusal?: Refusal
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
    docNumber = buildDocNumber({
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
    requestId: buildRequestId({
      organizationId,
      postingType: entry.postingType,
      periodKey: entry.periodKey,
      revision,
    }),
    lines,
    totalMinor: totalDebit,
    refusal,
  }
}

/**
 * The deterministic idempotency key handed to a provider.
 *
 * 🛑 **No run salt.** It is derived from the posting IDENTITY alone -
 * organization, type, period, revision - so two runs of the same period produce
 * the same key. A random key guarantees nothing, because the retry carries a
 * different one, and the retry is the only case provider-side idempotency
 * exists for.
 *
 * Written to `GlPosting.requestId` at claim time and read back from the row by
 * every push, never recomputed at the call site: recomputing is how a formula
 * change silently re-keys entries that are already in a provider's register.
 */
export function buildRequestId(input: {
  organizationId: string
  postingType: PostingType
  periodKey: string
  revision: number
}): string {
  return createHash('sha256')
    .update(`${input.organizationId}:${input.postingType}:${input.periodKey}:${input.revision}`)
    .digest('hex')
    .slice(0, REQUEST_ID_MAX_LENGTH)
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
 * Persist NOTHING. Build the draft, resolve its roles, and return what a post
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
  // posting it reverses, which is `reverseEntry`'s job, not a fresh draft's.
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
 * What the write transaction did: a draft row, a fresh claim, or a loser that
 * found the source already claimed.
 */
type PostingWriteOutcome =
  | { kind: 'drafted'; glPostingId: string }
  | {
      kind: 'posted'
      claim: ClaimOutcome
    }

/**
 * The write half, inside the caller's transaction and under the accounting lock.
 *
 * Draft: insert the row with its lines, `built` and every source link, no doc
 * number and NO claim. Post: insert `draft` first, then take the claim on the
 * subject row - the loser reads the winner and the row it wrote is rolled back
 * with the transaction - then number it and flip it to `posted`.
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
    mode: 'draft' | 'post'
    storeId?: string | null
    railId?: string | null
    memo?: string
    actorUserId?: string
    assertions?: PostingAssertions
  }
): Promise<PostingWriteOutcome> {
  const { organizationId, entry, revision, reversesId, prepared, sources, mode } = input
  const subject = subjectOf(sources)

  const row = await insertPostingInTx(tx, {
    organizationId,
    entry,
    revision,
    reversesId,
    docNumber: mode === 'post' ? prepared.docNumber : null,
    requestId: prepared.requestId,
    totalMinor: prepared.totalMinor,
    lines: prepared.lines,
    sources,
    storeId: input.storeId,
    railId: input.railId,
    memo: input.memo,
    actorUserId: input.actorUserId,
    assertions: input.assertions,
    status: mode === 'post' ? 'posted' : 'draft',
  })

  if (mode === 'draft') {
    await insertSourceLinksInTx(tx, { organizationId, glPostingId: row.id, sources })
    // The subject row of a DRAFT is not written: it is the claim, and a draft
    // holds none. `postDraft` takes it.
    return { kind: 'drafted', glPostingId: row.id }
  }

  const held = await claimSubjectInTx(tx, { organizationId, glPostingId: row.id, subject })
  if (held) {
    const winner = await readClaimHolderInTx(tx, { organizationId, glPostingId: held.heldBy })
    // Roll the row this transaction wrote back out; the winner's stands.
    throw new AlreadyClaimed(winner)
  }

  await insertSourceLinksInTx(tx, { organizationId, glPostingId: row.id, sources })
  if (reversesId) await markReversedInTx(tx, { organizationId, reversesId, entry, revision })
  return { kind: 'posted', claim: { kind: 'claimed', row } }
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
 * Claim the period, persist the entry, hand it to whichever provider the
 * organization has connected, and record what happened.
 *
 * **Never throws.** Every outcome is a {@link PostResult} status.
 *
 * Order of operations, and why it is this order:
 *
 * 1. **Period lock.** Refusing at the door is the only cheap moment - a posting
 *    into a closed month cannot be un-posted at the provider by anything this
 *    system can do.
 * 2. **Roles.** Resolved as a batch and BEFORE the claim, so a configuration
 *    error never leaves a claimed row behind.
 * 3. **Balance**, re-asserted in integer minor units.
 * 4. **The deterministic keys** - document number and `requestId`.
 * 5. **The claim**, `ON CONFLICT DO NOTHING`. No row means someone owns the
 *    period; read theirs and return `already_posted`, which is a SUCCESS.
 * 6. **The lines**, in the SAME transaction as the claim. A claimed header with
 *    no lines is a ledger row that balances to nothing.
 * 7. **The provider**, AFTER that transaction commits. A network call inside an
 *    open transaction holds the claim's index tuple for the length of an HTTP
 *    round trip, which is exactly how the concurrent loser turns into a
 *    timeout instead of an `already_posted`.
 * 8. **The outcome**, in one `UPDATE` - `GlPosting_posted_check` is
 *    `status <> 'posted' OR postedAt IS NOT NULL`, so status and timestamp
 *    cannot be two statements.
 */
export async function postEntry(db: Database, options: PostEntryOptions): Promise<PostResult> {
  const { organizationId, entry, actorUserId, memo, reversesId, assertions } = options
  const revision = options.revision ?? 0

  try {
    // Fail CLOSED before the claim, not after. A `month_end_inventory` row
    // written with no assertions holds the period - so no later run can repair
    // it - while leaving the next close nothing to compute its delta from.
    if (requiresAssertions(entry.postingType) && !assertions) {
      return {
        status: 'error',
        failureClass: 'data',
        retryable: false,
        error:
          `A ${entry.postingType} posting must carry balance assertions. ` +
          'It asserts a balance rather than accumulating one, so the next period reads ' +
          'its opening figures from this entry and there would be nothing to read.',
      }
    }

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

    let prepared: PreparedEntry | undefined
    let docNumber = ''
    let outcome: PostingWriteOutcome | undefined
    try {
      await db.transaction(async (tx) => {
        await withAccountingCommitLock(tx, organizationId)
        await options.beforeCommit?.(tx)
        const authoritativeLock = await resolvePeriodLock(organizationId, tx)
        prepared = await prepareEntry(tx, {
          organizationId,
          entry,
          lock: authoritativeLock,
          revision,
          scope: options.scope,
        })
        docNumber = prepared.docNumber
        if (prepared.refusal) return
        outcome = await writePostingInTx(tx, {
          organizationId,
          entry,
          revision,
          reversesId,
          prepared,
          sources: options.sources,
          mode: options.mode,
          storeId: options.storeId,
          railId: options.railId,
          memo,
          actorUserId,
          assertions,
        })
      })
    } catch (error) {
      // The loser of a claim race. Its own row rolled back with the
      // transaction; the winner's stands, and `already_posted` is a SUCCESS.
      if (error instanceof AlreadyClaimed) {
        outcome = { kind: 'posted', claim: { kind: 'existing', row: error.row } }
      }
      // 🛑 The claim's `ON CONFLICT DO NOTHING` swallows a conflict on
      // `GlPostingSource_claim_key` and no other. A violation of
      // `GlPosting_org_docNumber_key` still raises SQLSTATE 23505 out of a
      // statement that looks defended, and without this it escapes as an
      // anonymous 500 naming a constraint the reader has never heard of.
      const constraint = outcome ? null : uniqueViolationConstraint(error)
      if (constraint !== null) {
        const detail =
          constraint === 'GlPosting_org_docNumber_key'
            ? `Document number ${docNumber} is already used by a different posting in this organization. ` +
              'Two posting identities minted the same number - the document-number keyspace is wrong, not the entry.'
            : `A unique constraint (${constraint || 'unknown'}) rejected the claim for ${docNumber}.`
        logger.error('Claim rejected by a constraint other than the source claim', {
          organizationId,
          docNumber,
          constraint,
        })
        return {
          status: 'error',
          failureClass: 'data',
          retryable: false,
          error: detail,
          docNumber,
        }
      }
      if (!outcome) {
        if (error instanceof AuxxError) {
          return { status: 'error', failureClass: 'data', retryable: false, error: error.message }
        }
        throw error
      }
    }

    if (!prepared) throw new Error('Posting preparation returned no result')
    if (prepared.refusal) {
      logger.warn('Refusing to post', {
        organizationId,
        postingType: entry.postingType,
        periodKey: entry.periodKey,
        status: prepared.refusal.status,
        error: prepared.refusal.error,
      })
      return {
        status: prepared.refusal.status,
        failureClass: prepared.refusal.failureClass,
        // A configuration or data refusal is never retried: retrying cannot
        // change the answer, and the operator has to change something first.
        retryable: false,
        error: prepared.refusal.error,
        ...(prepared.refusal.items?.length ? { items: prepared.refusal.items } : {}),
        docNumber: prepared.docNumber || undefined,
      }
    }
    if (!outcome) throw new Error('Posting write returned no result')
    const { lines } = prepared

    if (outcome.kind === 'drafted') {
      logger.info('Entry drafted - it holds no claim and no document number', {
        organizationId,
        postingType: entry.postingType,
        glPostingId: outcome.glPostingId,
      })
      return { status: 'drafted', glPostingId: outcome.glPostingId }
    }

    const claim = outcome.claim

    if (claim.kind === 'existing') {
      // A SUCCESS, and since the export split it is a HONEST one: the row that
      // holds this claim is in the books, whatever its export did. Before the
      // split this same return could hand back the id of a row that had been
      // taken out of every report, and the caller would stamp it and move on.
      //
      // Logged at info, never as an error: training everyone to ignore this
      // channel is how a real double-post would go unnoticed.
      //
      // A row whose EXPORT is still owed is re-pushed by `retryExport`, which
      // reuses that row's claimed `requestId` and `docNumber`. It is not this
      // function's job and never was.
      logger.info('Source already claimed - not posting again', {
        organizationId,
        postingType: entry.postingType,
        periodKey: entry.periodKey,
        revision,
        glPostingId: claim.row.id,
        existingStatus: claim.row.status,
        existingExportStatus: claim.row.exportStatus,
      })
      return {
        status: 'already_posted',
        exportStatus: claim.row.exportStatus,
        glPostingId: claim.row.id,
        docNumber: claim.row.docNumber ?? undefined,
        providerId: claim.row.providerId ?? undefined,
        providerEntryId: claim.row.providerEntryId ?? undefined,
      }
    }

    const glPostingId = claim.row.id

    // ── The provider, after the claim has committed ────────────────────────
    // This is the first and only reader of `EXPORT_ROUTE_BY_POSTING_TYPE`.
    // `'none'` short-circuits to `NONE_ACCOUNTING_PROVIDER` instead of the
    // org's connected one, so a route never reaches this file's own provider
    // call. Do not branch other posting types here - the route table is the
    // one place that decides this.
    const routedToNone = EXPORT_ROUTE_BY_POSTING_TYPE[entry.postingType] === 'none'
    const provider = routedToNone
      ? NONE_ACCOUNTING_PROVIDER
      : await resolveAccountingProvider(organizationId)
    const input: PostEntryInput = {
      organizationId,
      glPostingId,
      revision,
      postingType: entry.postingType,
      periodKey: entry.periodKey,
      txnDate: entry.txnDate,
      docNumber: claim.row.docNumber ?? docNumber,
      lines: lines.map((line) => line.resolved),
      // Read back from the claimed row, never recomputed. The row is the record
      // of what key this entry was pushed under.
      idempotencyKey: claim.row.requestId,
      memo,
    }

    const pushed = await provider.postEntry(input)

    if (pushed.isErr()) {
      const failure = classifyProviderFailure(pushed.error, provider.id)
      await stampOutcome(organizationId, glPostingId, () =>
        recordExportFailure(db, {
          organizationId,
          glPostingId,
          providerId: provider.id,
          reason: failure.error,
        })
      )
      logger.error('The provider refused the EXPORT. The entry is posted', {
        organizationId,
        glPostingId,
        docNumber,
        providerId: provider.id,
        failureClass: failure.failureClass,
        retryable: failure.retryable,
        error: failure.error,
      })
      // 🛑 `posted`, not `error`. The ledger took this entry - it built,
      // balanced, resolved its roles, cleared the period lock and committed
      // with its lines - and a third party declining a COPY of it changes none
      // of that. Returning `error` here is what made callers roll back a good
      // document and what took the entry out of every report.
      //
      // The export problem is not swallowed: it is on the row, it is on this
      // result as `exportStatus` plus `error`, it is logged above, and
      // `listFailedExports` is the queue that surfaces it.
      return {
        status: 'posted',
        exportStatus: 'failed',
        glPostingId,
        docNumber,
        providerId: provider.id,
        ...failure,
      }
    }

    const result = pushed.value

    // 🛑 A `'none'` ROUTE is not a missing integration, and must not say it is.
    //
    // `NONE_ACCOUNTING_PROVIDER` answers `not_connected` because from its own
    // point of view that is true - it has nothing to push to. But it was handed
    // this entry by the route table, not by the org's lack of a provider, and
    // the org may well have QuickBooks connected. Reporting `not_connected`
    // there made the close console tell a connected org it had no accounting
    // system, sending a reader to debug a healthy connection (brief 22 §5).
    //
    // The translation lives HERE because this is the only place that knows
    // which of the two reasons applied: the provider cannot tell, and the row
    // records the same `exportStatus` either way.
    const status: PostEntryStatus =
      routedToNone && result.status === 'not_connected' ? 'not_exported' : result.status

    // Nothing was pushed and nothing is owed. `not_exported` joins the set for
    // the same reason it exists - it pushed nothing BY DESIGN, so an export is
    // not merely absent, it is never coming.
    const exportStatus =
      status === 'not_connected' || status === 'disabled' || status === 'not_exported'
        ? ('not_required' as const)
        : ('exported' as const)
    await stampOutcome(organizationId, glPostingId, () =>
      markExported(db, {
        organizationId,
        glPostingId,
        providerId: result.providerId,
        providerEntryId: result.externalId || null,
        // The company the id above belongs to. `null` for `none` and for every
        // adapter that has no tenant - see `markExported`.
        providerTenantId: result.tenantId || null,
        exportStatus,
      })
    )

    logger.info('Entry posted', {
      organizationId,
      glPostingId,
      docNumber,
      providerId: result.providerId,
      providerStatus: result.status,
      lineCount: lines.length,
    })

    return {
      status,
      exportStatus,
      glPostingId,
      docNumber,
      providerId: result.providerId,
      providerEntryId: result.externalId || undefined,
      providerTenantId: result.tenantId || undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Posting failed', {
      organizationId,
      postingType: entry.postingType,
      periodKey: entry.periodKey,
      error: message,
    })
    // `transport` because an unexpected throw on this path is overwhelmingly an
    // io failure - a dropped connection, a timed-out statement. `retryable` is
    // decided separately and conservatively: see `classifyProviderFailure`.
    // `PostFailureClass` documents transport as the only class worth retrying,
    // which makes transport NECESSARY for a retry, not sufficient for one.
    return { status: 'error', failureClass: 'transport', retryable: false, error: message }
  }
}

/**
 * Classify a provider's failure.
 *
 * The core cannot classify a provider's fault itself - what separates a
 * permanent fault from a transient one is that provider's own error vocabulary
 * - so an adapter returns {@link ProviderPostError} and this routes it.
 *
 * 🛑 **An unclassified `Error` is treated as NOT retryable.** The argument is
 * asymmetric cost. An unclassified throw out of an adapter includes the worst
 * case there is: the entry WAS accepted and the connection dropped on the way
 * back. Retrying that is safe only if the adapter has its own idempotency
 * ladder, and the core cannot assume one exists - that is the entire reason
 * this seam is provider-agnostic. Against that, the cost of refusing to
 * auto-retry a transient 503 is one human clicking Post again, and under
 * decision G5 a human is already watching. So: mark it, do not retry it, and
 * let an adapter that knows better say so by returning a `ProviderPostError`.
 */
function classifyProviderFailure(
  error: Error,
  providerId: string
): { error: string; failureClass: PostFailureClass; retryable: boolean } {
  if (error instanceof ProviderPostError) {
    return {
      error: error.faultCode
        ? `${error.message} (${providerId} fault ${error.faultCode})`
        : error.message,
      failureClass: error.failureClass,
      retryable: error.retryable,
    }
  }
  return { error: error.message, failureClass: 'transport', retryable: false }
}

/**
 * Run the outcome stamp, and never let its failure rewrite the ANSWER.
 *
 * By the time either stamp runs the provider has already answered, so a failure
 * here is a bookkeeping failure and not a posting one. Letting it reach
 * `postEntry`'s outer catch would return `{ status: 'error' }` with no
 * `glPostingId` - and an absent `glPostingId` is documented as the caller's
 * signal that NOTHING WAS WRITTEN, which would be a lie about an entry that is
 * sitting in a general ledger.
 *
 * The row is left `pending`, which is the correct state for it: claimed, pushed,
 * unconfirmed. That is precisely the crash-in-flight case the adapter's layer-2
 * document-number heal exists to repair on the next attempt.
 */
async function stampOutcome(
  organizationId: string,
  glPostingId: string,
  stamp: () => Promise<void>
): Promise<void> {
  try {
    await stamp()
  } catch (error) {
    logger.error('Posting outcome could not be recorded - the row stays pending', {
      organizationId,
      glPostingId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Stamp the EXPORT's success. Never the ledger's - that was settled in the
 * claim, and this function must not be able to unsettle it.
 *
 * `not_connected` and `disabled` land here too, as `not_required`: an
 * organization with no accounting system has nothing in flight and nothing to
 * heal, and leaving it `pending` would park every entry it ever writes in the
 * export queue forever. `providerId` is `'none'`, `providerEntryId` stays NULL -
 * which is also why `GlPosting_org_provider_entry_key` is partial - and so does
 * `providerTenantId`, because nothing reached a provider to have a tenant at.
 *
 * ⚠️ `attempts` is NOT reset. It is the record that this export was hard, which
 * is the thing worth keeping when somebody asks why a month took three days.
 *
 * 🛑 `failureReason` IS cleared, and the asymmetry with `attempts` is deliberate
 * (task 24 §6.2). A count of attempts stays true after a success; the REASON the
 * last attempt failed does not - it names a refusal that no longer applies to a
 * row that is now exported, and every screen that reads the column reads it as
 * current. `retry-export.ts` clears it in the same breath, and the two must stay
 * in step.
 */
async function markExported(
  db: Database,
  input: {
    organizationId: string
    glPostingId: string
    providerId: string
    providerEntryId: string | null
    providerTenantId: string | null
    exportStatus: 'exported' | 'not_required'
  }
): Promise<void> {
  await db
    .update(schema.GlPosting)
    .set({
      exportStatus: input.exportStatus,
      providerId: input.providerId,
      providerEntryId: input.providerEntryId,
      providerTenantId: input.providerTenantId,
      failureReason: null,
    })
    .where(
      and(
        eq(schema.GlPosting.id, input.glPostingId),
        eq(schema.GlPosting.organizationId, input.organizationId)
      )
    )
}

/**
 * Stamp a refused push.
 *
 * 🛑 **`status` is not in this statement and must never be.** The entry is in
 * the books; a third party declining a copy of it does not change that. This is
 * the whole defect `plans/accounting/export-state-split.md` exists to close, and
 * a `status` write here reopens it.
 *
 * The row keeps its claim, its lines and its `requestId`, which is exactly what
 * `retryExport` replays.
 */
async function recordExportFailure(
  db: Database,
  input: { organizationId: string; glPostingId: string; providerId: string; reason: string }
): Promise<void> {
  await db
    .update(schema.GlPosting)
    .set({
      exportStatus: 'failed',
      failureReason: input.reason,
      providerId: input.providerId,
      attempts: sql`${schema.GlPosting.attempts} + 1`,
    })
    .where(
      and(
        eq(schema.GlPosting.id, input.glPostingId),
        eq(schema.GlPosting.organizationId, input.organizationId)
      )
    )
}

export interface PostDraftOptions {
  organizationId: string
  /** A `GlPosting` row in status `draft`. */
  glPostingId: string
  actorUserId?: string
  /** Preview context. The commit re-reads the authoritative lock in its transaction. */
  lock: PeriodLock
}

/**
 * Promote a draft: re-resolve its roles, re-check the period lock, claim,
 * number, flip to `posted`.
 *
 * **Never throws.** Refusals are {@link PostResult}s, exactly as `postEntry`'s.
 *
 * 🛑 Everything is re-checked rather than trusted from the draft. A draft can
 * sit in the queue across a close, a role remap or a chart edit, and approving
 * one must not post an entry whose accounts no longer exist. The lines are NOT
 * rebuilt from the source - the draft's own `built` envelope is the entry - so
 * what a reviewer approved is what posts.
 */
export async function postDraft(db: Database, options: PostDraftOptions): Promise<PostResult> {
  const { organizationId, glPostingId, actorUserId } = options

  try {
    const [row] = await db
      .select({
        id: schema.GlPosting.id,
        status: schema.GlPosting.status,
        revision: schema.GlPosting.revision,
        built: schema.GlPosting.built,
      })
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.id, glPostingId),
          eq(schema.GlPosting.organizationId, organizationId)
        )
      )
      .limit(1)

    if (!row) {
      return {
        status: 'error',
        failureClass: 'data',
        retryable: false,
        error: `No posting ${glPostingId} in this organization.`,
      }
    }
    if (row.status !== 'draft') {
      return {
        status: 'error',
        failureClass: 'data',
        retryable: false,
        error: `Posting ${glPostingId} is ${row.status}, not draft. Only a draft can be posted.`,
        glPostingId,
      }
    }

    const envelope = parsePostingDraft(row.built)
    const entry = envelope.entry

    const subject = envelope.sources?.find((source) => source.linkRole === 'subject')
    if (!subject) {
      return {
        status: 'error',
        failureClass: 'data',
        retryable: false,
        error: `Draft ${glPostingId} carries no subject source, so there is no claim to take.`,
        glPostingId,
      }
    }

    let prepared: PreparedEntry | undefined
    let claimed: { heldBy: string } | null = null
    await db.transaction(async (tx) => {
      await withAccountingCommitLock(tx, organizationId)
      const authoritativeLock = await resolvePeriodLock(organizationId, tx)
      prepared = await prepareEntry(tx, {
        organizationId,
        entry,
        lock: authoritativeLock,
        revision: row.revision,
      })
      if (prepared.refusal) return
      claimed = await claimSubjectInTx(tx, { organizationId, glPostingId, subject })
      if (claimed) return
      await markPostedInTx(tx, {
        organizationId,
        glPostingId,
        docNumber: prepared.docNumber,
        requestId: prepared.requestId,
        actorUserId,
      })
    })

    if (!prepared) throw new Error('Draft preparation returned no result')
    if (prepared.refusal) {
      return {
        status: prepared.refusal.status,
        failureClass: prepared.refusal.failureClass,
        retryable: false,
        error: prepared.refusal.error,
        ...(prepared.refusal.items?.length ? { items: prepared.refusal.items } : {}),
        glPostingId,
      }
    }
    if (claimed) {
      const holder: { heldBy: string } = claimed
      logger.info('Source already claimed - the draft was not posted', {
        organizationId,
        glPostingId,
        heldBy: holder.heldBy,
      })
      return { status: 'already_posted', glPostingId: holder.heldBy }
    }

    logger.info('Draft posted', { organizationId, glPostingId, docNumber: prepared.docNumber })
    return {
      status: 'posted',
      exportStatus: 'pending',
      glPostingId,
      docNumber: prepared.docNumber,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Posting a draft failed', { organizationId, glPostingId, error: message })
    return { status: 'error', failureClass: 'transport', retryable: false, error: message }
  }
}
