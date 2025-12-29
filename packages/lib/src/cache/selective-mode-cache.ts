// packages/lib/src/cache/selective-mode-cache.ts

import { BaseCacheService } from './base-cache-service'
import { createScopedLogger } from '../logger'

const logger = createScopedLogger('SelectiveModeCache', { color: 'cyan' })

/**
 * Batch tracking information for initial sync processing
 * @interface BatchInfo
 */
interface BatchInfo {
  startedAt: number
  completedAt?: number
  messageCount?: number
  inProgress: boolean
}

/**
 * Cache service for managing selective mode contact creation during initial sync.
 * Persists sent-to information across multiple batch processes using Redis
 * with in-memory fallback.
 * 
 * @example
 * ```typescript
 * const cache = new SelectiveModeCache();
 * 
 * // During initial sync
 * await cache.markBatchProcessing(organizationId, batchId);
 * 
 * // Track outbound recipients
 * await cache.markSentToRecipient('user@example.com', organizationId);
 * 
 * // Check if we've sent to someone
 * const hasSent = await cache.hasSentToRecipient('user@example.com', organizationId);
 * 
 * // Complete batch
 * await cache.completeBatch(organizationId, batchId, messageCount);
 * ```
 */
export class SelectiveModeCache extends BaseCacheService {
  constructor() {
    // 24 hour TTL for initial sync completion
    super('selective:sync', 60 * 60 * 24)
  }
  
  /**
   * Marks that the organization has sent a message to a recipient.
   * @param identifier The recipient identifier (email, phone, etc.)
   * @param organizationId The organization ID
   */
  async markSentToRecipient(identifier: string, organizationId: string): Promise<void> {
    const key = this.buildKey(organizationId, 'sent', identifier)
    await this.set(key, true, { 
      tags: ['selective-sync', `org:${organizationId}`] 
    })
    logger.debug(`Marked recipient as sent-to: ${identifier} for org: ${organizationId}`)
  }
  
  /**
   * Checks if the organization has sent a message to a recipient.
   * @param identifier The recipient identifier
   * @param organizationId The organization ID
   * @returns True if the organization has sent to this recipient
   */
  async hasSentToRecipient(identifier: string, organizationId: string): Promise<boolean> {
    const key = this.buildKey(organizationId, 'sent', identifier)
    const cached = await this.get<boolean>(key)
    return cached === true
  }
  
  /**
   * Marks the start of batch processing for tracking purposes.
   * @param organizationId The organization ID
   * @param batchId Unique identifier for this batch
   */
  async markBatchProcessing(organizationId: string, batchId: string): Promise<void> {
    const key = this.buildKey(organizationId, 'batch', batchId)
    const batchInfo: BatchInfo = {
      startedAt: Date.now(),
      inProgress: true
    }
    await this.set(key, batchInfo, { 
      ttl: 60 * 60 * 2, // 2 hour TTL for batch processing
      tags: ['batch-tracking', `org:${organizationId}`]
    })
    logger.info(`Started batch processing: ${batchId} for org: ${organizationId}`)
  }
  
  /**
   * Marks the completion of a batch process.
   * @param organizationId The organization ID
   * @param batchId The batch identifier
   * @param messageCount Number of messages processed
   */
  async completeBatch(organizationId: string, batchId: string, messageCount: number): Promise<void> {
    const key = this.buildKey(organizationId, 'batch', batchId)
    const batchInfo: BatchInfo = {
      startedAt: Date.now(),
      completedAt: Date.now(),
      messageCount,
      inProgress: false
    }
    await this.set(key, batchInfo, { 
      ttl: 60 * 60, // Keep for 1 hour after completion
      tags: ['batch-tracking', `org:${organizationId}`]
    })
    logger.info(`Completed batch: ${batchId} for org: ${organizationId}, processed ${messageCount} messages`)
  }
  
  /**
   * Gets information about a batch process.
   * @param organizationId The organization ID
   * @param batchId The batch identifier
   * @returns Batch information if found
   */
  async getBatchInfo(organizationId: string, batchId: string): Promise<BatchInfo | null> {
    const key = this.buildKey(organizationId, 'batch', batchId)
    return await this.get<BatchInfo>(key)
  }
  
  /**
   * Clears all selective sync cache data for an organization.
   * @param organizationId The organization ID
   */
  async clearSyncCache(organizationId: string): Promise<void> {
    // Clear all selective sync data for this organization
    await this.invalidateByTag(`org:${organizationId}`)
    logger.info(`Cleared selective sync cache for org: ${organizationId}`)
  }
  
  /**
   * Marks multiple recipients as sent-to in a single operation.
   * @param identifiers Array of recipient identifiers
   * @param organizationId The organization ID
   */
  async markMultipleSentToRecipients(identifiers: string[], organizationId: string): Promise<void> {
    const promises = identifiers.map(identifier => 
      this.markSentToRecipient(identifier, organizationId)
    )
    await Promise.all(promises)
    logger.debug(`Marked ${identifiers.length} recipients as sent-to for org: ${organizationId}`)
  }
  
  /**
   * Gets statistics about the selective sync cache for an organization.
   * @param organizationId The organization ID
   * @returns Cache statistics
   */
  async getCacheStats(organizationId: string): Promise<{ 
    recipientCount: number
    activeBatches: number
    completedBatches: number
  }> {
    // This is a simplified implementation
    // In production, you might want to maintain counters
    const pattern = this.buildKey(organizationId, '*')
    const keys = await this.getKeysByPattern(pattern)
    
    let recipientCount = 0
    let activeBatches = 0
    let completedBatches = 0
    
    for (const key of keys) {
      if (key.includes(':sent:')) {
        recipientCount++
      } else if (key.includes(':batch:')) {
        const batchInfo = await this.get<BatchInfo>(key)
        if (batchInfo?.inProgress) {
          activeBatches++
        } else {
          completedBatches++
        }
      }
    }
    
    return {
      recipientCount,
      activeBatches,
      completedBatches
    }
  }
  
  /**
   * Helper method to get keys matching a pattern (for stats).
   * Note: This is a simplified implementation. In production with Redis,
   * you'd use SCAN command to avoid blocking.
   * @param pattern The key pattern to match
   * @returns Array of matching keys
   */
  private async getKeysByPattern(pattern: string): Promise<string[]> {
    // This would need to be implemented based on your cache infrastructure
    // For now, returning empty array as placeholder
    logger.warn('getKeysByPattern not fully implemented - returning empty array')
    return []
  }
}