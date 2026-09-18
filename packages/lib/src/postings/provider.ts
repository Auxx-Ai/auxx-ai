// packages/lib/src/postings/provider.ts
//
// The `AccountingProvider` interface (build plan 7.4) and the manager that
// resolves the one an organization has connected.
//
// Decision P1: the accounting system is an EXPORTER, not the system of record.
// Everything behind this interface is optional. An organization with nothing
// connected gets `NONE_ACCOUNTING_PROVIDER`, its postings are built and
// persisted exactly the same way, and the only difference is that nothing is
// pushed. That is a supported configuration, not a degraded one - see
// `NoneAccountingProvider` below.
//
// Shaped after the house provider/manager pattern (ai/providers/provider-registry.ts,
// files/storage/storage-manager.ts): an interface with an `id`, a registry of
// lazy factories, and a cache so a provider is constructed once.

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError, UnprocessableEntityError } from '../errors'
import type { GlAccountSubtypeValue } from './account-subtype'
import type { GlAccountTypeValue } from './default-chart'
import type { ProviderLedgerSlicer } from './provider-sync/client'
import type { ProviderAccount, ProviderBalanceSheet, WithdrawResult } from './types'

const logger = createScopedLogger('postings-provider')

/**
 * Who the adapter is acting for, on one call.
 *
 * `connectionId` pins the destination: a batch carries the connection it was
 * built against, so a cutover mid-export sends to the company it started with
 * or refuses, rather than silently redirecting.
 */
export interface ProviderObjectContext {
  organizationId: string
  connectionId: string
  actorUserId?: string
}

/**
 * One object to create at the provider.
 *
 * 🛑 `payload` is OPAQUE above the seam and its shape belongs to `objectType`,
 * not to the interface: a second accounting provider (Xero) implements the same
 * three methods over the same three words. No posting or batch vocabulary
 * appears here on purpose (MIGRATION step 3).
 */
export interface SendObjectInput {
  objectType: string
  payload: Record<string, unknown>
  /** Deterministic, derived from the batch identity. The provider must be idempotent on it. */
  idempotencyKey: string
}

export interface SendObjectResult {
  /** `already_exists` means the provider held it and nothing was written. */
  status: 'sent' | 'already_exists' | 'not_connected' | 'disabled'
  /** The provider's own id. `''` when nothing was sent. */
  externalId: string
  /** The provider's concurrency token, which a later withdrawal needs. */
  remoteVersion: string | null
  providerId: string
  /** Which instance of the provider answered - a QuickBooks realm, a Xero tenant. */
  tenantId?: string
}

/** What to look for. Both halves are supplied because no provider offers both. */
export interface ReadObjectRef {
  objectType: string
  externalId: string | null
  docNumber: string | null
}

/**
 * What the provider holds, as far as it can say.
 *
 * `unsupported` is an honest answer and not a failure: a provider with no
 * per-object read cannot prove a send landed, and a caller that read silence as
 * proof would be verifying nothing. See {@link AccountingProvider.readObject}.
 */
export interface ReadObjectResult {
  status: 'found' | 'gone' | 'unsupported'
  externalId: string | null
  remoteVersion: string | null
  docNumber: string | null
  /** Integer minor units, when the read reports a total. */
  totalMinor: number | null
  /** The provider's rendering of what it holds, hashed the way we hash ours. */
  payloadHash: string | null
}

/** One object to remove, by the id and version recorded when it was created. */
export interface WithdrawObjectInput {
  objectType: string
  externalId: string
  remoteVersion: string | null
}

/** The id of the null provider. Reserved - no adapter may register under it. */
export const NONE_PROVIDER_ID = 'none'

/**
 * One accounting system auxx.ai can export objects to.
 *
 * Three object methods - {@link sendObject}, {@link readObject},
 * {@link withdrawObject} - plus the chart and account-map seam `G19` needs and
 * the two inbound reads brief 20 added. The object three are generic over an
 * opaque payload so a second provider implements them unchanged.
 */
