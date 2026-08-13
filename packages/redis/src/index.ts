// packages/redis/src/index.ts

// Client functions
export {
  createDedicatedClient,
  deleteRedisData,
  getConnectionOptions,
  getPublishingClient,
  getRedisClient,
  getRedisData,
  getRedisProvider,
  getSubscriptionClient,
  isRedisAvailable,
  // Constants
  KEYS,
  SESSION_EXPIRATION,
  setRedisData,
} from './client'

// Core classes
export { RedisEventRouter } from './core/redis-event-router'

// Credential single-flight lock (implements @auxx/credentials/connections' CredentialLockProvider)
export { createCredentialLockProvider } from './credential-lock'

// Type exports
export type { RedisClient } from './types'
