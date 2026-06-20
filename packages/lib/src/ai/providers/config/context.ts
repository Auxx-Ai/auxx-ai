// packages/lib/src/ai/providers/config/context.ts

import type { Database } from '@auxx/database'

/**
 * Explicit context threaded through every AI provider config function in place of `this`.
 * `userId` is `'system'` on cache-compute paths and the real user on tRPC/mutation paths.
 */
export type AiProviderCtx = {
  db: Database
  organizationId: string
  userId: string
}

/**
 * Providers that support system (platform-managed) credentials.
 * Only these providers can resolve API keys from environment variables for SYSTEM mode.
 * Must match the providers seeded in organization-seeder.ts.
 */
export const SYSTEM_ELIGIBLE_PROVIDERS = new Set(['anthropic', 'openai'])
