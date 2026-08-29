// packages/lib/src/money/quickbooks/quickbooks-accounting-provider.ts
//
// The QuickBooks `AccountingProvider` adapter: the half of the poster that is
// QuickBooks' and nobody else's.
//
// The provider-agnostic core (`postings/post-entry.ts`) owns resolve, claim,
// persist and record. It hands this adapter a balanced entry whose lines already
// carry account CODES from the org's own chart, and it writes back whatever id
// comes out. This file owns three things the core cannot: turning a code into a
// QuickBooks account id, QuickBooks' `DocNumber`, and QuickBooks' `requestid`.
//
// Registered from the APP layer via `registerAccountingProvider`, never imported
// by `packages/lib` itself. That direction is decision P1: the ledger is ours
// whether or not anything is connected, so nothing in the posting core may
// depend on a specific accounting integration. See `postings/provider.ts`.
//
// ── Why several layers of idempotency ───────────────────────────────────────
//
// A double-posted journal entry silently misstates the financial statements.
// There is no invoice and no payment to reconcile it against, so nobody notices
// until a close does not tie out. One guard is not enough, because each one has
// a window the next covers:
//
//   1. PRIMARY (the core's, NOT here). `INSERT ... ON CONFLICT (organizationId,
//      postingType, periodKey, revision) DO NOTHING` on the `GlPosting` table.
//      Authoritative, ours, no expiry. It used to be an id-map field on a
//      `gl_posting` EntityInstance; entity migration 114 retired that def and
//      task 10 moved the guard onto the table's unique index.
//
//      🛑 Layer 1 protects OUR row. Layer 2 protects THEIRS. The fact that
//      Postgres now enforces layer 1 is not a reason to drop layer 2: our row
//      says what we intended, not what QuickBooks actually holds.
//
//   2. SECONDARY  deterministic `DocNumber` + query-before-insert, and on a hit
//      we HEAL rather than post. This catches what layer 1 cannot: a previous
//      run posted and then crashed before recording the id. This is the single
//      most valuable failure mode in the file.
//
//   3. INNERMOST  `requestid` on the POST itself, from `input.idempotencyKey`.
//      Covers the race layers 1-2 share: read (empty) -> query (empty) -> POST
//      -> timeout -> retry. Without it that retry double-posts even though both
//      checks were correct at the moment they ran.
//
//      🛑 The key carries NO run salt. The core derives it from the posting
//      identity, writes it to `GlPosting.requestId` at claim time and reuses it
//      verbatim on every retry. Two runs of the same period MUST produce the
//      same key, or Intuit's idempotency never fires on the one case it exists
//      for. This adapter passes it through and never derives its own.
//
//   4. FORENSIC   a `PrivateNote` stamp, for a human reading the QBO register
//      and asking where a summary entry came from. Never a lookup key:
//      `PrivateNote` is not filterable, which is exactly why `DocNumber` carries
//      the lookup job in layer 2.
//
// And one more that is not a layer so much as a net: after ANY create failure we
// re-query by `DocNumber` before reporting it. That converges the case where the
// POST landed but the response did not, and it is why duplicate detection here
// does not depend on recognising QuickBooks' duplicate-document-number fault
// code (see `classifyQuickbooksFailure`).

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import type { AccountingProvider } from '../../postings/provider'
import {
  type PostEntryInput,
  type PostEntryResult,
  type PostFailureClass,
  ProviderPostError,
} from '../../postings/types'
import { getOrganizationSetting } from '../../settings/settings-service'
import { type QuickbooksToolContext, resolveQuickbooksContext } from './invoke-quickbooks-tool'

const logger = createScopedLogger('quickbooks-accounting-provider')

/** The id this adapter registers under. Must match the connected-provider resolver. */
export const QUICKBOOKS_PROVIDER_ID = 'quickbooks'

const TOOL_LIST_ACCOUNTS = 'list_quickbooks_accounts'
const TOOL_FIND_JOURNAL_ENTRY = 'find_quickbooks_journal_entry'
const TOOL_CREATE_JOURNAL_ENTRY = 'create_quickbooks_journal_entry'

