// packages/lib/src/credentials/credential-lock.ts

import { createCredentialLockProvider } from '@auxx/redis'

/**
 * The single-flight lock handed to `ensureFreshCredentialToken` from lib call sites.
 *
 * `ensureFreshCredentialToken` lives in `@auxx/credentials`, which sits below `@auxx/redis` in the
 * dependency graph and therefore cannot reach a Redis client itself — it declares the
 * `CredentialLockProvider` interface and takes an implementation. This module is where lib binds
 * the Redis one, so every lib caller serialises refreshes exactly as it did before the seam moved.
 *
 * Stateless (the client is resolved per call), so a module-level singleton is safe.
 */
export const credentialLock = createCredentialLockProvider()
