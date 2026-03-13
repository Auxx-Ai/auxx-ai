// packages/redis/src/types.ts
import { createScopedLogger } from '@auxx/logger'

export const logger = createScopedLogger('redis-client')

/**
 * Pipeline interface for batching Redis commands
 */
export interface RedisPipeline {
  get(key: string): RedisPipeline
  set(key: string, value: any, ...args: any[]): RedisPipeline
  del(key: string): RedisPipeline
  expire(key: string, seconds: number): RedisPipeline
  incr(key: string): RedisPipeline
  incrby(key: string, amount: number): RedisPipeline
  decr(key: string): RedisPipeline
  decrby(key: string, amount: number): RedisPipeline
  sadd(key: string, ...members: string[]): RedisPipeline
  srem(key: string, ...members: string[]): RedisPipeline
  lpush(key: string, ...values: string[]): RedisPipeline
  rpush(key: string, ...values: string[]): RedisPipeline
  ltrim(key: string, start: number, stop: number): RedisPipeline
  zadd(key: string, ...args: any[]): RedisPipeline
  exec(): Promise<any[]>
  [key: string]: any
}

/**
 * Enhanced Redis client interface with optional pub/sub methods
 * Not all providers support all operations
 */
export interface RedisClient {
  // Standard Redis operations (supported by all providers)
  get(key: string): Promise<any>
  set(key: string, value: any, ...args: any[]): Promise<any>
  setex(key: string, seconds: number, value: string): Promise<string>
  del(key: string | string[]): Promise<number>
  exists(key: string | string[]): Promise<number>
  expire(key: string, seconds: number): Promise<number>
  ping(): Promise<string>
  quit(): Promise<string>
  info(section?: string): Promise<string>

  // Optional pub/sub operations (not all providers support these)
  publish(channel: string, message: string): Promise<number>
  subscribe(channel: string): Promise<number>
  unsubscribe(channel: string): Promise<number>
  psubscribe(pattern: string): Promise<number>
  punsubscribe(pattern: string): Promise<number>

  // Connection lifecycle
  connect(): Promise<void>
  disconnect(): void

  // Event handling
  on(event: string, listener: (...args: any[]) => void): void
  removeListener(event: string, listener: (...args: any[]) => void): void

  // Additional operations for polling-based providers
  keys(pattern: string): Promise<string[]>
  rpop(key: string): Promise<string | null>
  lpush(key: string, ...values: string[]): Promise<number>
  rpush(key: string, ...values: string[]): Promise<number>
  llen(key: string): Promise<number>
  ltrim(key: string, start: number, stop: number): Promise<string>
  lrange(key: string, start: number, stop: number): Promise<string[]>

  // Cursor-based iteration (safe for production)
  scan(cursor: string, ...args: any[]): Promise<[string, string[]]>

  // Set operations (Redis 1.0+)
  sadd(key: string, ...members: string[]): Promise<number>
  srem(key: string, ...members: string[]): Promise<number>
  smembers(key: string): Promise<string[]>
  spop(key: string, count?: number): Promise<string | string[] | null>
  scard(key: string): Promise<number>

  // Sorted set operations (Redis 2.0+)
  zadd(key: string, score: number, member: string): Promise<number>
  zadd(key: string, ...args: (number | string)[]): Promise<number>
  zrem(key: string, ...members: string[]): Promise<number>
  zrevrange(key: string, start: number, stop: number): Promise<string[]>
  zcard(key: string): Promise<number>
  zrank(key: string, member: string): Promise<number | null>
  zrevrank(key: string, member: string): Promise<number | null>
  zscore(key: string, member: string): Promise<string | null>

  // Atomic counter operations
  incr(key: string): Promise<number>
  incrby(key: string, amount: number): Promise<number>
  decr(key: string): Promise<number>
  decrby(key: string, amount: number): Promise<number>

  // TTL operations
  ttl(key: string): Promise<number>
  pttl(key: string): Promise<number>
  pexpire(key: string, milliseconds: number): Promise<number>

  // Pipeline support (batch operations)
  pipeline(): RedisPipeline

  // Lua script support (IORedis/AWS)
  eval?(script: string, numKeys: number, ...args: any[]): Promise<any>
}

/**
 * Describes what each Redis provider supports
 */
export interface RedisProviderCapabilities {
  provider: 'upstash' | 'aws' | 'hosted'
  nativePubSub: boolean
  patternSubscribe: boolean
  transactions: boolean
  sortedSets: boolean
  connectionType: 'HTTP' | 'TCP'
  requiresPolling: boolean
  supportedOperations: string[]
}

/**
 * Router performance and status information
 */
export interface EventRouterStats {
  activeHandlers: number
  totalMessages: number
  messageRate: number
  lastActivity: Date | null
  provider: string
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting' | 'error'
  errors: number
  uptime: number
}

/**
 * Configuration for event subscriptions
 */
export interface SubscriptionOptions {
  pattern: string
  handler: (event: any) => void | Promise<void>
  metadata?: Record<string, any>
  once?: boolean
}

/**
 * Event handler registration
 */
export interface EventHandler {
  id: string
  pattern: string
  handler: (event: any) => void | Promise<void>
  metadata?: Record<string, any>
  once?: boolean
  createdAt: Date
  lastTriggered?: Date
  triggerCount: number
}

/**
 * Redis event message format
 */
export interface RedisEvent {
  channel: string
  data: any
  timestamp: number
  id?: string
}

/**
 * Pub/Sub adapter interface
 */
export interface PubSubAdapter {
  subscribe(pattern: string, handler: (channel: string, message: string) => void): Promise<void>
  unsubscribe(pattern: string): Promise<void>
  publish(channel: string, message: string): Promise<number>
  disconnect(): Promise<void>
  isConnected(): boolean
  getCapabilities(): RedisProviderCapabilities
}

/**
 * Provider-specific connection options
 */
export interface RedisConnectionOptions {
  host?: string
  port?: number
  password?: string
  url?: string
  restApiUrl?: string
  restApiToken?: string
}

/**
 * Redis provider type
 */
export type RedisProvider = 'upstash' | 'aws' | 'hosted'