/** QuickBooks caps `PrivateNote` at 4000 characters and rejects a longer one. */
const PRIVATE_NOTE_MAX_LENGTH = 4000

/**
 * One journal entry line in the shape `create_quickbooks_journal_entry` takes.
 *
 * Local and unexported on purpose. It is QuickBooks' vocabulary - `Debit`,
 * `Credit`, an account ID - and the only place in auxx that is allowed to know
 * it is this adapter. `ResolvedPostingLine` is what crosses the seam in.
 *
 * Amounts stay in integer MINOR units; the app-side tool converts to QBO's
 * major-unit decimal in exactly one place (`build-journal-lines.ts`).
 */
interface QboJournalLine {
  amountMinor: number
  postingType: 'Debit' | 'Credit'
  accountId: string
  accountName?: string
  description?: string
}

/** The subset of `list_quickbooks_accounts`' mapped account this adapter reads. */
interface QboAccount {
  id: string
  name: string
  fullyQualifiedName: string
  /** The account NUMBER ('1310'), not the id. Null when the company has none. */
  acctNum: string | null
  active: boolean
}

/**
 * Read QuickBooks' own fault code off a thrown error.
 *
 * 🛑 Duck-typed, deliberately. The reader that owns this contract
 * (`quickbooksFault()`) lives in the QuickBooks APP, a separate repository
 * (`~/Sites/auxxai-apps/apps/quickbooks/src/blocks/quickbooks/shared/quickbooks-api.ts`),
 * so it cannot be imported here. It attaches the parsed `Fault.Error[0]` as a
 * NON-ENUMERABLE `quickbooksFault` property, which keeps the error's class and
 * message untouched.
 *
 * ⚠️ Non-enumerable also means `JSON.stringify` drops it, so the code survives
 * only while the error is thrown IN THIS PROCESS. A fault raised inside the
 * Lambda sandbox is serialized on the way out and `invoke-quickbooks-tool.ts`'s
 * `callTool` currently collapses it to a message string, so `faultCode` is
 * usually undefined in production today. That is why classification falls back
 * to the status code and the message, and why the duplicate-entry net is a
 * re-query rather than a fault-code match.
 */
function readQuickbooksFaultCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const fault = (error as { quickbooksFault?: { code?: string | null } }).quickbooksFault
  return fault?.code ?? undefined
}

/** Read a numeric `statusCode` off an error, as `AuxxError` subclasses carry. */
function readStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const status = (error as { statusCode?: unknown }).statusCode
  return typeof status === 'number' ? status : undefined
}

/** Read a string `code` off an error, as the SDK's typed errors carry. */
function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * QuickBooks fault codes worth naming, and what they mean for a retry.
 *
 * - `2300` an unbalanced journal entry. It will never succeed on retry, so it is
 *   `data`, not `transport`. `buildEntry` should have refused it long before.
 * - `610` the object referenced does not exist - an account id we resolved has
 *   since been deleted. A setup problem, so `configuration`.
 * - `3100` / `3200` authorization and authentication failures. `configuration`.
 *
 * Duplicate-document-number is handled separately and by re-query, never by
 * code - see {@link DUPLICATE_DOC_NUMBER_FAULT_CODES}.
 */
const FAULT_CODE_CLASS: Record<string, PostFailureClass> = {
  '2300': 'data',
  '610': 'configuration',
  '3100': 'configuration',
  '3200': 'configuration',
}

/**
 * Fault codes that mean "an object with this document number already exists".
 *
 * Intuit documents `6140` as Duplicate Document Number; the QuickBooks app's own
 * `quickbooks-api.ts` comment says `6240`. Both are listed because the response
 * to either is identical and safe: re-query by `DocNumber`, and adopt the id
 * ONLY if the entry is actually there. A wrong guess costs one read.
 *
 * 🛑 Never `include=allowduplicatedocnum`. That flag exists to let you create
 * the duplicate, which is precisely the bug this whole file is about.
 */
const DUPLICATE_DOC_NUMBER_FAULT_CODES = new Set(['6140', '6240'])

