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
import { NotFoundError } from '../errors'
import type { PostEntryInput, PostEntryResult } from './types'

const logger = createScopedLogger('postings-provider')

/** The id of the null provider. Reserved - no adapter may register under it. */
export const NONE_PROVIDER_ID = 'none'

/**
 * One accounting system auxx.ai can export postings to.
 *
 * Deliberately two methods. Everything else an accounting integration does -
 * customers, invoices, payments, the chart itself - belongs to the app that owns
 * that integration; this interface is only the posting seam.
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
   * Push one balanced entry.
   *
   * MUST be idempotent on `input.idempotencyKey`: a retry after a timeout has to
   * converge on the entry already posted rather than post a second one. A
   * double-posted journal entry has no invoice or payment to reconcile against
   * and is not noticed until a close does not tie out.
   *
   * The entry handed here is already balanced - `buildEntry` refuses to produce
   * an unbalanced one. An adapter must not silently repair amounts.
   */
  postEntry(input: PostEntryInput): Promise<Result<PostEntryResult, Error>>
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

  async postEntry(input: PostEntryInput): Promise<Result<PostEntryResult, Error>> {
    logger.debug('No accounting provider connected - posting stays internal', {
      organizationId: input.organizationId,
      glPostingId: input.glPostingId,
      docNumber: input.docNumber,
    })
    return ok({ status: 'not_connected', externalId: '', providerId: NONE_PROVIDER_ID })
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
 * Adapters register themselves from the app layer rather than being imported
 * here, so `packages/lib` never depends on a specific accounting integration -
 * which is the dependency direction decision P1 is about. The QuickBooks adapter
 * is build plan phase 7 and lives in the apps repo.
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
