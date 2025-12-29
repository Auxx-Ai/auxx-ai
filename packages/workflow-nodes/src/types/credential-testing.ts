// packages/workflow-nodes/src/types/credential-testing.ts

/**
 * Interface for credential testing functionality
 * Each credential type can implement this to provide validation
 */
export interface ICredentialTest {
  /**
   * Test the credential to verify it works with the external service
   * @param credentialData - The decrypted credential data
   * @returns Promise with test results
   */
  test(credentialData: Record<string, unknown>): Promise<CredentialTestResult>
}

/**
 * Result of a credential test operation
 */
export interface CredentialTestResult {
  /** Whether the test was successful */
  success: boolean
  /** Human-readable message about the test result */
  message: string
  /** Additional details about the test */
  details?: {
    /** Time taken to establish connection (ms) */
    connectionTime?: number
    /** Information about the connected server/service */
    serverInfo?: string
    /** Available permissions/scopes */
    permissions?: string[]
    /** Quota/usage information if available */
    quotaInfo?: {
      used: number
      limit: number
      unit?: string
    }
  }
  /** Error information if the test failed */
  error?: {
    /** Type of error encountered */
    type:
      | 'CONNECTION_ERROR'
      | 'AUTH_ERROR'
      | 'PERMISSION_ERROR'
      | 'QUOTA_ERROR'
      | 'VALIDATION_ERROR'
      | 'TIMEOUT_ERROR'
      | 'UNKNOWN_ERROR'
    /** Error message */
    message: string
    /** Error code from the service (if available) */
    code?: string | number
  }
}

/**
 * Timeout wrapper for credential tests
 */
// export const withTimeout = <T>(promise: Promise<T>, timeoutMs: number = 30000): Promise<T> => {
//   return Promise.race([
//     promise,
//     new Promise<T>((_, reject) =>
//       setTimeout(() => reject(new Error('Test timeout - operation took too long')), timeoutMs)
//     ),
//   ])
// }