/**
 * Classify a QuickBooks failure into the three classes the core can act on.
 *
 * The core cannot do this itself: what separates a permanent fault from a
 * transient one is QuickBooks' own error vocabulary. So the adapter classifies
 * and the core routes (`ProviderPostError.retryable` derives from the class -
 * set the class, never the flag).
 *
 * The default is `data`, i.e. NOT retried. For a write that may already have
 * landed, "retry an unknown failure" is the dangerous direction and "surface it
 * to an operator" is the safe one.
 */
function classifyQuickbooksFailure(error: unknown): {
  failureClass: PostFailureClass
  faultCode?: string
} {
  const faultCode = readQuickbooksFaultCode(error)
  if (faultCode && FAULT_CODE_CLASS[faultCode]) {
    return { failureClass: FAULT_CODE_CLASS[faultCode], faultCode }
  }

  const status = readStatusCode(error)
  const code = readErrorCode(error)
  const message = errorMessage(error).toLowerCase()

  // Transport: worth trying again, with capped backoff, by the caller.
  //
  // 🛑 The 5xx arm starts at 502, not 500. `invoke-lambda-executor.ts` re-derives
  // a meaningful `statusCode` only for the six codes in `KNOWN_ERROR_STATUS` and
  // otherwise falls back to the Lambda transport's status - which that file's own
  // comment says is ALWAYS 500 on a throw. So `EXECUTION_ERROR`, the fallback for
  // every failure nobody classified, also carries 500. Treating that as a provider
  // 5xx would retry every unknown failure, which is the exact inversion the `data`
  // default at the bottom of this function exists to prevent.
  //
  // Nothing is lost by excluding it: a real provider 5xx is mapped to
  // `UpstreamServiceError` by `quickbooksApi`, arrives as `UPSTREAM_ERROR`, and is
  // caught by the code arm below (and re-derived as 502 besides).
  if (
    status === 429 ||
    code === 'RATE_LIMIT' ||
    code === 'UPSTREAM_ERROR' ||
    (typeof status === 'number' && status >= 502) ||
    // The message fallback is still load-bearing: `callTool`'s `runtime_error`
    // and `validation_error` paths throw BARE errors with no code or status.
    /rate limit|too many requests|timeout|timed out|temporarily unavailable|econnreset|socket hang up/.test(
      message
    )
  ) {
    return { failureClass: 'transport', faultCode }
  }

  // Configuration: a setup problem. Never retried, and surfaced as a setup
  // problem rather than as a posting failure.
  if (
    status === 401 ||
    status === 403 ||
    code === 'CONNECTION_EXPIRED' ||
    code === 'CONNECTION_NOT_FOUND' ||
    code === 'CONNECTION_REQUIRED' ||
    code === 'INSUFFICIENT_PERMISSIONS' ||
    /connection expired|reconnect|insufficient permission|not connected/.test(message)
  ) {
    return { failureClass: 'configuration', faultCode }
  }

  return { failureClass: 'data', faultCode }
}

/** Case- and whitespace-insensitive compare, so ' 1310 ' matches '1310'. */
function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/**
 * Fetch the org's QuickBooks chart of accounts, once.
 *
 * `Account.AcctNum` is NOT filterable, so `WHERE AcctNum = '1310'` is
 * unsupported by the API - the obvious server-side design does not work and
 * matching has to happen client-side. A chart is a few hundred rows, inside the
 * API's 1000-row page cap, so one `returnAll` fetch is both correct and cheap.
 */
async function fetchChart(ctx: QuickbooksToolContext): Promise<QboAccount[]> {
  const result = await ctx.callTool(TOOL_LIST_ACCOUNTS, {})
  const accounts: QboAccount[] = Array.isArray(result?.accounts) ? result.accounts : []
  return accounts.filter((a) => a.active !== false)
}

/**
 * Match one account CODE against a fetched chart, failing closed both ways.
 *
 * Matches on `AcctNum` alone. A name fallback is deliberately NOT offered: our
 * codes come from `G7`'s seeded chart, our names will not be QuickBooks' names,
 * and a near-miss here puts a wrong account id into a journal entry - which is
 * the single failure a resolver exists to prevent. When a company does not use
 * account numbers at all, every `acctNum` is null and this refuses every code,
 * which is the correct and legible outcome: turn account numbers on, or map the
 * chart.
 *
 * Ambiguity is refused, never resolved by taking the first hit.
 */
