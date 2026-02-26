// packages/lib/src/workflow-engine/startup/credential-types.ts

import { CredentialTestingService } from '@auxx/credentials'
import { createScopedLogger } from '@auxx/logger'
import { PostgresWithTesting, SmtpCredentials } from '@auxx/workflow-nodes/credentials'

const logger = createScopedLogger('credential-types-startup')

/**
 * Initialize and register all credential types that support testing
 */
export async function initializeCredentialTypes(): Promise<void> {
  try {
    logger.info('Initializing credential types with testing support')

    // Register SMTP credentials
    CredentialTestingService.registerCredentialType(new SmtpCredentials())
    logger.debug('Registered SMTP credentials')

    // Register PostgreSQL credentials with testing
    CredentialTestingService.registerCredentialType(new PostgresWithTesting())
    logger.debug('Registered PostgreSQL credentials with testing')

    // Additional credential types can be registered here
    // Example:
    // CredentialTestingService.registerCredentialType(new SlackCredentials())
    // CredentialTestingService.registerCredentialType(new DiscordCredentials())

    const registeredTypes = CredentialTestingService.getRegisteredCredentialTypes()
    logger.info('Credential types initialization completed', {
      totalRegistered: registeredTypes.length,
      withTesting: registeredTypes.filter((type) => !!type.test).length,
      types: registeredTypes.map((type) => ({
        name: type.name,
        displayName: type.displayName,
        supportsTest: !!type.test,
      })),
    })
  } catch (error) {
    logger.error('Failed to initialize credential types', {
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error('Failed to initialize credential types')
  }
}