export interface AccountingProvider {
  readonly id: string

  /** Optional one-time setup. Called once, by the manager, before first use. */
  init?(): Promise<void>

  /**
   * Resolve an account CODE to this provider's own id.
   *
   * This is the ONLY place a code becomes a provider identifier. Nothing above
   * this line - not a posting line, not a `gl_posting_line` row, not a builder -
   * may hold a provider account id, because that is what would make the ledger
   * un-replayable against a different provider (decision P2).
   */
  resolveAccount(orgId: string, code: string): Promise<Result<string, Error>>

  /**
   * Create one object from a frozen payload.
   *
   * MUST be idempotent on `input.idempotencyKey`: a retry after a timeout has to
   * converge on the object already there rather than create a second one. A
   * double-posted journal entry has no invoice or payment to reconcile against
   * and is not noticed until a close does not tie out.
   */
  sendObject(
    ctx: ProviderObjectContext,
    input: SendObjectInput
  ): Promise<Result<SendObjectResult, Error>>

  /**
   * Read one object back, so a send can be proved rather than assumed.
   *
   * 🛑 Answer `unsupported` rather than inventing a result when the provider has
   * no per-object read. The caller degrades to comparing the document number and
   * the total, and it can only choose to if it is told.
   */
  readObject(
    ctx: ProviderObjectContext,
    ref: ReadObjectRef
  ): Promise<Result<ReadObjectResult, Error>>

  /**
   * The connected system's own chart, for the `G19` mapping screen.
   *
   * 🛑 This is what keeps the mapping UI provider-neutral. A screen that fetched
   * QuickBooks' chart directly could only ever map QuickBooks, and `P2` exists
   * precisely so that swapping the accounting system is a settings change rather
   * than a rewrite. Everything above this line speaks {@link ProviderAccount}.
   *
   * Inactive accounts are INCLUDED. `G19` requires every close to revalidate
   * that a mapping's target still exists and is still active, and a screen
   * cannot say "the account you mapped has been deactivated" about a row it
   * never received.
   */
  listProviderAccounts(orgId: string): Promise<Result<ProviderAccount[], Error>>

  /**
   * The connected system's balance sheet as of ANY date.
   *
   * 🛑 Not opening-specific, which is why the name no longer says so. The
   * opening-balance fill (brief 19) is one caller, asking as of the cutover
   * date; the agreement view (brief 20 §8) is another, asking as of a period
   * end or an arbitrary date a person picked. Two provider methods differing
   * only in what the caller intends to do with the answer is the duplication
   * that gets one of them fixed and not the other.
   *
   * Null means nothing is connected, which is a complete answer to a read -
   * the same argument {@link listProviderAccounts} makes.
   */
  readProviderBalances(
    orgId: string,
    asOf: string
  ): Promise<Result<ProviderBalanceSheet | null, Error>>

  /**
   * How this system's general ledger is WALKED - the INBOUND half of the seam
   * (brief 20 §5.1, reshaped by brief 55 §4.9).
   *
   * Where {@link readProviderBalances} answers "what do they say the position
   * is", this answers "what did they POST, line by line, and who authored it".
   * Everything in the answer that auxx did not author is, by definition,
   * something the provider holds and our books do not, and it is what
   * `provider_sync` postings are written from.
   *
   * 🛑 **One returned line is one journal LINE, not one entry.** The lines are
   * grouped into entries by `(txnType, txnId)` before anything is written - a
   * writer that took one row as one posting would produce single-sided
   * postings. The grouping, the exclusion and the comparison all live in
   * `postings/provider-sync/`; an adapter's whole job is to return the batch it
   * was asked for, flattened.
   *
   * 🛑 A SLICER rather than a `readProviderLedger(orgId, { from, to })`, because
   * a date range is QuickBooks-shaped and cannot serve Xero: Xero's Journals
   * feed is walked by an offset on `JournalNumber`, which is CREATION order, not
   * `JournalDate` order, so "give me 2026-07" is not answerable by any bounded
   * offset walk. What differs per provider is how the next batch is obtained and
   * what the cursor is - nothing after the lines arrive.
   */
  ledgerSlicer(): ProviderLedgerSlicer