function matchAccount(chart: QboAccount[], code: string): Result<QboAccount, Error> {
  const needle = norm(code)
  if (!needle) {
    return err(new UnprocessableEntityError('An account code is required to resolve an account'))
  }

  const hits = chart.filter((a) => norm(a.acctNum) === needle)
  if (hits.length === 1) return ok(hits[0]!)

  if (hits.length > 1) {
    const shown = hits.map((a) => `${a.fullyQualifiedName} (id ${a.id})`).join(', ')
    return err(
      new UnprocessableEntityError(
        `Account code '${code}' matches ${hits.length} QuickBooks accounts: ${shown}. ` +
          'Give each one a distinct account number in QuickBooks.',
        { accountCode: code }
      )
    )
  }

  return err(
    new UnprocessableEntityError(
      `No active QuickBooks account has account number '${code}'. ` +
        'Add the number to the matching account in QuickBooks, or change the code in the chart of accounts.',
      { accountCode: code }
    )
  )
}

/**
 * Compose the layer-4 forensic stamp.
 *
 * 🛑 The `auxx:gl:<type>:<period>:<id>` prefix is the format a human greps the
 * QBO register for and must not drift. An entry memo is appended after it, and
 * only the memo half is truncated to stay inside QuickBooks' 4000-character cap.
 */
function buildPrivateNote(input: PostEntryInput): string {
  const stamp = `auxx:gl:${input.postingType}:${input.periodKey}:${input.glPostingId}`
  if (!input.memo) return stamp
  const composed = `${stamp} ${input.memo}`
  return composed.length <= PRIVATE_NOTE_MAX_LENGTH
    ? composed
    : composed.slice(0, PRIVATE_NOTE_MAX_LENGTH)
}

/** The provider's own id for an entry QuickBooks already holds under `docNumber`. */
async function findExistingEntryId(
  ctx: QuickbooksToolContext,
  docNumber: string
): Promise<string | undefined> {
  const found = await ctx.callTool(TOOL_FIND_JOURNAL_ENTRY, { docNumber })
  const entry = found?.journalEntries?.[0]
  return entry?.journalEntryId ? String(entry.journalEntryId) : undefined
}

/**
 * QuickBooks as an accounting provider.
 *
 * Stateless: `orgId` arrives on every call and everything per-org (the
 * installation, the connection, the chart) is resolved inside the call, where it
 * can also be refreshed. That is what lets `postings/provider.ts` cache one
 * instance per provider id rather than one per organization.
 */
export class QuickbooksAccountingProvider implements AccountingProvider {
  readonly id = QUICKBOOKS_PROVIDER_ID

  /**
   * Resolve one auxx account CODE to its QuickBooks account id.
   *
   * 🛑 This is the ONLY place a code becomes a provider identifier (decision
   * P2). Nothing above this line - not a builder, not a `GlPostingLine` row, not
   * a `ResolvedPostingLine` - may hold one, because that is what would make the
   * ledger un-replayable against a different provider three years later.
   *
   * NOT cached across calls. The provider instance is a process-lifetime
   * singleton, so an instance-level cache would keep serving an account id after
   * the account was renumbered, merged or deactivated in QuickBooks, with no
   * invalidation signal to act on - and a stale account id in a journal entry
   * balances perfectly and is therefore invisible. {@link postEntry} instead
   * fetches the chart ONCE per entry and resolves every line against it, which
   * gets the read amplification down without holding anything between calls.
   */
  async resolveAccount(orgId: string, code: string): Promise<Result<string, Error>> {
    const resolved = await resolveQuickbooksContext({ organizationId: orgId })
    if (!resolved.connected) {
      return err(
        new UnprocessableEntityError(
          `QuickBooks is not connected, so account code '${code}' cannot be resolved`,
          { accountCode: code }
        )
      )
    }

    try {
      const chart = await fetchChart(resolved.context)
      return matchAccount(chart, code).map((account) => account.id)
    } catch (error) {
      return err(
        new UnprocessableEntityError(
          `Could not read the QuickBooks chart of accounts to resolve '${code}': ${errorMessage(error)}`,
          { accountCode: code }
        )
      )
    }
  }

