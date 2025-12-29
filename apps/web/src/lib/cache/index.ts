// apps/web/src/lib/cache/index.ts

export { UnifiedCacheManager } from './unified-cache-manager'
export { CacheTransaction } from './cache-transaction'
export { QueryDependencyTracker } from './query-dependency-tracker'
export { BatchedCacheUpdater } from './batched-cache-updater'

export type { CacheUpdateOptions, QueryFilter } from './unified-cache-manager'

// Re-export mutation configs
export { threadMutationConfigs, getThreadMutationConfig } from './mutation-configs/thread-mutations'
export type { ThreadMutationConfig, ThreadMutationName } from './mutation-configs/thread-mutations'

export { getRedisClient } from '@auxx/redis'