  /**
   * Which provider account each of the org's own accounts is mapped to, as
   * `glAccountId -> providerAccountId`.
   *
   * A missing entry means unmapped, which is the state that blocks a close with
   * a message naming the account. Never guess: `G19` has no default-account
   * fallback, because a guess that lands on a real account produces an entry
   * that balances and is wrong, and nothing downstream can detect it.
   */
  listAccountMappings(orgId: string): Promise<Result<Map<string, string>, Error>>

  /**
   * Record that one of the org's accounts IS one provider account - the human
   * confirmation `G19` step 4 requires.
   *
   * The caller has already checked that the pairing is legal (the provider
   * account exists, is active, and its classification matches ours). An adapter
   * may re-check but must not silently repair.
   */
  setAccountMapping(input: SetAccountMappingInput): Promise<Result<void, Error>>

  /** Withdraw a confirmation. The account goes back to unmapped. */
  clearAccountMapping(input: ClearAccountMappingInput): Promise<Result<void, Error>>

  /**
   * Remove one object we created, by the id we recorded when we created it.
   *
   * MUST be safe to call on an object that is already gone: a repeat converges on
   * "not there" rather than raising, so an uncertain delete can be resolved by
   * retrying it.
   */
  withdrawObject(
    ctx: ProviderObjectContext,
    input: WithdrawObjectInput
  ): Promise<Result<WithdrawResult, Error>>

  /**
   * Create the counterpart of one of OUR accounts in the provider's own chart -
   * the only method on this interface that runs the seam backwards.
   *
   * ## Why this exists
   *
   * Every other method assumes both charts already contain the account and only
   * the correspondence is missing. That assumption does not hold for the
   * accounts auxx itself creates: a clearing account per card rail, the
   * role-bearing core `chart-import.ts` adds because the provider had no
   * counterpart for it. Those exist on exactly one side, so
   * {@link listProviderAccounts} has nothing to offer the matcher, no suggestion
   * is ever produced, and the only way to link them was for a person to retype
   * each one into QuickBooks by hand.
   *
   * ## 🛑 OPTIONAL, and its absence is the capability flag
   *
   * Not every accounting system lets an API add to the chart, and some that do
   * should not be asked to. An adapter that cannot simply does not implement
   * this, and `supportsCreatingProviderAccounts` is how a screen asks - so the
   * button is absent rather than present-and-failing. Do NOT add a stub that
   * returns an error; that is the same outcome one round trip later and after
   * the person has already been told the feature is there.
   *
   * ## What an implementation must guarantee
   *
   * REUSE BEFORE CREATE. A duplicate account in somebody's real books is worse
   * than a refusal: two accounts with one name split a balance in half with no
   * error anywhere, and nothing notices until a reconciliation does not tie out.
   * An adapter looks for an existing counterpart first and reports
   * `outcome: 'existing'` rather than writing. Ambiguity - several plausible
   * matches - is a REFUSAL, never a create: the chart already holds a question
   * only a person can settle, and a third account settles nothing.
   *
   * The input is provider-NEUTRAL, which is the whole of `P2` applied to this
   * direction. It says what the account IS - name, our code, its statement
   * classification, our subtype - and never what the provider should call any of
   * that. Translating those into one system's own type vocabulary is the
   * adapter's job and nobody else's.
   *
   * 🛑 This does NOT write the mapping. Creating the counterpart and recording
   * the correspondence are separate acts, and `createAndLinkProviderAccount`
   * does the second through {@link setAccountMapping} after re-checking the
   * result is mappable - so an adapter that returned a surprising account
   * cannot quietly become a confirmed pairing.
   */
  createProviderAccount?(
    input: CreateProviderAccountInput
  ): Promise<Result<CreateProviderAccountResult, Error>>
}