  /**
   * Push one balanced entry to the QuickBooks general ledger.
   *
   * Never throws. Every outcome is a `Result` - a success carries a
   * `PostEntryResult`, a failure a `ProviderPostError` carrying the class the
   * core routes on.
   *
   * `already_posted` and `healed` are SUCCESSES and are logged as such. Logging
   * a routine converged re-run as a failure trains everyone to ignore the
   * channel, and that channel is the only warning a real double-post arrives on.
   */
  async postEntry(input: PostEntryInput): Promise<Result<PostEntryResult, Error>> {
    const { organizationId, docNumber } = input

    try {
      // The org's own switch, separate from invoice sync on purpose: a journal
      // entry hits the financial statements directly, with no invoice or payment
      // to reconcile it against, so turning on invoice sync must never turn this
      // on as a side effect.
      //
      // Off resolves to `disabled`, NOT `not_connected`. Both are successes and
      // in both the entry is built, balanced and persisted with nothing pushed
      // (P1) - but the remedies differ. `disabled` means QuickBooks IS connected
      // and somebody can flip a switch; `not_connected` means there is no
      // integration at all. Merging them makes the fix unguessable from the
      // record, which is what the close console has to show a reader.
      const enabled = await getOrganizationSetting({
        organizationId,
        key: 'quickbooks.postJournalEntries',
      })
      if (!enabled) {
        logger.debug('QuickBooks journal-entry posting is switched off - staying internal', {
          organizationId,
          docNumber,
        })
        return ok({ status: 'disabled', externalId: '', providerId: QUICKBOOKS_PROVIDER_ID })
      }

      const resolved = await resolveQuickbooksContext({ organizationId })
      if (!resolved.connected) {
        return ok({ status: 'not_connected', externalId: '', providerId: QUICKBOOKS_PROVIDER_ID })
      }
      const ctx = resolved.context

      // ── Resolve every account code before anything is written ────────────
      // Naming every offending code at once matters: fixing them one failed post
      // at a time is how a close slips a day.
      const chart = await fetchChart(ctx)
      const lines: QboJournalLine[] = []
      const unresolved: string[] = []
      for (const line of [...input.lines].sort((a, b) => a.sortOrder - b.sortOrder)) {
        const match = matchAccount(chart, line.accountCode)
        if (match.isErr()) {
          unresolved.push(match.error.message)
          continue
        }
        lines.push({
          amountMinor: line.amount,
          postingType: line.direction === 'debit' ? 'Debit' : 'Credit',
          accountId: match.value.id,
          accountName: match.value.fullyQualifiedName,
          ...(line.memo && { description: line.memo }),
        })
      }
      if (unresolved.length > 0) {
        return err(
          new ProviderPostError(unresolved.join(' '), {
            failureClass: 'configuration',
            providerId: QUICKBOOKS_PROVIDER_ID,
          })
        )
      }

      // ── Layer 2: query by DocNumber, and HEAL rather than re-post ────────
      // A hit here means a previous run posted and then died before the id was
      // recorded. Posting again would duplicate the entry in a real general
      // ledger, so we return the id and let the core write it back.
      const existingId = await findExistingEntryId(ctx, docNumber)
      if (existingId) {
        logger.warn('QuickBooks already holds this DocNumber - healing, not re-posting', {
          organizationId,
          glPostingId: input.glPostingId,
          docNumber,
          providerEntryId: existingId,
        })
        return ok({
          status: 'healed',
          externalId: existingId,
          providerId: QUICKBOOKS_PROVIDER_ID,
        })
      }

      // ── Layer 3 (requestid) + layer 4 (the forensic note) ────────────────
      // `requestId` is `input.idempotencyKey` VERBATIM. The core derived it from
      // the posting identity and stored it on `GlPosting.requestId`; deriving
      // another one here would break the guarantee it exists to provide.
      const created = await ctx.callTool(TOOL_CREATE_JOURNAL_ENTRY, {
        lines,
        txnDate: input.txnDate,
        docNumber,
        privateNote: buildPrivateNote(input),
        requestId: input.idempotencyKey,
      })

      const providerEntryId = created?.journalEntry?.journalEntryId
      if (!providerEntryId) {
        return err(
          new ProviderPostError('QuickBooks returned no journal entry id', {
            failureClass: 'data',
            providerId: QUICKBOOKS_PROVIDER_ID,
          })
        )
      }

      logger.info('Journal entry posted to QuickBooks', {
        organizationId,
        glPostingId: input.glPostingId,
        docNumber,
        providerEntryId: String(providerEntryId),
        lineCount: lines.length,
      })

      return ok({
        status: 'posted',
        externalId: String(providerEntryId),
        providerId: QUICKBOOKS_PROVIDER_ID,
      })
    } catch (error) {
      return this.recoverOrClassify(input, error)
    }
  }

