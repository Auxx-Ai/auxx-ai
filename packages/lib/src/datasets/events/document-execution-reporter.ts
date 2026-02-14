// packages/lib/src/datasets/events/document-execution-reporter.ts

import { createScopedLogger } from '@auxx/logger'
import { getPublishingClient } from '@auxx/redis'
import {
  type ChunkingCompletedData,
  type DocumentEvent,
  DocumentEventType,
  type EmbeddingProgressData,
  type ExtractionCompletedData,
  type ProcessingCompletedData,
  type ProcessingFailedData,
} from './types'

const logger = createScopedLogger('document-execution-reporter')

/**
 * Interface for reporting document processing events
 * Mirrors WorkflowExecutionReporter
 */
export interface DocumentExecutionReporter {
  emit(event: DocumentEventType, data: any): Promise<void>
}

/**
 * Redis-based implementation for SSE streaming
 * Publishes events to Redis channel for SSE endpoint consumption
 */
export class RedisDocumentExecutionReporter implements DocumentExecutionReporter {
  private channel: string

  constructor(
    private documentId: string,
    private datasetId: string,
    private redisClient?: any
  ) {
    this.channel = `document:process:${documentId}`
  }

  async emit(event: DocumentEventType, data: any): Promise<void> {
    try {
      const redis = this.redisClient || (await getPublishingClient())

      if (!redis) {
        throw new Error('Redis client is null or undefined')
      }

      const message: DocumentEvent = {
        event,
        documentId: this.documentId,
        datasetId: this.datasetId,
        timestamp: new Date().toISOString(),
        data,
      }

      await redis.publish(this.channel, JSON.stringify(message))
    } catch (error) {
      // Log but don't throw - events are best effort
      logger.error(`Failed to emit ${event} event:`, {
        error: error instanceof Error ? error.message : String(error),
        event,
        documentId: this.documentId,
        channel: this.channel,
      })
    }
  }

  // Convenience methods for common events

  async processingStarted(fileName: string, mimeType: string): Promise<void> {
    await this.emit(DocumentEventType.PROCESSING_STARTED, {
      fileName,
      mimeType,
    })
  }

  async extractionStarted(): Promise<void> {
    await this.emit(DocumentEventType.EXTRACTION_STARTED, {
      step: 'extraction',
    })
  }

  async extractionCompleted(data: ExtractionCompletedData): Promise<void> {
    await this.emit(DocumentEventType.EXTRACTION_COMPLETED, data)
  }

  async chunkingStarted(contentLength: number): Promise<void> {
    await this.emit(DocumentEventType.CHUNKING_STARTED, {
      contentLength,
      step: 'chunking',
    })
  }

  async chunkingCompleted(data: ChunkingCompletedData): Promise<void> {
    await this.emit(DocumentEventType.CHUNKING_COMPLETED, data)
  }

  async embeddingStarted(totalSegments: number): Promise<void> {
    await this.emit(DocumentEventType.EMBEDDING_STARTED, {
      totalSegments,
      step: 'embedding',
    })
  }

  async embeddingProgress(data: EmbeddingProgressData): Promise<void> {
    await this.emit(DocumentEventType.EMBEDDING_PROGRESS, data)
  }

  async embeddingCompleted(totalSegments: number, processingTimeMs: number): Promise<void> {
    await this.emit(DocumentEventType.EMBEDDING_COMPLETED, {
      totalSegments,
      processingTimeMs,
    })
  }

  async processingCompleted(data: ProcessingCompletedData): Promise<void> {
    await this.emit(DocumentEventType.PROCESSING_COMPLETED, data)
  }

  async processingFailed(data: ProcessingFailedData): Promise<void> {
    await this.emit(DocumentEventType.PROCESSING_FAILED, data)
  }
}

/**
 * Null implementation for when events aren't needed
 */
export class NullDocumentExecutionReporter implements DocumentExecutionReporter {
  async emit(): Promise<void> {
    // No-op
  }
}
