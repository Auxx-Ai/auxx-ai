// apps/web/src/app/startup.ts

import { initializeCredentialTypes } from '@auxx/lib/workflow-engine/startup/credential-types'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('app-startup')

/**
 * Initialize application-level services
 * Call this early in the app startup process
 */
export async function initializeApp(): Promise<void> {
  try {
    logger.info('Starting application initialization')

    // Initialize credential types for testing
    await initializeCredentialTypes()

    logger.info('Application initialization completed successfully')
  } catch (error) {
    logger.error('Application initialization failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
