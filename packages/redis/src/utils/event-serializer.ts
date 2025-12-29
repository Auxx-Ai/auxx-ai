// packages/redis/src/utils/event-serializer.ts
import { logger, type RedisEvent } from '../types'
import { safeJsonStringify } from './serialization'

/**
 * Event serialization helpers for Redis messages
 */

/**
 * Serialize event data for Redis storage
 */
export function serializeEvent(data: any): string {
  try {
    if (typeof data === 'string') {
      return data
    }

    const event: RedisEvent = {
      channel: '', // Will be set by publisher
      data,
      timestamp: Date.now(),
      id: generateEventId(),
    }

    return safeJsonStringify(event)
  } catch (error) {
    logger.error('Error serializing event', { error: (error as Error).message })
    throw new Error(`Failed to serialize event: ${(error as Error).message}`)
  }
}

/**
 * Deserialize event data from Redis
 */
export function deserializeEvent(message: string): any {
  try {
    // Try to parse as JSON first
    const parsed = JSON.parse(message)

    // If it's already a RedisEvent, return the data
    if (parsed && typeof parsed === 'object' && 'data' in parsed && 'timestamp' in parsed) {
      return parsed.data
    }

    // Otherwise return as-is
    return parsed
  } catch (error) {
    // If not JSON, return as string
    return message
  }
}

/**
 * Create a complete Redis event
 */
export function createRedisEvent(channel: string, data: any): RedisEvent {
  return {
    channel,
    data,
    timestamp: Date.now(),
    id: generateEventId(),
  }
}

/**
 * Serialize a complete Redis event
 */
export function serializeRedisEvent(event: RedisEvent): string {
  try {
    return safeJsonStringify(event)
  } catch (error) {
    logger.error('Error serializing Redis event', { event, error: (error as Error).message })
    throw new Error(`Failed to serialize Redis event: ${(error as Error).message}`)
  }
}

/**
 * Deserialize a complete Redis event
 */
export function deserializeRedisEvent(message: string): RedisEvent {
  try {
    const parsed = JSON.parse(message)

    // Validate required fields
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid event format: not an object')
    }

    if (!('channel' in parsed) || !('data' in parsed) || !('timestamp' in parsed)) {
      // If missing required fields, create a proper event
      return {
        channel: 'unknown',
        data: parsed,
        timestamp: Date.now(),
        id: generateEventId(),
      }
    }

    return parsed as RedisEvent
  } catch (error) {
    logger.warn('Failed to deserialize as Redis event, creating wrapper', {
      message,
      error: (error as Error).message,
    })

    // Create a wrapper event for non-JSON or malformed data
    return {
      channel: 'unknown',
      data: message,
      timestamp: Date.now(),
      id: generateEventId(),
    }
  }
}

/**
 * Generate unique event ID
 */
export function generateEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
}

/**
 * Validate event data before serialization
 */
export function validateEventData(data: any): boolean {
  try {
    // Check if data can be serialized
    JSON.stringify(data)
    return true
  } catch (error) {
    logger.error('Event data validation failed', { error: (error as Error).message })
    return false
  }
}

/**
 * Safe serialize with error handling
 */
export function safeSerialize(data: any, fallback = '{}'): string {
  try {
    return serializeEvent(data)
  } catch (error) {
    logger.error('Safe serialize fallback used', { error: (error as Error).message })
    return fallback
  }
}

/**
 * Safe deserialize with error handling
 */
export function safeDeserialize(message: string, fallback: any = null): any {
  try {
    return deserializeEvent(message)
  } catch (error) {
    logger.error('Safe deserialize fallback used', { message, error: (error as Error).message })
    return fallback
  }
}

/**
 * Compress event data for large payloads (simple implementation)
 */
export function compressEventData(data: any): string {
  // For now, just use JSON stringify
  // In the future, we could add gzip compression for large payloads
  return JSON.stringify(data)
}

/**
 * Decompress event data
 */
export function decompressEventData(compressedData: string): any {
  try {
    return JSON.parse(compressedData)
  } catch (error) {
    logger.error('Error decompressing event data', { error: (error as Error).message })
    return compressedData
  }
}

/**
 * Get event size in bytes (approximate)
 */
export function getEventSize(data: any): number {
  try {
    const serialized = serializeEvent(data)
    return new Blob([serialized]).size
  } catch (error) {
    logger.error('Error calculating event size', { error: (error as Error).message })
    return 0
  }
}

/**
 * Check if event is too large for Redis
 * Default Redis max string size is 512MB, but we'll use a more conservative limit
 */
export function isEventTooLarge(data: any, maxSize = 1024 * 1024): boolean {
  // 1MB default
  return getEventSize(data) > maxSize
}
