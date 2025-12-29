// packages/lib/src/cache/index.ts

// Moved to apps/web/src/lib/cache/
// export { UnifiedCacheManager } from './unified-cache-manager'
// export { CacheTransaction } from './cache-transaction'  
// export { QueryDependencyTracker } from './query-dependency-tracker'
// export { BatchedCacheUpdater } from './batched-cache-updater'

export { BaseCacheService } from './base-cache-service'

// Moved to apps/web/src/lib/cache/
// export type { CacheUpdateOptions, QueryFilter } from './unified-cache-manager'
export type { CacheOptions, CacheEntry } from './base-cache-service'

// Moved to apps/web/src/lib/cache/
// export { threadMutationConfigs, getThreadMutationConfig } from './mutation-configs/thread-mutations'
// export type { ThreadMutationConfig, ThreadMutationName } from './mutation-configs/thread-mutations'

// Re-export for convenience
export { getRedisClient } from '@auxx/redis'
