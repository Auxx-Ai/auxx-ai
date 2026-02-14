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
  // Constants
  KEYS,
  SESSION_EXPIRATION,
  setRedisData,
} from './client'

// Core classes
export { RedisEventRouter } from './core/redis-event-router'

// Type exports
export type { RedisClient } from './types'
