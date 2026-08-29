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
// can persist the outcome without a try/catch of its own. `sync-invoice.ts` is
// the shape.
//
// No permission checks here. The router asserts (docs/lib-module-guide.md §6).

import { createHash } from 'node:crypto'
import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { formatCurrency } from '@auxx/utils'
import { and, eq, sql } from 'drizzle-orm'
import { databaseErrorCodes, UnprocessableEntityError } from '../errors'
import { buildDocNumber } from './doc-number'
import { buildPostingDraft, type PostingAssertions, requiresAssertions } from './draft'
import { assertPeriodOpen, type PeriodLock, parsePeriodKey } from './periods'
import { resolveAccountingProvider } from './provider'
import { resolveRoles } from './resolve-roles'
import type {
  BuiltEntry,
  PostEntryInput,
  PostFailureClass,
  PostingType,
  PostResult,
  PostResultStatus,
  ResolvedPostingLine,
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
export const LEDGER_CURRENCY = 'USD'

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
   * The period lock, resolved by the caller. `periods.ts` deliberately takes it
   * as an argument so it stays pure and so the lock can mean the same thing in
   * ledger mode (ours) and in subledger mode (the provider's closed book).
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
}

export interface PreviewEntryOptions {
  organizationId: string
  entry: BuiltEntry
  lock: PeriodLock
}

export interface EntryPreview {
  postingType: PostingType
  periodKey: string
  txnDate: string
  docNumber: string
  lines: ResolvedPostingLine[]
  totalMinor: number
  /** Non-empty when the preview would refuse: the same statuses `postEntry` returns. */
  blockedBy?: { status: PostResultStatus; error: string }
}

/** One line after resolution, paired with the role it was resolved FROM. */
interface PreparedLine {
  /**
   * The role the builder emitted. Stored on the `GlPostingLine` row (decision
   * G8) so a posted line can still answer "which account was this SUPPOSED to
   * be" after the chart is renumbered - and never handed to a provider.
   */
  accountRole: string
  resolved: ResolvedPostingLine
}

interface Refusal {
  status: PostResultStatus
  failureClass: PostFailureClass
  error: string
}

interface PreparedEntry {
  docNumber: string
  requestId: string
  lines: PreparedLine[]
  totalMinor: number
  /** Set when the entry must not be claimed. Everything above is best-effort. */
  refusal?: Refusal
}

/**
 * The key the PERIOD LOCK is evaluated against, which is not always
 * `entry.periodKey`.
 *
 * 🛑 **Two posting types key on an id rather than a date.** `build` keys on
 * `build.number` (`'BLD-0007'`) and `payout` on the payout id, both deliberately
 * - two builds or two payouts in one day would otherwise collide into one entry
 * (see `DocNumberInput`). `parsePeriodKey` throws `BadRequestError` on either,
 * and `isPeriodLocked` short-circuits to `false` while `lockedThroughMonth` is
 * null, so the throw is invisible until an organization closes its FIRST month
 * - at which point every build and payout posting starts failing at once. That
 * is the worst possible moment to discover it.
 *
 * The honest resolution is that those entries do have a month: `txnDate` is the
 * accounting date, it is `YYYY-MM-DD` by contract, and it is the date whose
 * financial statements a lock is protecting. So the lock is evaluated against
 * the period key when the key IS a period, and against the transaction date
 * when it is an id. For every other posting type the two agree by construction,
 * because the period key is derived from the same date.
 *
 * This is not a fallback that guesses. It is the lock reading the field that
 * actually carries the accounting month, and it does not invent a mapping from
 * a payout id to a period.
 */
function lockKeyFor(entry: BuiltEntry): string {
  try {
    parsePeriodKey(entry.periodKey)
    return entry.periodKey
  } catch {
    return entry.txnDate
  }
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
async function prepareEntry(
  db: Database,
  options: { organizationId: string; entry: BuiltEntry; lock: PeriodLock; revision: number }
): Promise<PreparedEntry> {
  const { organizationId, entry, lock, revision } = options
  let refusal: Refusal | undefined

  // ── 1. The period ────────────────────────────────────────────────────────
  // `assertPeriodOpen` THROWS and this function must not, so it is caught and
  // mapped - and it throws TWO different things, which must not collapse into
  // one result. `UnprocessableEntityError` is the period being closed;
  // `BadRequestError`, out of `parsePeriodKey`, is a key that is not a date at
  // all. Reporting the second as `period_closed` sends a bookkeeper to reopen a
  // month that was never the problem.
  try {
    assertPeriodOpen(lockKeyFor(entry), lock)
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
  const roles = [...new Set(entry.lines.map((line) => line.accountRole))]
  const resolved = await resolveRoles(db, organizationId, roles)

  const lines: PreparedLine[] = []
  if (resolved.isErr()) {
    refusal ??= {
      status: 'account_unmapped',
      failureClass: 'configuration',
      error: resolved.error.message,
    }
  } else {
    const accounts = resolved.value
    // Sorted once, here: `lineNumber` is derived from this order and is unique
    // per posting, so the order the rows are written in IS the order a
    // bookkeeper reads them in.
    const ordered = [...entry.lines].sort((a, b) => a.sortOrder - b.sortOrder)
    for (const line of ordered) {
      const account = accounts.get(line.accountRole)
      if (!account) {
        // Unreachable: `resolveRoles` refuses rather than omit a role. Asserted
        // because the alternative is a line with no account code.
        refusal ??= {
          status: 'account_unmapped',
          failureClass: 'configuration',
          error: `Role '${line.accountRole}' resolved to nothing. Refusing to post a line with no account.`,
        }
        break
      }
      lines.push({
        accountRole: line.accountRole,
        resolved: {
          direction: line.direction,
          amount: line.amount,
          memo: line.memo,
          sourceType: line.sourceType,
          sourceId: line.sourceId,
          sortOrder: line.sortOrder,
          // Both are SNAPSHOTS. Renaming 2160 next year must not rewrite last
          // year's ledger, exactly as a standard-cost change does not restate a
          // movement's frozen cost.
          accountCode: account.code,
          accountName: account.name || undefined,
        },
      })
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
function uniqueViolationConstraint(error: unknown): string | null {
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
  const { organizationId, entry, lock } = options
  // A preview is always of an original. A reversal is previewed by reading the
  // posting it reverses, which is `reverseEntry`'s job, not a fresh draft's.
  const prepared = await prepareEntry(db, { organizationId, entry, lock, revision: 0 })

  return {
    postingType: entry.postingType,
    periodKey: entry.periodKey,
    txnDate: entry.txnDate,
    docNumber: prepared.docNumber,
    lines: prepared.lines.map((line) => line.resolved),
    totalMinor: prepared.totalMinor,
    blockedBy: prepared.refusal
      ? { status: prepared.refusal.status, error: prepared.refusal.error }
      : undefined,
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
  const { organizationId, entry, actorUserId, memo, lock, reversesId, assertions } = options
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

    const prepared = await prepareEntry(db, { organizationId, entry, lock, revision })
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
        docNumber: prepared.docNumber || undefined,
      }
    }

    const { docNumber, requestId, lines, totalMinor } = prepared

    // ── The claim, plus its lines, in one transaction ──────────────────────
    let claim: ClaimOutcome
    try {
      claim = await claimPeriod(db, {
        organizationId,
        entry,
        revision,
        reversesId,
        docNumber,
        requestId,
        totalMinor,
        lines,
        memo,
        actorUserId,
        assertions,
      })
    } catch (error) {
      // 🛑 `ON CONFLICT (organizationId, postingType, periodKey, revision) DO
      // NOTHING` swallows a conflict on THAT index and no other. A violation of
      // `GlPosting_org_docNumber_key` or `GlPosting_org_provider_entry_key`
      // still raises SQLSTATE 23505 out of a statement that looks defended, and
      // without this it escapes as an anonymous 500 naming a constraint the
      // reader has never heard of.
      const constraint = uniqueViolationConstraint(error)
      if (constraint !== null) {
        const detail =
          constraint === 'GlPosting_org_docNumber_key'
            ? `Document number ${docNumber} is already used by a different posting in this organization. ` +
              'Two posting identities minted the same number - the document-number keyspace is wrong, not the entry.'
            : `A unique constraint (${constraint || 'unknown'}) rejected the claim for ${docNumber}.`
        logger.error('Claim rejected by a constraint other than the period claim', {
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
      throw error
    }

    if (claim.kind === 'existing') {
      // A SUCCESS. Logged at info, never as an error: training everyone to
      // ignore this channel is how a real double-post would go unnoticed.
      //
      // ⚠️ This converges even when the existing row is `failed`. Re-pushing a
      // failed row is a distinct operation - it must reuse that row's claimed
      // `requestId` and `docNumber` rather than mint new ones - and it does not
      // belong on the create path. It is owed.
      logger.info('Period already claimed - not posting again', {
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
        docNumber: claim.row.docNumber,
        providerId: claim.row.providerId ?? undefined,
        providerEntryId: claim.row.providerEntryId ?? undefined,
      }
    }

    const glPostingId = claim.row.id

    // ── The provider, after the claim has committed ────────────────────────
    const provider = await resolveAccountingProvider(organizationId)
    const input: PostEntryInput = {
      organizationId,
      glPostingId,
      revision,
      postingType: entry.postingType,
      periodKey: entry.periodKey,
      txnDate: entry.txnDate,
      docNumber: claim.row.docNumber,
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
        recordFailure(db, {
          organizationId,
          glPostingId,
          providerId: provider.id,
          reason: failure.error,
        })
      )
      logger.error('Provider refused the entry', {
        organizationId,
        glPostingId,
        docNumber,
        providerId: provider.id,
        failureClass: failure.failureClass,
        retryable: failure.retryable,
        error: failure.error,
      })
      return {
        status: 'error',
        glPostingId,
        docNumber,
        providerId: provider.id,
        ...failure,
      }
    }

    const result = pushed.value
    await stampOutcome(organizationId, glPostingId, () =>
      markPosted(db, {
        organizationId,
        glPostingId,
        providerId: result.providerId,
        providerEntryId: result.externalId || null,
        actorUserId,
        reversesId,
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
      status: result.status,
      glPostingId,
      docNumber,
      providerId: result.providerId,
      providerEntryId: result.externalId || undefined,
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

type ClaimOutcome =
  | { kind: 'claimed'; row: { id: string; docNumber: string; requestId: string } }
  | {
      kind: 'existing'
      row: {
        id: string
        docNumber: string
        status: string
        providerId: string | null
        providerEntryId: string | null
      }
    }

/**
 * Claim `(organizationId, postingType, periodKey, revision)` and write the
 * lines, in one transaction.
 *
 * The lines are here rather than after the commit because a claimed header with
 * no lines is a ledger row that balances to nothing - and it holds the period,
 * so no later run can repair it.
 */
async function claimPeriod(
  db: Database,
  input: {
    organizationId: string
    entry: BuiltEntry
    revision: number
    reversesId?: string
    docNumber: string
    requestId: string
    totalMinor: number
    lines: PreparedLine[]
    memo?: string
    actorUserId?: string
    assertions?: PostingAssertions
  }
): Promise<ClaimOutcome> {
  const { organizationId, entry, revision, reversesId, docNumber, requestId, totalMinor, lines } =
    input

  return db.transaction(async (tx) => {
    const claimed = await tx
      .insert(schema.GlPosting)
      .values({
        organizationId,
        postingType: entry.postingType,
        periodKey: entry.periodKey,
        revision,
        status: 'pending',
        txnDate: entry.txnDate,
        docNumber,
        // Explicit, never the column default - see LEDGER_CURRENCY.
        currency: LEDGER_CURRENCY,
        totalMinor,
        // The audit record of WHAT WAS POSTED. The built entry verbatim PLUS
        // the resolved lines, not a hint for reconstructing them: rebuilding
        // from the subledger later gives a different answer once the subledger
        // moves, which is the one property a ledger must not have.
        // One construction site, in `draft.ts`, because this shape is no longer
        // written-and-never-read: the L1 month-end reader reads the previous
        // month's envelope to learn what balance was last asserted.
        draft: buildPostingDraft({
          docNumber,
          revision,
          memo: input.memo,
          entry,
          resolvedLines: lines.map((line) => ({
            accountRole: line.accountRole,
            ...line.resolved,
          })),
          assertions: input.assertions,
        }),
        requestId,
        // A reversal names its original in the INSERT. `GlPosting_reversal_check`
        // makes inserting-then-linking impossible.
        reversesId: reversesId ?? null,
        // Who claimed is who posted: decision G5's trigger is a person clicking
        // Post, synchronously, and recording the actor now keeps the attribution
        // even if the push then fails.
        postedByUserId: input.actorUserId ?? null,
      })
      .onConflictDoNothing({
        target: [
          schema.GlPosting.organizationId,
          schema.GlPosting.postingType,
          schema.GlPosting.periodKey,
          schema.GlPosting.revision,
        ],
      })
      .returning({
        id: schema.GlPosting.id,
        docNumber: schema.GlPosting.docNumber,
        requestId: schema.GlPosting.requestId,
      })

    const row = claimed[0]
    if (!row) {
      // Someone owns the period. Under genuine concurrency this statement
      // BLOCKED on the winner's uncommitted index tuple and resumed once it
      // committed, so the row is visible to this read.
      const existing = await tx
        .select({
          id: schema.GlPosting.id,
          docNumber: schema.GlPosting.docNumber,
          status: schema.GlPosting.status,
          providerId: schema.GlPosting.providerId,
          providerEntryId: schema.GlPosting.providerEntryId,
        })
        .from(schema.GlPosting)
        .where(
          and(
            eq(schema.GlPosting.organizationId, organizationId),
            eq(schema.GlPosting.postingType, entry.postingType),
            eq(schema.GlPosting.periodKey, entry.periodKey),
            eq(schema.GlPosting.revision, revision)
          )
        )
        .limit(1)

      const found = existing[0]
      if (!found) {
        // The insert wrote nothing and the read found nothing. That is not a
        // conflict, it is a broken claim, and swallowing it would report a
        // double-post defence that is not running.
        throw new Error(
          `Claim for ${docNumber} returned no row and no conflicting posting exists. ` +
            'The ON CONFLICT target may no longer match GlPosting_org_type_period_revision_key.'
        )
      }
      return { kind: 'existing', row: found }
    }

    if (lines.length > 0) {
      await tx.insert(schema.GlPostingLine).values(
        lines.map((line, index) => ({
          organizationId,
          glPostingId: row.id,
          // 1-based and derived from the built order, which `prepareEntry`
          // sorted by `sortOrder`. Unique per posting
          // (`GlPostingLine_posting_lineNumber_key`).
          lineNumber: index + 1,
          accountCode: line.resolved.accountCode,
          accountRole: line.accountRole,
          accountName: line.resolved.accountName ?? null,
          direction: line.resolved.direction,
          amountMinor: line.resolved.amount,
          memo: line.resolved.memo ?? null,
          sourceType: line.resolved.sourceType,
          sourceId: line.resolved.sourceId,
        }))
      )
    }

    return { kind: 'claimed', row }
  })
}

/**
 * Stamp the successful outcome.
 *
 * 🛑 **One `UPDATE`.** `GlPosting_posted_check` is
 * `status <> 'posted' OR postedAt IS NOT NULL`, so setting the status in one
 * statement and the timestamp in another violates the constraint in between.
 *
 * `not_connected` lands here too, and is marked `posted`. An organization with
 * no accounting system has nothing in flight and nothing to heal, so leaving
 * the row `pending` would park every entry it ever writes in the retry queue
 * and in the close console's work list forever. `providerId` is `'none'` and
 * `providerEntryId` stays NULL, which is also why
 * `GlPosting_org_provider_entry_key` is partial.
 */
async function markPosted(
  db: Database,
  input: {
    organizationId: string
    glPostingId: string
    providerId: string
    providerEntryId: string | null
    actorUserId?: string
    reversesId?: string
  }
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.GlPosting)
      .set({
        status: 'posted',
        postedAt: new Date(),
        providerId: input.providerId,
        providerEntryId: input.providerEntryId,
        failureReason: null,
      })
      .where(
        and(
          eq(schema.GlPosting.id, input.glPostingId),
          eq(schema.GlPosting.organizationId, input.organizationId)
        )
      )

    // The original flips to `reversed` in the SAME transaction that marks the
    // reversal `posted` (decision G4). Guarded on `posted` so a second reversal
    // of the same entry cannot silently re-flip a row that has already moved.
    if (input.reversesId) {
      await tx
        .update(schema.GlPosting)
        .set({ status: 'reversed' })
        .where(
          and(
            eq(schema.GlPosting.id, input.reversesId),
            eq(schema.GlPosting.organizationId, input.organizationId),
            eq(schema.GlPosting.status, 'posted')
          )
        )
    }
  })
}

/** Stamp a failed push. The row keeps its claim, its lines and its `requestId`. */
async function recordFailure(
  db: Database,
  input: { organizationId: string; glPostingId: string; providerId: string; reason: string }
): Promise<void> {
  await db
    .update(schema.GlPosting)
    .set({
      status: 'failed',
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
