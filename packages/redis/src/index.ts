// packages/redis/src/index.ts

// Client functions
export {
  getRedisClient,
  getPublishingClient,
  getSubscriptionClient,
  createDedicatedClient,
  getConnectionOptions,
  getRedisProvider,
  setRedisData,
  getRedisData,
  deleteRedisData,
  // Constants
  KEYS,
  SESSION_EXPIRATION,
} from './client'

// Core classes
export { RedisEventRouter } from './core/redis-event-router'

// Type exports
export type { RedisClient } from './types'