  /**
   * The net under the create: before reporting a failure, ask QuickBooks whether
   * it took the entry anyway.
   *
   * Two cases converge here and both are success-ish:
   *
   * - a duplicate-document-number fault, which means QuickBooks already holds an
   *   entry under this `DocNumber`;
   * - a POST that landed but whose response never came back (a timeout, a
   *   dropped connection), which is invisible from the error alone.
   *
   * Adopting the id costs one read and is the difference between converging and
   * duplicating a journal entry. Note it returns `already_posted` rather than
   * `healed`: `healed` is reserved for layer 2's pre-flight discovery, so the
   * two are distinguishable in the record.
   *
   * The query is skipped for a `configuration` failure, where it could not
   * succeed either - an expired token cannot read any more than it can write.
   */
  private async recoverOrClassify(
    input: PostEntryInput,
    error: unknown
  ): Promise<Result<PostEntryResult, Error>> {
    const { failureClass, faultCode } = classifyQuickbooksFailure(error)
    const isDuplicate = faultCode !== undefined && DUPLICATE_DOC_NUMBER_FAULT_CODES.has(faultCode)

    if (isDuplicate || failureClass !== 'configuration') {
      try {
        const resolved = await resolveQuickbooksContext({ organizationId: input.organizationId })
        if (resolved.connected) {
          const adopted = await findExistingEntryId(resolved.context, input.docNumber)
          if (adopted) {
            logger.warn('Create failed but QuickBooks holds the entry - adopting its id', {
              organizationId: input.organizationId,
              glPostingId: input.glPostingId,
              docNumber: input.docNumber,
              providerEntryId: adopted,
              faultCode,
            })
            return ok({
              status: 'already_posted',
              externalId: adopted,
              providerId: QUICKBOOKS_PROVIDER_ID,
            })
          }
        }
      } catch (recoveryError) {
        // The recovery read is best-effort. Its own failure must never replace
        // the original one, which is the failure worth reporting.
        logger.debug('Recovery query after a failed create did not complete', {
          organizationId: input.organizationId,
          docNumber: input.docNumber,
          error: errorMessage(recoveryError),
        })
      }
    }

    // A duplicate fault with nothing behind it is not retryable: the same
    // DocNumber will be rejected again, forever.
    const finalClass: PostFailureClass = isDuplicate ? 'data' : failureClass
    const message = errorMessage(error)

    logger.error('QuickBooks journal entry post failed', {
      organizationId: input.organizationId,
      glPostingId: input.glPostingId,
      docNumber: input.docNumber,
      failureClass: finalClass,
      faultCode,
      error: message,
    })

    return err(
      new ProviderPostError(message, {
        failureClass: finalClass,
        providerId: QUICKBOOKS_PROVIDER_ID,
        ...(faultCode && { faultCode }),
      })
    )
  }
}

/**
 * Factory for `registerAccountingProvider`.
 *
 * 🛑 Called from the APP layer, never from `packages/lib`. Registering at module
 * scope here would put an import edge from the posting core to a specific
 * accounting integration, which is the exact dependency decision P1 forbids.
 */
export function createQuickbooksAccountingProvider(): AccountingProvider {
  return new QuickbooksAccountingProvider()
}
