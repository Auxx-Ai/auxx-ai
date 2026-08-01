// packages/lib/src/test/utils.ts

/**
 * Test utilities for @auxx/lib package
 */

import { type Mock, vi } from 'vitest'

/**
 * The subset of the Redis client surface the lib tests stub. Declared
 * explicitly (rather than inferred) so the exported signature stays nameable
 * without a reference to vitest's internal `Procedure` type.
 */
export interface MockRedis {
  get: Mock
  set: Mock
  setex: Mock
  del: Mock
  exists: Mock
  expire: Mock
  ttl: Mock
  keys: Mock
  hget: Mock
  hset: Mock
  hdel: Mock
  hgetall: Mock
  pipeline: Mock
  disconnect: Mock
}

/**
 * Creates a mock Redis instance
 */
export function createMockRedis(): MockRedis {
  return {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
    keys: vi.fn(),
    hget: vi.fn(),
    hset: vi.fn(),
    hdel: vi.fn(),
    hgetall: vi.fn(),
    pipeline: vi.fn(() => ({
      set: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn(),
    })),
    disconnect: vi.fn(),
  }
}

/**
 * Waits for a specified amount of time (useful for testing async operations)
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
