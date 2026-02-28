// apps/lambda/src/context-provider.ts

/**
 * Creates runtime context for server functions.
 *
 * Provides:
 * - Organization/user metadata
 * - Native fetch (Web Platform API)
 * - Environment info
 *
 * Phase 1: NO secrets access (extensions can only use public APIs)
 * Phase 2: User secrets passed from API (not platform secrets)
 */

import type { ExecutionContext, RuntimeContext } from './types.ts'

/**
 * Create runtime context for server function execution.
 *
 * Phase 1: Basic context only (no secrets)
 */
export function createRuntimeContext(execContext: ExecutionContext): RuntimeContext {
  return {
    // Execution metadata
    organization: {
      id: execContext.organizationId,
      handle: execContext.organizationHandle,
    },
    user: {
      id: execContext.userId,
      email: execContext.userEmail,
      name: execContext.userName,
    },
    app: {
      id: execContext.appId,
      installationId: execContext.appInstallationId,
    },

    // Runtime functions
    fetch: globalThis.fetch, // Native Deno fetch (Web Platform API)

    // Environment
    env: Deno.env.get('NODE_ENV') || 'production',
    // Platform API URL: Use value from caller (preferred), fallback to env var for standalone testing
    apiUrl:
      execContext.apiUrl ||
      Deno.env.get('LAMBDA_API_URL') ||
      Deno.env.get('API_URL') ||
      'http://localhost:3007',

    // Connection data
    userConnection: execContext.userConnection,
    organizationConnection: execContext.organizationConnection,

    // Callback tokens for SDK → API authentication
    callbackTokens: execContext.callbackTokens,
  }
}
