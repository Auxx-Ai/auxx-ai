// packages/sdk/src/commands/logs/logs-buffer.ts

import type { LogEvent } from './log-event.js'

/**
 * Buffered log event with metadata
 */
interface BufferedLogEvent {
  event: LogEvent
  receivedAt: number
}

/**
 * Listener function type for flushed log events
 */
type LogsListener = (events: LogEvent[]) => void

/**
 * Buffer for log events that handles out-of-order delivery
 * and batches events before flushing to listeners
 */
export class LogsBuffer {
  private bufferDelayMs: number
  private buffer: BufferedLogEvent[] = []
  private listeners: LogsListener[] = []
  private flushInterval: NodeJS.Timeout | null

  /**
   * @param bufferDelayMs - Time to wait before flushing buffered logs
   */
  constructor(bufferDelayMs: number) {
    this.bufferDelayMs = bufferDelayMs
    // Flush every 1/5 of the buffer delay
    this.flushInterval = setInterval(() => {
      this.flush()
    }, bufferDelayMs / 5)
  }

  /**
   * Close the buffer and stop flushing
   */
  close(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
    }
    this.flushInterval = null
  }

  /**
   * Register a listener for flushed log events
   */
  listen(listener: LogsListener): void {
    this.assertNotClosed()
    this.listeners.push(listener)
  }

  /**
   * Add a log event to the buffer
   * Events are inserted in timestamp order
   */
  add(event: LogEvent): void {
    this.assertNotClosed()
    const receivedAt = Date.now()

    // Find insertion point to maintain timestamp order
    const insertIndex = this.buffer.findIndex(
      (bufferItem) => event.timestamp > bufferItem.event.timestamp
    )

    if (insertIndex >= 0) {
      this.buffer.splice(insertIndex, 0, { event, receivedAt })
    } else {
      this.buffer.push({ event, receivedAt })
    }
  }

  /**
   * Flush buffered events that have exceeded the buffer delay
   */
  flush(): void {
    const now = Date.now()

    // Find first event that should be flushed
    const firstFlushIndex = this.buffer.findIndex(
      (bufferItem) => now - bufferItem.receivedAt > this.bufferDelayMs
    )

    if (firstFlushIndex === -1) {
      return
    }

    // Extract events to flush (from firstFlushIndex to end)
    // Reverse to get chronological order (oldest first)
    const eventsToFlush = this.buffer
      .splice(firstFlushIndex, this.buffer.length - firstFlushIndex)
      .reverse()
      .map(({ event }) => event)

    // Notify all listeners
    for (const listener of this.listeners) {
      listener(eventsToFlush)
    }
  }

  /**
   * Ensure buffer is still open
   */
  private assertNotClosed(): void {
    if (this.flushInterval === null) {
      throw new Error('This buffer was closed')
    }
  }
}