/**
 * One account to create in the provider's chart, described in OUR vocabulary.
 *
 * Deliberately the same four facts a `gl_account` carries and not one more: a
 * provider's own type strings, its nesting, its detail types are the adapter's
 * business. See {@link AccountingProvider.createProviderAccount}.
 */
export interface CreateProviderAccountInput {
  orgId: string
  /** The `gl_account` this will be the counterpart of. Carried for logs and errors. */
  glAccountId: string
  name: string
  /** Our account code, or null - an uncoded account is ordinary (task 15 §5). */
  code: string | null
  /** One of the five statement sections. */
  classification: GlAccountTypeValue
  /** Our second fact about the account, when it has one. */
  subtype: GlAccountSubtypeValue | null
  actorUserId?: string
}

/** What came back from one create. */
export interface CreateProviderAccountResult {
  /** The counterpart, in the same shape {@link AccountingProvider.listProviderAccounts} speaks. */
  account: ProviderAccount
  /**
   * `existing` means the provider already had this account and NOTHING was
   * written. Reported rather than hidden because it changes what the screen
   * should say - "linked to the account already in QuickBooks" is a different
   * sentence from "created it", and a person who believes they just created an
   * account that was already there will go looking for a duplicate.
   */
  outcome: 'created' | 'existing'
  /**
   * True when our `code` was sent and the provider kept no number for it.
   *
   * 🛑 Reported, never inferred, and never silently tolerated by a caller.
   * QuickBooks stores account numbers only when the company has them switched
   * on; with them off it accepts the create and drops the number with no fault
   * at all. A caller that assumed the code landed would be matching forever
   * after on a field that is permanently null.
   */
  numberDropped: boolean
}

/**
 * Can this provider be asked to add to its own chart?
 *
 * The presence of the optional method IS the answer - there is no capability
 * table to keep in step with what the adapters actually implement.
 */
export function supportsCreatingProviderAccounts(provider: AccountingProvider): boolean {
  return typeof provider.createProviderAccount === 'function'
}

/** One confirmed pairing, as {@link AccountingProvider.setAccountMapping} takes it. */
export interface SetAccountMappingInput {
  orgId: string
  /** The `gl_account` `EntityInstance` id. */
  glAccountId: string
  /** The provider's own account id. */
  providerAccountId: string
  /** Who confirmed it, for the audit trail the mapping's storage keeps. */
  actorUserId?: string
}

/** One withdrawal, as {@link AccountingProvider.clearAccountMapping} takes it. */
export interface ClearAccountMappingInput {
  orgId: string
  glAccountId: string
  actorUserId?: string
}

/**
 * The slicer for a provider with no ledger to walk.
 *
 * 🛑 `fetchBatch` answers `ok(null)`, and `ok({ ledger: { lines: [] } })` would
 * be the dangerous shape: an empty batch reads as "the accountant posted nothing
 * that month", which is a real and ordinary state, so a sync could not tell it
 * apart from "there is nothing to sync from". Null says which - the same
 * convention {@link AccountingProvider.readProviderBalances} established.
 *
 * Exported so a test stub can state "no inbound half" once rather than
 * hand-rolling a slicer that gets the null convention wrong.
 */
export const NULL_LEDGER_SLICER: ProviderLedgerSlicer = {
  kind: 'ranged',
  firstCursor: (range) => ({ kind: 'token', value: `${range.from}..${range.to}` }),
  fetchBatch: async () => ok(null),
}

/**
 * The provider for an organization with no accounting system connected.
 *
 * A first-class case, not an error path. The ledger is ours (P1), so with
 * nothing connected the postings are simply complete and internal: they are
 * built, balanced, persisted, and reported as `not_connected`. Nothing retries,
 * nothing is pending, nothing needs healing later.
 *
 * `resolveAccount` returns the code unchanged, because when no external system
 * names our accounts, the code IS the identity.
 */
class NoneAccountingProvider implements AccountingProvider {
  readonly id = NONE_PROVIDER_ID

