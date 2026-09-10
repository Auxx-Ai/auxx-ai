// packages/lib/src/money/quickbooks/quickbooks-accounting-provider.ts
//
// The QuickBooks `AccountingProvider` adapter: the half of the poster that is
// QuickBooks' and nobody else's.
//
// The provider-agnostic core (`postings/post-entry.ts`) owns resolve, claim,
// persist and record. It hands this adapter a balanced entry whose lines carry
// the org's own account CODE, name and `glAccountId` - task 15's IDENTITY, and
// the key this file resolves by (`resolveMappedAccounts`) so a replay
// (`retry-export.ts`) cannot be tripped up by a renumber that happened since -
// plus, on a receivable or payable line, a FROZEN `counterpartyType` /
// `counterpartyId` (brief 13 §1.1) - and it writes back whatever provider id
// comes out. This file owns four things the core cannot: turning an account
// into a QuickBooks account id, turning a counterparty into a QuickBooks
// `Customer` or `Vendor` id (`resolveCounterparties`, beside
// `resolveMappedAccounts`), QuickBooks' `DocNumber`, and QuickBooks'
// `requestid`.
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

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { err, ok, type Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import { accountLabel } from '../../postings/account-label'
import type {
  AccountingProvider,
  ClearAccountMappingInput,
  SetAccountMappingInput,
} from '../../postings/provider'
import { listChartAccounts } from '../../postings/role-map'
import { validateProviderMapping } from '../../postings/suggest-account-identities'
import {
  type ChartAccountRow,
  type CounterpartyType,
  type PostEntryInput,
  type PostEntryResult,
  type PostFailureClass,
  type ProviderAccount,
  type ProviderBalanceSheet,
  ProviderPostError,
} from '../../postings/types'
import { UnifiedCrudHandler } from '../../resources/crud'
import { getOrganizationSetting } from '../../settings/settings-service'
import {
  clearQuickbooksAccountMapping,
  listQuickbooksProviderAccounts,
  readQuickbooksAccountMap,
  setQuickbooksAccountMapping,
} from './account-map'
import { readQuickbooksIdField } from './identity-field'
import { type QuickbooksToolContext, resolveQuickbooksContext } from './invoke-quickbooks-tool'

const logger = createScopedLogger('quickbooks-accounting-provider')

/** The id this adapter registers under. Must match the connected-provider resolver. */
export const QUICKBOOKS_PROVIDER_ID = 'quickbooks'

// `list_quickbooks_accounts` is NOT declared here: the only caller is
// `account-map.ts:99`, which owns the string and documents the response shape
// beside it. A second copy in this file was dead and could only drift.
const TOOL_FIND_JOURNAL_ENTRY = 'find_quickbooks_journal_entry'
const TOOL_CREATE_JOURNAL_ENTRY = 'create_quickbooks_journal_entry'
/** Brief 19 section 3: the opening-balance suggestion's one report read. */
const TOOL_GET_BALANCE_SHEET = 'get_quickbooks_balance_sheet'

/** QuickBooks caps `PrivateNote` at 4000 characters and rejects a longer one. */
const PRIVATE_NOTE_MAX_LENGTH = 4000

/** The QuickBooks id-map field for a `contact` synced as a `Customer`. */
const QBO_CUSTOMER_ID_FIELD_KEY = 'qboCustomerId'

/**
 * The QuickBooks id-map field for a `company` synced as a `Vendor`.
 *
 * 🛑 Not provisioned by the app until the first vendor bill entry ships
 * (brief 13 DECIDED, unit 1). Until then `readQuickbooksIdField` returns
 * `undefined` for the field itself rather than for any one vendor, so every
 * payable line refuses with the "not synced" sentence below - intended
 * behaviour, not a bug in this file.
 */
const QBO_VENDOR_ID_FIELD_KEY = 'qboVendorId'

/** What `resolveCounterparties` resolves one line's counterparty TO. */
interface QuickbooksEntity {
  type: 'Customer' | 'Vendor'
  id: string
  name?: string
}

/** `'customer:contact_1'` / `'vendor:company_1'` - a map key, never persisted. */
function counterpartyKey(type: CounterpartyType, id: string): string {
  return `${type}:${id}`
}

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
  /**
   * Required on a line posting to Accounts Receivable or Accounts Payable -
   * QuickBooks cannot age a receivable it cannot attribute (brief 13 §1).
   * `resolveCounterparties` is the only place this gets set. Typed with the
   * app's whole vocabulary (`build-journal-lines.ts`'s `JournalLineInput`),
   * not a narrower one - auxx never emits `'Employee'` today, but the two
   * schemas must match exactly, and a narrower local type would drift the
   * moment it did not.
   */
  entity?: { type: 'Customer' | 'Vendor' | 'Employee'; id: string; name?: string }
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
 *
 * 🛑 **No entry here for "a receivable or payable line named no `Entity`".**
 * `resolveCounterparties` refuses that case BEFORE the push (brief 13 §1.5),
 * so this file has never actually sent QuickBooks that shape and does not
 * know what fault code comes back. Do not guess one in: observe it against a
 * sandbox first (13 §1.5's own warning), then add it here as `configuration`
 * - it would be fixable and a retry would then succeed, which is exactly what
 * `configuration` means for this table.
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
 * Fetch the org's QuickBooks chart of accounts, once, in the provider-neutral
 * shape.
 *
 * `Account.AcctNum` is NOT filterable, so `WHERE AcctNum = '1310'` is
 * unsupported by the API - which is moot now that resolution runs off the `G19`
 * account map rather than off account numbers, but is still why the chart is
 * fetched whole. A chart is a few hundred rows, inside the API's 1000-row page
 * cap, so one `returnAll` fetch is both correct and cheap.
 *
 * Only ACTIVE accounts, unlike `listQuickbooksProviderAccounts`' read for the
 * mapping screen. A posting cannot use an inactive account, and a mapping that
 * names one has to be reported as broken rather than silently resolved - which
 * `validateProviderMapping` does off the absence.
 */
async function fetchChart(ctx: QuickbooksToolContext): Promise<ProviderAccount[]> {
  const accounts = await listQuickbooksProviderAccounts(ctx)
  return accounts.filter((account) => account.active)
}

/**
 * Resolve every account an entry names, by `glAccountId`, to a QuickBooks
 * account id, through the `G19` account map.
 *
 * 🛑 **There is no matching here, and that is the point.** This used to compare
 * our code against `Account.AcctNum` and take the single hit. That looked like a
 * sensible resolver and had two fatal properties: QuickBooks ships with account
 * numbers switched OFF, so every `AcctNum` is null and every code refuses; and
 * for the companies that do number their accounts, renumbering one in QuickBooks
 * silently moved where a role posted. `G19` replaced it with a confirmation a
 * person makes once - "this account IS that account" - which is what the map
 * below reads.
 *
 * 🛑 **Keyed on `glAccountId` (task 15 §2.3), not on the account code.** A
 * replayed line (`retry-export.ts`) carries the id it was posted with; looking
 * it up by the FROZEN code used to miss the moment the account was renumbered
 * in our own chart, refusing a retry with "no account has the code X" for an
 * account that plainly exists. The id is exactly what the line already carries
 * for this reason - see `ResolvedPostingLine.glAccountId`.
 *
 * Every mapping is revalidated on every entry against the chart just fetched:
 * the target must still exist, still be active, and still sit in the same
 * statement section. `G19` requires exactly this at every close, and it is the
 * whole reason the map stores an id rather than a resolved account.
 *
 * ⚠️ Every failure is collected, never thrown on the first one. Fixing a chart
 * one refused post at a time is how a close slips a day.
 */
async function resolveMappedAccounts(
  ctx: QuickbooksToolContext,
  glAccountIds: readonly string[]
): Promise<Result<Map<string, ProviderAccount>, Error>> {
  const [chart, ourChart] = await Promise.all([
    fetchChart(ctx),
    listChartAccounts(database, ctx.organizationId),
  ])
  if (ourChart.isErr()) return err(ourChart.error)

  const map = await readQuickbooksAccountMap({
    organizationId: ctx.organizationId,
    installationId: ctx.installationId,
    connectionId: ctx.connectionId,
  })

  const byId = new Map(ourChart.value.map((row) => [row.id, row]))
  const byProviderId = new Map(chart.map((account) => [account.id, account]))

  const resolved = new Map<string, ProviderAccount>()
  const problems: string[] = []

  for (const glAccountId of new Set(glAccountIds)) {
    const account = byId.get(glAccountId)
    if (!account) {
      problems.push(`No account in this organization's chart has the id '${glAccountId}'.`)
      continue
    }

    const providerAccountId = map.get(account.id)
    if (!providerAccountId) {
      problems.push(
        `${accountLabel(account)} is not mapped to a QuickBooks account. Map it under Accounting > Settings > Accounts.`
      )
      continue
    }

    const live = byProviderId.get(providerAccountId)
    const invalid = validateProviderMapping(account, live, providerAccountId)
    if (invalid) {
      problems.push(invalid)
      continue
    }

    // `validateProviderMapping` returns null only when `live` is present.
    resolved.set(glAccountId, live as ProviderAccount)
  }

  if (problems.length > 0) {
    return err(new UnprocessableEntityError(problems.join(' ')))
  }
  return ok(resolved)
}

/**
 * Resolve every counterparty a receivable or payable line names to a
 * QuickBooks `entity` reference, and refuse a receivable or payable line that
 * carries none at all (brief 13 §1.3, §1.4).
 *
 * 🛑 **No provider id above the seam (P2).** A posting line carries OUR
 * `counterpartyType` / `counterpartyId` - a `contact` or `company` instance
 * id - and this is the one place that becomes a QuickBooks `Customer` or
 * `Vendor` id, the same hop `resolveMappedAccounts` makes for an account.
 *
 * Takes the whole {@link PostEntryInput} rather than a bare line array so a
 * refusal can name the document (`input.docNumber`), matching
 * `resolveMappedAccounts`'s account-naming register.
 *
 * ⚠️ Every failure is collected, never thrown on the first - fixing an export
 * one refused line at a time is how a close slips a day (13 §1.3), and it is
 * the same rule `resolveMappedAccounts` follows at `:305-307`.
 *
 * Which line needs a counterparty is read from the CHART, not from a
 * hardcoded role list: `subtype: 'accounts_receivable' | 'accounts_payable'`
 * on `ourChart` (task 13 §3, pulled forward), so a manual journal entry coded
 * to a receivable by hand is caught exactly like a builder's own A/R line.
 */
async function resolveCounterparties(
  ctx: QuickbooksToolContext,
  input: PostEntryInput,
  ourChart: readonly ChartAccountRow[]
): Promise<Result<Map<string, QuickbooksEntity>, Error>> {
  const byId = new Map(ourChart.map((row) => [row.id, row]))
  const handler = new UnifiedCrudHandler(ctx.organizationId, ctx.userId)

  // Every distinct counterparty actually named on the entry, resolved ONCE
  // each rather than once per line.
  const distinct = new Map<string, { type: CounterpartyType; id: string }>()
  for (const line of input.lines) {
    if (line.counterpartyType && line.counterpartyId) {
      distinct.set(counterpartyKey(line.counterpartyType, line.counterpartyId), {
        type: line.counterpartyType,
        id: line.counterpartyId,
      })
    }
  }

  const resolved = new Map<string, QuickbooksEntity>()
  const unsynced = new Set<string>()

  for (const { type, id } of distinct.values()) {
    const isCustomer = type === 'customer'
    const externalId = await readQuickbooksIdField({
      organizationId: ctx.organizationId,
      installationId: ctx.installationId,
      connectionId: ctx.connectionId,
      appFieldKey: isCustomer ? QBO_CUSTOMER_ID_FIELD_KEY : QBO_VENDOR_ID_FIELD_KEY,
      recordId: toRecordId(isCustomer ? 'contact' : 'company', id),
      handler,
    })
    const key = counterpartyKey(type, id)
    if (externalId) {
      resolved.set(key, { type: isCustomer ? 'Customer' : 'Vendor', id: externalId })
    } else {
      unsynced.add(key)
    }
  }

  // Every receivable or payable line, checked against what resolved above.
  const problems = new Set<string>()
  for (const line of input.lines) {
    const account = byId.get(line.glAccountId)
    const subtype = account?.subtype
    if (subtype !== 'accounts_receivable' && subtype !== 'accounts_payable') continue

    const kind = subtype === 'accounts_receivable' ? 'receivable' : 'payable'
    const qbNoun = subtype === 'accounts_receivable' ? 'customer' : 'vendor'
    const ourNoun = subtype === 'accounts_receivable' ? 'contact' : 'company'
    const label = account ? accountLabel(account) : (line.accountCode ?? line.glAccountId)

    if (!line.counterpartyType || !line.counterpartyId) {
      problems.add(
        `${input.docNumber} posts to ${label}, and QuickBooks cannot accept a ${kind} line ` +
          `without a ${qbNoun}. This line carries no ${ourNoun}.`
      )
      continue
    }
    if (unsynced.has(counterpartyKey(line.counterpartyType, line.counterpartyId))) {
      problems.add(
        `${input.docNumber} posts to ${label}, and QuickBooks cannot accept a ${kind} line ` +
          `without a ${qbNoun}. The ${ourNoun} on this line has not been synced to QuickBooks yet.`
      )
    }
  }

  if (problems.size > 0) {
    return err(new UnprocessableEntityError([...problems].join(' ')))
  }
  return ok(resolved)
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
   * The code is our own caller's vocabulary (a human keying a manual entry
   * looks at the chart, not at ids), so it is translated to the account's
   * `glAccountId` here, then handed to {@link resolveMappedAccounts} - the same
   * by-id door `postEntry` below uses, so the two paths cannot disagree about
   * what one account resolves to.
   *
   * NOT cached across calls. The provider instance is a process-lifetime
   * singleton, so an instance-level cache would keep serving an account id after
   * the mapping was changed or its target deactivated in QuickBooks, with no
   * invalidation signal to act on - and a stale account id in a journal entry
   * balances perfectly and is therefore invisible. {@link postEntry} instead
   * resolves every line of an entry in ONE call, which gets the read
   * amplification down without holding anything between calls.
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

    const notResolved = () =>
      err(
        new UnprocessableEntityError(
          `Account code '${code}' could not be resolved to a QuickBooks account.`,
          { accountCode: code }
        )
      )

    try {
      const ourChart = await listChartAccounts(database, orgId)
      if (ourChart.isErr()) return err(ourChart.error)
      const ourAccount = ourChart.value.find((row) => norm(row.code) === norm(code))
      if (!ourAccount) return notResolved()

      const accounts = await resolveMappedAccounts(resolved.context, [ourAccount.id])
      if (accounts.isErr()) return err(accounts.error)
      const account = accounts.value.get(ourAccount.id)
      return account ? ok(account.id) : notResolved()
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
   * The connected company's chart, for the `G19` mapping screen.
   *
   * Inactive accounts INCLUDED - see the interface. This is the only chart read
   * in this file that keeps them, and the difference is deliberate: a screen has
   * to be able to say "the account you mapped has been deactivated", which it
   * cannot do about a row it never received.
   */
  async listProviderAccounts(orgId: string): Promise<Result<ProviderAccount[], Error>> {
    const resolved = await resolveQuickbooksContext({ organizationId: orgId })
    if (!resolved.connected) return ok([])

    try {
      return ok(await listQuickbooksProviderAccounts(resolved.context))
    } catch (error) {
      return err(
        new UnprocessableEntityError(
          `Could not read the QuickBooks chart of accounts: ${errorMessage(error)}`
        )
      )
    }
  }

  /**
   * The connected company's balance sheet as of `asOf` - any date, not just a
   * cutover. The opening-balance fill (brief 19) is one caller; the agreement
   * view (brief 20 §8) is another, asking as of a period end.
   *
   * The tool has already normalized sign to debit-positive, parsed money into
   * integer minor units and asserted `Header.EndPeriod === asOf` (brief 19
   * section 3.3) - this adapter does not touch the rows, only the call.
   */
  async readProviderBalances(
    orgId: string,
    asOf: string
  ): Promise<Result<ProviderBalanceSheet | null, Error>> {
    const resolved = await resolveQuickbooksContext({ organizationId: orgId })
    if (!resolved.connected) return ok(null)

    try {
      return ok(
        (await resolved.context.callTool(TOOL_GET_BALANCE_SHEET, {
          asOf,
          accountingMethod: 'Accrual',
        })) as ProviderBalanceSheet
      )
    } catch (error) {
      return err(
        new UnprocessableEntityError(
          `Could not read the QuickBooks balance sheet: ${errorMessage(error)}`
        )
      )
    }
  }

  /** The org's confirmed `gl_account -> QuickBooks account` map. */
  async listAccountMappings(orgId: string): Promise<Result<Map<string, string>, Error>> {
    const resolved = await resolveQuickbooksContext({ organizationId: orgId })
    if (!resolved.connected) return ok(new Map())

    try {
      return ok(
        await readQuickbooksAccountMap({
          organizationId: orgId,
          installationId: resolved.context.installationId,
          connectionId: resolved.context.connectionId,
        })
      )
    } catch (error) {
      return err(
        new UnprocessableEntityError(
          `Could not read the QuickBooks account map: ${errorMessage(error)}`
        )
      )
    }
  }

  /**
   * Record one human confirmation.
   *
   * The pairing has already been validated by `postings/account-identities.ts`
   * against the live chart. This writes it and does not re-decide it.
   */
  async setAccountMapping(input: SetAccountMappingInput): Promise<Result<void, Error>> {
    const resolved = await resolveQuickbooksContext({ organizationId: input.orgId })
    if (!resolved.connected) {
      return err(
        new UnprocessableEntityError(
          'QuickBooks is not connected, so an account mapping cannot be saved.',
          { organizationId: input.orgId }
        )
      )
    }

    try {
      await setQuickbooksAccountMapping({
        organizationId: input.orgId,
        installationId: resolved.context.installationId,
        connectionId: resolved.context.connectionId,
        glAccountId: input.glAccountId,
        providerAccountId: input.providerAccountId,
        userId: input.actorUserId,
      })
      return ok(undefined)
    } catch (error) {
      return err(
        new UnprocessableEntityError(`Could not save the account mapping: ${errorMessage(error)}`, {
          organizationId: input.orgId,
          glAccountId: input.glAccountId,
        })
      )
    }
  }

  /** Withdraw one confirmation. The account goes back to unmapped. */
  async clearAccountMapping(input: ClearAccountMappingInput): Promise<Result<void, Error>> {
    const resolved = await resolveQuickbooksContext({ organizationId: input.orgId })
    if (!resolved.connected) {
      return err(
        new UnprocessableEntityError(
          'QuickBooks is not connected, so there is no account mapping to clear.',
          { organizationId: input.orgId }
        )
      )
    }

    try {
      await clearQuickbooksAccountMapping({
        organizationId: input.orgId,
        installationId: resolved.context.installationId,
        connectionId: resolved.context.connectionId,
        glAccountId: input.glAccountId,
        userId: input.actorUserId,
      })
      return ok(undefined)
    } catch (error) {
      return err(
        new UnprocessableEntityError(
          `Could not clear the account mapping: ${errorMessage(error)}`,
          {
            organizationId: input.orgId,
            glAccountId: input.glAccountId,
          }
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

      // ── Resolve every account before anything is written ─────────────────
      // By `glAccountId` (task 15 §2.3), not by the frozen code: one call for
      // the whole entry, collecting every problem rather than stopping at the
      // first, and immune to a renumber that happened after this line posted -
      // exactly what a `retry-export.ts` replay needs.
      const accounts = await resolveMappedAccounts(
        ctx,
        input.lines.map((line) => line.glAccountId)
      )
      if (accounts.isErr()) {
        return err(
          new ProviderPostError(accounts.error.message, {
            failureClass: 'configuration',
            providerId: QUICKBOOKS_PROVIDER_ID,
          })
        )
      }

      // ── Resolve every counterparty a receivable or payable line names ────
      // Brief 13 §1.3: the same "resolve the whole entry, collect every
      // problem" shape as the accounts above, over OUR chart rather than
      // QuickBooks' - `resolveCounterparties` reads `subtype` off it to know
      // which lines even need one.
      const ourChart = await listChartAccounts(database, organizationId)
      if (ourChart.isErr()) {
        return err(
          new ProviderPostError(ourChart.error.message, {
            failureClass: 'configuration',
            providerId: QUICKBOOKS_PROVIDER_ID,
          })
        )
      }
      const counterparties = await resolveCounterparties(ctx, input, ourChart.value)
      if (counterparties.isErr()) {
        return err(
          new ProviderPostError(counterparties.error.message, {
            failureClass: 'configuration',
            providerId: QUICKBOOKS_PROVIDER_ID,
          })
        )
      }

      const lines: QboJournalLine[] = []
      for (const line of [...input.lines].sort((a, b) => a.sortOrder - b.sortOrder)) {
        // `resolveMappedAccounts` refuses unless every id resolved, so a miss
        // here is unreachable rather than merely unlikely.
        const account = accounts.value.get(line.glAccountId)
        if (!account) continue
        const entity =
          line.counterpartyType && line.counterpartyId
            ? counterparties.value.get(counterpartyKey(line.counterpartyType, line.counterpartyId))
            : undefined
        lines.push({
          amountMinor: line.amount,
          postingType: line.direction === 'debit' ? 'Debit' : 'Credit',
          accountId: account.id,
          accountName: account.fullyQualifiedName,
          ...(line.memo && { description: line.memo }),
          ...(entity && { entity }),
        })
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
