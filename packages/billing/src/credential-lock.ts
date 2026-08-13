// packages/billing/src/credential-lock.ts

import { createCredentialLockProvider } from '@auxx/redis'

/**
 * The single-flight lock handed to `getAppConnection` from billing call sites.
 *
 * Billing reads a shop's Admin API token on every subscription/usage call. Shopify's expiring
 * offline access tokens live 60 minutes and **rotate the refresh token on every refresh**, so two
 * concurrent refreshes would persist a dead rotation and permanently break the credential. This
 * lock is what makes that single-flight.
 *
 * Stateless (the client is resolved per call), so a module-level singleton is safe.
 */
export const credentialLock = createCredentialLockProvider()
