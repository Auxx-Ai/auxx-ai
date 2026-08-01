// packages/lib/src/utils/rate-limiter/priority-queue.ts

import type { QueuedRequest } from './types'

/**
 * Priority queue implementation using a min-heap
 * Lower priority values have higher priority (processed first)
 */
export class PriorityQueue<T = any> {
  private heap: QueuedRequest<T>[] = []
  private processing = false

  /**
   * Add a request to the queue
   * @param request - Request to enqueue
   */
  enqueue(request: QueuedRequest<T>): void {
    this.heap.push(request)
    this.bubbleUp(this.heap.length - 1)
  }

  /**
   * Remove and return the highest priority request
   * @returns The highest priority request, or undefined if queue is empty
   */
  dequeue(): QueuedRequest<T> | undefined {
    if (this.heap.length === 0) return undefined

    const result = this.heap[0]
    const end = this.heap.pop()
    if (!result || !end) return undefined

    if (this.heap.length > 0) {
      this.heap[0] = end
      this.bubbleDown(0)
    }

    return result
  }

  /**
   * Move an element up the heap to maintain heap property
   * @param index - Index of element to bubble up
   */
  private bubbleUp(index: number): void {
    const element = this.heap[index]
    if (!element) return

    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      const parent = this.heap[parentIndex]
      if (!parent) return

      if (this.compare(element, parent) >= 0) break

      this.heap[parentIndex] = element
      this.heap[index] = parent
      index = parentIndex
    }
  }

  /**
   * Move an element down the heap to maintain heap property
   * @param index - Index of element to bubble down
   */
  private bubbleDown(index: number): void {
    const length = this.heap.length
    const element = this.heap[index]
    if (!element) return

    while (true) {
      const leftChildIndex = 2 * index + 1
      const rightChildIndex = 2 * index + 2
      let swapIndex = -1

      if (leftChildIndex < length) {
        const leftChild = this.heap[leftChildIndex]
        if (leftChild && this.compare(leftChild, element) < 0) {
          swapIndex = leftChildIndex
        }
      }

      if (rightChildIndex < length) {
        const rightChild = this.heap[rightChildIndex]
        const compareWith = swapIndex === -1 ? element : this.heap[swapIndex]
        if (rightChild && compareWith && this.compare(rightChild, compareWith) < 0) {
          swapIndex = rightChildIndex
        }
      }

      if (swapIndex === -1) break

      const swap = this.heap[swapIndex]
      if (!swap) return
      this.heap[index] = swap
      this.heap[swapIndex] = element
      index = swapIndex
    }
  }

  /**
   * Compare two requests for priority ordering
   * @param a - First request
   * @param b - Second request
   * @returns Negative if a has higher priority, positive if b has higher priority, 0 if equal
   */
  private compare(a: QueuedRequest<T>, b: QueuedRequest<T>): number {
    // Higher priority first (lower number = higher priority)
    if (a.priority !== b.priority) {
      return a.priority - b.priority
    }
    // Earlier timestamp first for same priority (FIFO)
    return a.timestamp - b.timestamp
  }

  /**
   * Get the size of the queue
   * @returns Number of requests in the queue
   */
  size(): number {
    return this.heap.length
  }

  /**
   * Check if the queue is empty
   * @returns true if queue is empty
   */
  isEmpty(): boolean {
    return this.heap.length === 0
  }

  /**
   * Peek at the highest priority request without removing it
   * @returns The highest priority request, or undefined if queue is empty
   */
  peek(): QueuedRequest<T> | undefined {
    return this.heap[0]
  }

  /**
   * Clear all requests from the queue
   * @param rejectMessage - Optional message for rejecting queued requests
   */
  clear(rejectMessage?: string): void {
    // Reject all pending requests
    for (const request of this.heap) {
      request.reject(new Error(rejectMessage ?? 'Queue cleared'))
    }
    this.heap = []
  }

  /**
   * Remove a specific request from the queue by ID
   * @param id - Request ID to remove
   * @returns true if request was found and removed
   */
  remove(id: string): boolean {
    const index = this.heap.findIndex((req) => req.id === id)
    if (index === -1) return false

    const request = this.heap[index]
    if (!request) return false
    request.reject(new Error('Request cancelled'))

    // Remove the element and reheapify
    const end = this.heap.pop()
    if (!end) return false
    if (index < this.heap.length) {
      this.heap[index] = end
      // Try both bubble up and down to maintain heap property
      this.bubbleUp(index)
      this.bubbleDown(index)
    }

    return true
  }

  /**
   * Get all requests in the queue (for inspection, not in priority order)
   * @returns Array of all queued requests
   */
  toArray(): QueuedRequest<T>[] {
    return [...this.heap]
  }

  /**
   * Get all requests in priority order without modifying the queue
   * @returns Array of requests sorted by priority
   */
  toSortedArray(): QueuedRequest<T>[] {
    return [...this.heap].sort((a, b) => this.compare(a, b))
  }

  /**
   * Find a request by ID
   * @param id - Request ID to find
   * @returns The request, or undefined if not found
   */
  find(id: string): QueuedRequest<T> | undefined {
    return this.heap.find((req) => req.id === id)
  }

  /**
   * Check if a request with the given ID exists in the queue
   * @param id - Request ID to check
   * @returns true if request exists
   */
  has(id: string): boolean {
    return this.heap.some((req) => req.id === id)
  }

  /**
   * Update the priority of a request
   * @param id - Request ID
   * @param newPriority - New priority value
   * @returns true if request was found and updated
   */
  updatePriority(id: string, newPriority: number): boolean {
    const index = this.heap.findIndex((req) => req.id === id)
    if (index === -1) return false

    const request = this.heap[index]
    if (!request) return false

    const oldPriority = request.priority
    request.priority = newPriority

    // Reheapify based on whether priority increased or decreased
    if (newPriority < oldPriority) {
      this.bubbleUp(index)
    } else if (newPriority > oldPriority) {
      this.bubbleDown(index)
    }

    return true
  }

  /**
   * Get statistics about the queue
   * @returns Queue statistics
   */
  getStats(): {
    size: number
    isEmpty: boolean
    oldestTimestamp?: number
    newestTimestamp?: number
    highestPriority?: number
    lowestPriority?: number
    averagePriority?: number
  } {
    if (this.heap.length === 0) {
      return {
        size: 0,
        isEmpty: true,
      }
    }

    const timestamps = this.heap.map((r) => r.timestamp)
    const priorities = this.heap.map((r) => r.priority)

    return {
      size: this.heap.length,
      isEmpty: false,
      oldestTimestamp: Math.min(...timestamps),
      newestTimestamp: Math.max(...timestamps),
      highestPriority: Math.min(...priorities),
      lowestPriority: Math.max(...priorities),
      averagePriority: priorities.reduce((a, b) => a + b, 0) / priorities.length,
    }
  }

  /**
   * Set/unset processing flag
   * @param processing - Whether queue is being processed
   */
  setProcessing(processing: boolean): void {
    this.processing = processing
  }

  /**
   * Check if queue is being processed
   * @returns true if queue is being processed
   */
  isProcessing(): boolean {
    return this.processing
  }
}
