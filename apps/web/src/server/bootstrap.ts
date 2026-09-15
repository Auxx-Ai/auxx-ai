// apps/web/src/server/bootstrap.ts

import 'server-only'

// Side-effect import: registers the OpenObserve log sink when OPENOBSERVE_URL is set.
import '@auxx/logger/openobserve'
import { configService } from '@auxx/credentials'
import { registerChannelHooks } from '@auxx/lib/channels'
import { createScopedLogger } from '@auxx/logger'
import { registerAccountingProviders } from '~/server/accounting-providers'
import { registerPayoutSources } from '~/server/payout-sources'

const logger = createScopedLogger('web-bootstrap')
let initPromise: Promise<void> | null = null

/**
 * Initialize process-level services once per server instance.
 * Safe to call multiple times and from multiple concurrent requests.
 */
export async function ensureWebAppInitialized(): Promise<void> {
  if (initPromise) return initPromise

  initPromise = (async () => {
    logger.info('Starting web app initialization')
    await configService.init()
    registerChannelHooks()
    // Populates the `postings` provider registry from the app layer. `packages/lib`
    // must never import an accounting adapter itself (decision P1), so without this
    // every organization resolves to the null provider and nothing is exported.
    registerAccountingProviders()
    // Same shape, one registry over: the payout pipeline knows only the
    // `PayoutSource` interface, and the `payout.paid` webhook and "Sync now"
    // both run it in this process (brief 27 §4, §7).
    registerPayoutSources()
    logger.info('Web app initialization completed successfully')
  })()

  try {
    await initPromise
  } catch (error) {
    logger.error('Web app initialization failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    initPromise = null
    throw error
  }
}
