// packages/lib/src/accounting/providers/accounting-providers.ts

import { createScopedLogger } from '@auxx/logger'
import { getCachedInstalledApps } from '../../cache'
import { registerConnectAndGoTrigger } from '../connect-and-go/trigger'
import { registerAccountingProvider, setConnectedProviderResolver } from './provider'

const logger = createScopedLogger('accounting-providers')

/**
 * The QuickBooks app's installed-app SLUG, which is also the id its
 * `AccountingProvider` adapter registers under
 * (`QUICKBOOKS_PROVIDER_ID` in `./quickbooks/quickbooks-accounting-provider.ts`).
 *
 * Spelled here rather than imported so the adapter stays out of this module's
 * static graph - the factory below is `() => Promise<AccountingProvider>`
 * precisely so an adapter can be lazily imported, and a static import of the
 * constant would pull the whole adapter in at boot and defeat that. The two
 * spellings must match; the adapter's own doc comment says so from its side.
 */
const QUICKBOOKS = 'quickbooks'

/**
 * Install the accounting-provider registry's two hooks: which adapters exist,
 * and which one an organization has connected.
 *
 * 🛑 **Every process that POSTS must call this at boot** - web AND the worker
 * (`plans/accounting/tasks/27-a-settlement-from-anywhere.md` §1.5). The
 * posting core (`postings/post-entry.ts`) knows only the `AccountingProvider`
 * interface and the null provider; without this call every organization
 * resolves to `NONE_ACCOUNTING_PROVIDER`, the entry is built, balanced and
 * persisted, and it lands as `not_required` and never reaches QuickBooks. That
 * is exactly what happened to every payout `payoutSyncJob` posted from the
 * worker before the worker called this. `registerChannelHooks()` in
 * `channels/` is the same shape for the same reason, and is called from the
 * same two boot sequences.
 *
 * Lives in lib rather than the app layer so there is ONE registration and two
 * callers, not two copies that drift. Decision P1 - `postings/` never imports a
 * specific accounting integration - holds: this module is not `postings/`, and
 * the adapter it registers already lives in `money/quickbooks/`.
 *
 * Idempotent: both calls overwrite rather than accumulate, so calling this
 * twice on a hot reload is harmless.
 */
export function registerAccountingProviders(): void {
  // Lazy import: the adapter reaches the app-runtime Lambda chain through
  // `invoke-quickbooks-tool.ts`, and an org that has never connected QuickBooks
  // must not pay for that graph on every boot.
  registerAccountingProvider(QUICKBOOKS, async () => {
    const { createQuickbooksAccountingProvider } = await import(
      './quickbooks/quickbooks-accounting-provider'
    )
    return createQuickbooksAccountingProvider()
  })

  setConnectedProviderResolver(resolveConnectedProvider)
  registerConnectAndGoTrigger()

  logger.debug('Accounting providers registered', { providers: [QUICKBOOKS] })
}

/**
 * Which accounting system one organization has connected, or `null` for none.
 *
 * Reads the installed-apps org cache - the same answer
 * `invoke-quickbooks-tool.ts` already takes to the question "does this org have
 * QuickBooks installed", so there is one source of truth for it and it is
 * already hydrated per org.
 *
 * ⚠️ **Deliberately only the INSTALLATION check, not the full chain.** An
 * installed app can still have no active deployment and no org- or user-scoped
 * connection, and `resolveQuickbooksContext` inside the adapter resolves exactly
 * that chain and collapses every one of those cases into `not_connected` on the
 * `PostEntryResult`. Duplicating it here would run the installation ->
 * deployment -> connection resolution twice per post to reach the same answer,
 * and the outcome a caller sees would be identical either way: the entry is
 * built, balanced and persisted, and simply not exported.
 *
 * Failing to read the cache resolves to `null` rather than throwing. An
 * accounting integration that cannot be looked up must not stop the ledger from
 * recording what happened - postings keep being written, they are just not
 * exported until it comes back. `resolveAccountingProvider` takes the same
 * position on an adapter that has been uninstalled.
 */
async function resolveConnectedProvider(organizationId: string): Promise<string | null> {
  try {
    const installed = await getCachedInstalledApps(organizationId)
    return installed.some((app) => app.app.slug === QUICKBOOKS) ? QUICKBOOKS : null
  } catch (error) {
    logger.warn('Could not resolve the connected accounting provider - postings stay internal', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
