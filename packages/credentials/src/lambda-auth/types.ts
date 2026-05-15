// packages/credentials/src/lambda-auth/types.ts

/**
 * Headers added to signed Lambda invocation requests.
 * These headers authenticate the caller to the Lambda function.
 */
export interface InboundAuthHeaders {
  'X-Auxx-Signature': string
  'X-Auxx-Timestamp': string
  'X-Auxx-Nonce': string
  'X-Auxx-Caller': string
  'X-Auxx-Key-Id': string
}

/**
 * Scopes available for callback tokens.
 * Each scope restricts the token to specific API callback routes.
 *
 * `entities` is minted only for AI tool invocations and authorizes the
 * `find-by-integration-id` lookup. See
 * plans/kopilot/apps/credentials.md §3.6.
 */
export type CallbackScope = 'webhooks' | 'settings' | 'entities'

/**
 * Result of verifying an inbound request signature.
 */
export interface VerifyResult {
  valid: boolean
  caller?: string
  reason?: string
}