  async resolveAccount(_orgId: string, code: string): Promise<Result<string, Error>> {
    return ok(code)
  }

  async sendObject(
    ctx: ProviderObjectContext,
    input: SendObjectInput
  ): Promise<Result<SendObjectResult, Error>> {
    logger.debug('No accounting provider connected - the batch stays internal', {
      organizationId: ctx.organizationId,
      objectType: input.objectType,
    })
    return ok({
      status: 'not_connected',
      externalId: '',
      remoteVersion: null,
      providerId: NONE_PROVIDER_ID,
    })
  }

  /** Nothing to read back, and saying so is what stops a caller treating silence as proof. */
  async readObject(
    _ctx: ProviderObjectContext,
    ref: ReadObjectRef
  ): Promise<Result<ReadObjectResult, Error>> {
    return ok({
      status: 'unsupported',
      externalId: ref.externalId,
      remoteVersion: null,
      docNumber: ref.docNumber,
      totalMinor: null,
      payloadHash: null,
    })
  }

  /**
   * No external chart to read, and that is an ANSWER rather than a failure.
   *
   * An empty list is what the mapping screen needs to render "nothing is
   * connected, so there is nothing to map" - which under `P1` is a supported
   * configuration, not a setup step somebody has skipped.
   */
  async listProviderAccounts(): Promise<Result<ProviderAccount[], Error>> {
    return ok([])
  }

  /**
   * No external balance sheet to read, and that is an ANSWER rather than a
   * failure - the same argument as {@link listProviderAccounts}: "nothing
   * connected" is a complete answer to a read, not a setup step somebody has
   * skipped.
   */
  async readProviderBalances(): Promise<Result<ProviderBalanceSheet | null, Error>> {
    return ok(null)
  }

  /** Nothing to walk. See {@link NULL_LEDGER_SLICER}. */
  ledgerSlicer(): ProviderLedgerSlicer {
    return NULL_LEDGER_SLICER
  }

  async listAccountMappings(): Promise<Result<Map<string, string>, Error>> {
    return ok(new Map())
  }

  /**
   * 🛑 A write REFUSES rather than succeeding silently.
   *
   * The two reads above answer emptily because "nothing connected" is a true and
   * complete answer to them. A write is different: somebody is trying to record
   * a pairing with a system that is not there, and an `ok()` would tell them it
   * was saved. Nothing would have been.
   */
  async setAccountMapping(input: SetAccountMappingInput): Promise<Result<void, Error>> {
    return err(
      new UnprocessableEntityError(
        'No accounting system is connected, so there is no account to map to.',
        { organizationId: input.orgId, glAccountId: input.glAccountId }
      )
    )
  }

  async clearAccountMapping(input: ClearAccountMappingInput): Promise<Result<void, Error>> {
    return err(
      new UnprocessableEntityError(
        'No accounting system is connected, so there is no mapping to clear.',
        { organizationId: input.orgId, glAccountId: input.glAccountId }
      )
    )
  }

  /**
   * 🛑 A REFUSAL, not an `already_gone`. Convergence means "the provider no
   * longer holds it"; with nothing connected we do not know that, and answering
   * as though we did would let a caller reset a row whose copy still sits in
   * somebody's books.
   */
  async withdrawObject(
    ctx: ProviderObjectContext,
    input: WithdrawObjectInput
  ): Promise<Result<WithdrawResult, Error>> {
    return err(
      new UnprocessableEntityError(
        'No accounting system is connected, so there is nothing to remove from one.',
        {
          organizationId: ctx.organizationId,
          objectType: input.objectType,
          externalId: input.externalId,
        }
      )
    )
  }
}

/** The singleton null provider. Stateless, so one instance is enough. */
export const NONE_ACCOUNTING_PROVIDER: AccountingProvider = new NoneAccountingProvider()

/** Builds a provider instance. Async so an adapter can be lazily imported. */
export type AccountingProviderFactory = () => Promise<AccountingProvider>

