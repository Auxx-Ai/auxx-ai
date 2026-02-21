// apps/web/src/server/bootstrap.ts

import 'server-only'

import { configService } from '@auxx/credentials/config'
import { createScopedLogger } from '@auxx/logger'

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
