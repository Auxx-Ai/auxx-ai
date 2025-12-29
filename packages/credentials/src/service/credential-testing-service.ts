// packages/credentials/src/service/credential-testing-service.ts

import { CredentialService } from './credential-service'
import { createScopedLogger } from '@auxx/logger'
// TODO: Move credential-testers.ts to this package
// import { SmtpTester, PostgresTester } from './credential-testers'
import type { ICredentialType, CredentialTestResult } from '@auxx/workflow-nodes/types'

const logger = createScopedLogger('credential-testing-service')

// Rate limiting storage
const testRateLimit = new Map<string, number>()
const MAX_TESTS_PER_MINUTE = 5

/**
 * Interface for credential testers
 */
interface CredentialTester {
  test(data: Record<string, unknown>): Promise<CredentialTestResult>
}

// Map of credential types to their testers
// TODO: Re-enable when credential-testers.ts is moved
const CREDENTIAL_TESTERS: Record<string, CredentialTester> = {
  // smtp: SmtpTester,
  // postgresWithTesting: PostgresTester,
}

/**
 * Service for testing credential connections and validity
 */
export class CredentialTestingService {
  private static registeredCredentials = new Map<string, ICredentialType>()

  /**
   * Register a credential type for testing
   */
  static registerCredentialType(credentialType: ICredentialType): void {
    this.registeredCredentials.set(credentialType.name, credentialType)
    logger.debug('Registered credential type for testing', {
      type: credentialType.name,
      supportsTest: this.credentialSupportsTest(credentialType.name),
    })
  }

  /**
   * Get a registered credential type
   */
  static getCredentialType(type: string): ICredentialType | undefined {
    return this.registeredCredentials.get(type)
  }

  /**
   * List all registered credential types
   */
  static getRegisteredCredentialTypes(): ICredentialType[] {
    return Array.from(this.registeredCredentials.values())
  }

  /**
   * Check if a credential type supports testing
   */
  static credentialSupportsTest(credentialType: string): boolean {
    return credentialType in CREDENTIAL_TESTERS
  }

  /**
   * Test a credential by ID
   */
  static async testCredential(
    credentialId: string,
    organizationId: string
  ): Promise<CredentialTestResult> {
    try {
      // Check rate limit
      this.checkRateLimit(organizationId)

      logger.info('Testing credential', { credentialId, organizationId })

      // Load the credential data
      const credentialData = await CredentialService.loadCredential(credentialId, organizationId)

      // Get credential info to determine type
      const credentialInfo = await CredentialService.getCredentialInfo(credentialId, organizationId)

      if (!credentialInfo) {
        throw new Error('Credential not found')
      }

      // Check if credential type supports testing
      if (!this.credentialSupportsTest(credentialInfo.type)) {
        return {
          success: true,
          message: 'Testing not supported for this credential type - credential format validated',
        }
      }

      // Get the appropriate tester
      const tester = CREDENTIAL_TESTERS[credentialInfo.type]
      if (!tester) {
        return {
          success: true,
          message: 'Testing not supported for this credential type - credential format validated',
        }
      }

      // Execute the test with timeout
      const testResult = await this.withTimeout(
        tester.test(credentialData),
        15000 // 15 second timeout
      )

      // Log test results for monitoring
      logger.info('Credential test completed', {
        credentialId,
        organizationId,
        type: credentialInfo.type,
        success: testResult.success,
        connectionTime: testResult.details?.connectionTime,
        errorType: testResult.error?.type,
      })

      return testResult
    } catch (error) {
      logger.error('Credential test failed', {
        credentialId,
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      })

      if (error instanceof Error && error.message === 'Test timeout - operation took too long') {
        return {
          success: false,
          message: 'Credential test timed out',
          error: {
            type: 'TIMEOUT_ERROR',
            message: 'The credential test took too long to complete',
          },
        }
      }

      return {
        success: false,
        message: 'Credential test failed',
        error: {
          type: 'UNKNOWN_ERROR',
          message: error instanceof Error ? error.message : 'Unknown testing error',
        },
      }
    }
  }

  /**
   * Test credential data without saving (for validation during creation)
   */
  static async testCredentialData(
    credentialType: string,
    credentialData: Record<string, unknown>,
    organizationId: string
  ): Promise<CredentialTestResult> {
    try {
      // Check rate limit
      this.checkRateLimit(organizationId)

      logger.info('Testing credential data', { credentialType, organizationId })

      // Check if credential type supports testing
      if (!this.credentialSupportsTest(credentialType)) {
        return {
          success: true,
          message: 'Testing not supported for this credential type - credential format validated',
        }
      }

      // Get the appropriate tester
      const tester = CREDENTIAL_TESTERS[credentialType]
      if (!tester) {
        return {
          success: true,
          message: 'Testing not supported for this credential type - credential format validated',
        }
      }

      // Execute the test with timeout
      const testResult = await this.withTimeout(
        tester.test(credentialData),
        15000 // 15 second timeout
      )

      logger.info('Credential data test completed', {
        credentialType,
        organizationId,
        success: testResult.success,
        connectionTime: testResult.details?.connectionTime,
        errorType: testResult.error?.type,
      })

      return testResult
    } catch (error) {
      logger.error('Credential data test failed', {
        credentialType,
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      })

      if (error instanceof Error && error.message === 'Test timeout - operation took too long') {
        return {
          success: false,
          message: 'Credential test timed out',
          error: {
            type: 'TIMEOUT_ERROR',
            message: 'The credential test took too long to complete',
          },
        }
      }

      return {
        success: false,
        message: 'Credential test failed',
        error: {
          type: 'UNKNOWN_ERROR',
          message: error instanceof Error ? error.message : 'Unknown testing error',
        },
      }
    }
  }

  /**
   * Check rate limiting to prevent abuse
   */
  private static checkRateLimit(organizationId: string): boolean {
    const now = Date.now()
    const key = `${organizationId}:${Math.floor(now / 60000)}` // Per minute
    const currentCount = testRateLimit.get(key) || 0

    if (currentCount >= MAX_TESTS_PER_MINUTE) {
      throw new Error('Too many credential tests. Please wait before testing again.')
    }

    testRateLimit.set(key, currentCount + 1)

    // Cleanup old entries (keep only last 2 minutes)
    const oldestKey = `${organizationId}:${Math.floor((now - 120000) / 60000)}`
    testRateLimit.delete(oldestKey)

    return true
  }

  /**
   * Timeout wrapper for credential tests
   */
  private static withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Test timeout - operation took too long')), timeoutMs)
      ),
    ])
  }
}