const factories = new Map<string, AccountingProviderFactory>()
const instances = new Map<string, AccountingProvider>()

/**
 * Register an adapter.
 *
 * Adapters are registered by a caller rather than imported here, so this seam
 * never depends on a specific accounting integration - which is the dependency
 * direction decision P1 is about. The QuickBooks adapter lives in
 * `packages/lib/src/money/quickbooks/`, and `registerAccountingProviders` in
 * `@auxx/lib/money/accounting-providers` is the one registration site, called
 * from both the web app's server bootstrap and the worker's.
 */
export function registerAccountingProvider(id: string, factory: AccountingProviderFactory): void {
  if (id === NONE_PROVIDER_ID) {
    throw new Error(`"${NONE_PROVIDER_ID}" is reserved for the null accounting provider`)
  }
  factories.set(id, factory)
}

/** Ids of every registered adapter, excluding `none`. */
export function listAccountingProviderIds(): string[] {
  return [...factories.keys()]
}

/**
 * Get a provider by id, constructing and caching it on first use.
 *
 * The cache is keyed on the provider id, not the organization: an adapter is a
 * stateless translator and takes `orgId` on every call, so one instance serves
 * every org. Anything per-org an adapter needs (credentials, a connection) it
 * resolves inside the call, where it can also be refreshed.
 */
export async function getAccountingProvider(
  providerId: string
): Promise<Result<AccountingProvider, Error>> {
  if (providerId === NONE_PROVIDER_ID) return ok(NONE_ACCOUNTING_PROVIDER)

  const cached = instances.get(providerId)
  if (cached) return ok(cached)

  const factory = factories.get(providerId)
  if (!factory) {
    return err(new NotFoundError(`No accounting provider registered as "${providerId}"`))
  }

  try {
    const provider = await factory()
    await provider.init?.()
    instances.set(providerId, provider)
    return ok(provider)
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error))
    logger.error('Accounting provider failed to initialize', {
      providerId,
      error: cause.message,
    })
    return err(cause)
  }
}

/**
 * Answers which provider an organization has connected, or `null` for none.
 *
 * Injected rather than implemented here: knowing that an org has QuickBooks
 * installed means reading installed apps and connections, which lives above
 * `packages/lib`'s posting module. Keeping it a hook is what lets this module
 * be tested, and shipped, with no accounting integration in existence.
 */
export type ConnectedProviderResolver = (orgId: string) => Promise<string | null>

let connectedProviderResolver: ConnectedProviderResolver | null = null

/** Install the resolver. Called once at app startup by whoever owns integrations. */
export function setConnectedProviderResolver(resolver: ConnectedProviderResolver | null): void {
  connectedProviderResolver = resolver
}

/**
 * Resolve the provider for one organization.
 *
 * Falls back to `NONE_ACCOUNTING_PROVIDER` when no resolver is installed, when
 * the org has connected nothing, and when the org names a provider that is not
 * registered. The last of those is a warning rather than an error on purpose:
 * an accounting integration that has been uninstalled must not stop the ledger
 * from recording what happened. Postings keep being written; they are just not
 * exported until it comes back.
 */
export async function resolveAccountingProvider(orgId: string): Promise<AccountingProvider> {
  if (!connectedProviderResolver) return NONE_ACCOUNTING_PROVIDER

  const providerId = await connectedProviderResolver(orgId)
  if (!providerId || providerId === NONE_PROVIDER_ID) return NONE_ACCOUNTING_PROVIDER

  const resolved = await getAccountingProvider(providerId)
  if (resolved.isErr()) {
    logger.warn('Connected accounting provider is unavailable - postings stay internal', {
      organizationId: orgId,
      providerId,
      error: resolved.error.message,
    })
    return NONE_ACCOUNTING_PROVIDER
  }
  return resolved.value
}

/** Test-only. Clears the registry and the instance cache. */
export function __resetAccountingProvidersForTests(): void {
  factories.clear()
  instances.clear()
  connectedProviderResolver = null
}
