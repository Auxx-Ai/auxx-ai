// apps/web/src/components/workflow/store/history-manager.ts

// import { nanoid } from 'nanoid'
import { v4 as uuidv4 } from 'uuid'
import { storeEventBus } from './event-bus'
import type { HistoryEntry } from './types'

interface HistoryManagerOptions {
  maxHistorySize?: number
  batchingWindow?: number
}

/**
 * Enhanced history entry with navigation context
 */
export interface NavigationHistoryEntry extends HistoryEntry {
  relativePosition: number // Steps from current state (negative = past, positive = future, 0 = current)
  actionDescription: string // Human-readable description
}

interface StoreInstance {
  [key: string]: any
}

/**
 * Centralized history manager for undo/redo functionality across all stores
 */
export class HistoryManager {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private stores = new Map<string, StoreInstance>()
  private currentBatch: string | null = null
  private batchTimeout: NodeJS.Timeout | null = null
  private currentStateIndex: number = -1 // Current position in combined history

  private maxHistorySize: number
  private batchingWindow: number

  constructor(options: HistoryManagerOptions = {}) {
    this.maxHistorySize = options.maxHistorySize || 50
    this.batchingWindow = options.batchingWindow || 300
  }

  /**
   * Register a store with the history manager
   */
  registerStore(name: string, store: StoreInstance): void {
    this.stores.set(name, store)
  }

  /**
   * Unregister a store
   */
  unregisterStore(name: string): void {
    this.stores.delete(name)
  }

  /**
   * Record a history entry
   */
  record(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): void {
    const historyEntry: HistoryEntry = {
      ...entry,
      id: uuidv4(),
      timestamp: Date.now(),
      batch: this.currentBatch!,
    }

    this.undoStack.push(historyEntry)
    this.redoStack = [] // Clear redo stack on new action
    this.currentStateIndex = this.undoStack.length - 1

    // Trim history if needed
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift()
      this.currentStateIndex = Math.max(0, this.currentStateIndex - 1)
    }

    // Emit event for UI updates
    this.emitHistoryChange()

    // Auto-end batch after timeout
    if (this.currentBatch && !this.batchTimeout) {
      this.batchTimeout = setTimeout(() => {
        this.endBatch()
      }, this.batchingWindow)
    }
  }

  /**
   * Start a batch of operations
   */
  startBatch(label: string): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout)
      this.batchTimeout = null
    }
    this.currentBatch = uuidv4()
  }

  /**
   * End the current batch
   */
  endBatch(): void {
    this.currentBatch = null
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout)
      this.batchTimeout = null
    }
  }

  /**
   * Perform undo operation
   */
  undo(): void {
    if (this.undoStack.length <= 1) return // Need at least 2 states to undo

    // Pop the current state and move it to redo stack
    const currentEntry = this.undoStack.pop()
    if (currentEntry) {
      this.redoStack.push(currentEntry)
    }

    // Get the previous state (now the last in undo stack)
    const previousEntry = this.undoStack[this.undoStack.length - 1]

    // Restore the previous state
    if (previousEntry && previousEntry.action === 'workflow_event') {
      const store = this.stores.get('workflow')
      if (store && previousEntry.data?.nodes && previousEntry.data?.edges) {
        store.setNodes(previousEntry.data.nodes)
        store.setEdges(previousEntry.data.edges)
      }
    }

    this.currentStateIndex = this.undoStack.length - 1
    this.emitHistoryChange()
  }

  /**
   * Perform redo operation
   */
  redo(): void {
    if (this.redoStack.length === 0) return

    // Get entry from redo stack
    const entry = this.redoStack.pop()
    if (!entry) return

    // Add it back to undo stack
    this.undoStack.push(entry)

    // Restore the state
    if (entry.action === 'workflow_event') {
      const store = this.stores.get('workflow')
      if (store && entry.data?.nodes && entry.data?.edges) {
        store.setNodes(entry.data.nodes)
        store.setEdges(entry.data.edges)
      }
    }

    this.currentStateIndex = this.undoStack.length - 1
    this.emitHistoryChange()
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.undoStack.length > 1 // Need at least 2 states to undo
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /**
   * Get the history entries (for UI display)
   */
  getHistory(): HistoryEntry[] {
    return [...this.undoStack]
  }

  /**
   * Get navigation history with relative positions
   */
  getNavigationHistory(): NavigationHistoryEntry[] {
    const allEntries = [...this.undoStack, ...this.redoStack.slice().reverse()]
    const currentIndex = this.currentStateIndex

    return allEntries.map((entry, index) => ({
      ...entry,
      relativePosition: index - currentIndex,
      actionDescription: this.getActionDescription(entry),
    }))
  }

  /**
   * Jump to a specific history state
   */
  jumpToState(targetIndex: number): void {
    const allEntries = [...this.undoStack, ...this.redoStack.slice().reverse()]

    if (targetIndex < 0 || targetIndex >= allEntries.length) {
      console.warn('Invalid history index:', targetIndex)
      return
    }

    const currentIndex = this.currentStateIndex

    if (targetIndex === currentIndex) {
      return // Already at target state
    }

    if (targetIndex < currentIndex) {
      // Moving backward - undo operations
      const stepsBack = currentIndex - targetIndex
      for (let i = 0; i < stepsBack; i++) {
        this.undo()
      }
    } else {
      // Moving forward - redo operations
      const stepsForward = targetIndex - currentIndex
      for (let i = 0; i < stepsForward; i++) {
        this.redo()
      }
    }
  }

  /**
   * Get current state position
   */
  getCurrentStateIndex(): number {
    return this.currentStateIndex
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.currentBatch = null
    this.currentStateIndex = -1
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout)
      this.batchTimeout = null
    }
    this.emitHistoryChange()
  }

  /**
   * Generate human-readable action descriptions
   */
  private getActionDescription(entry: HistoryEntry): string {
    const { action, data } = entry

    switch (action) {
      case 'addNode':
        return `Added ${data.data?.title || data.type || 'node'}`

      case 'updateNode':
        return `Updated ${data.old?.data?.title || data.old?.type || 'node'}`

      case 'deleteNode':
        return `Deleted ${data.data?.title || data.type || 'node'}`

      case 'addEdge':
        return `Added connection`

      case 'updateEdge':
        return `Updated connection`

      case 'deleteEdge':
        return `Deleted connection`

      case 'setVariable':
        return `Set variable '${data.name}'`

      case 'deleteVariable':
        return `Deleted variable '${data.name}'`

      default:
        return entry.label || `${action} operation`
    }
  }

  /**
   * Get entries that belong to the same batch
   */
  // private getCurrentBatch(stack: HistoryEntry[]): HistoryEntry[] {
  //   if (stack.length === 0) return []

  //   const lastEntry = stack[stack.length - 1]
  //   if (!lastEntry.batch) return [lastEntry]

  //   // Get all entries with the same batch ID
  //   const batch: HistoryEntry[] = []
  //   for (let i = stack.length - 1; i >= 0; i--) {
  //     if (stack[i].batch === lastEntry.batch) {
  //       batch.push(stack[i])
  //     } else {
  //       break
  //     }
  //   }

  //   return batch
  // }

  /**
   * Revert a history entry (for undo)
   */
  private revertEntry(entry: HistoryEntry): void {
    const store = this.stores.get(entry.store)
    if (!store) {
      console.warn(`Store '${entry.store}' not found for history revert`)
      return
    }

    // Store-specific revert logic
    switch (entry.action) {
      case 'addNode':
        if (store.deleteNode) {
          store.deleteNode(entry.data.id, { skipHistory: true })
        }
        break

      case 'updateNode':
        if (store.updateNode && entry.data.old) {
          store.updateNode(entry.data.id, entry.data.old, { skipHistory: true })
        }
        break

      case 'deleteNode':
        if (store.addNode) {
          store.addNode(entry.data, { skipHistory: true })
        }
        break

      case 'addEdge':
        if (store.deleteEdge) {
          store.deleteEdge(entry.data.id, { skipHistory: true })
        }
        break

      case 'updateEdge':
        if (store.updateEdge && entry.data.old) {
          store.updateEdge(entry.data.id, entry.data.old, { skipHistory: true })
        }
        break

      case 'deleteEdge':
        if (store.addEdge) {
          store.addEdge(entry.data, { skipHistory: true })
        }
        break

      case 'setVariable':
        if (store.setVariable && entry.data.old !== undefined) {
          store.setVariable(entry.data.name, entry.data.old, { skipHistory: true })
        }
        break

      case 'deleteVariable':
        if (store.setVariable) {
          store.setVariable(entry.data.name, entry.data.value, { skipHistory: true })
        }
        break

      default:
        console.warn(`Unknown history action: ${entry.action}`)
    }
  }

  /**
   * Apply a history entry (for redo)
   */
  private applyEntry(entry: HistoryEntry): void {
    const store = this.stores.get(entry.store)
    if (!store) {
      console.warn(`Store '${entry.store}' not found for history apply`)
      return
    }

    // Store-specific apply logic
    switch (entry.action) {
      case 'addNode':
        if (store.addNode) {
          store.addNode(entry.data, { skipHistory: true })
        }
        break

      case 'updateNode':
        if (store.updateNode && entry.data.new) {
          store.updateNode(entry.data.id, entry.data.new, { skipHistory: true })
        }
        break

      case 'deleteNode':
        if (store.deleteNode) {
          store.deleteNode(entry.data.id, { skipHistory: true })
        }
        break

      case 'addEdge':
        if (store.addEdge) {
          store.addEdge(entry.data, { skipHistory: true })
        }
        break

      case 'updateEdge':
        if (store.updateEdge && entry.data.new) {
          store.updateEdge(entry.data.id, entry.data.new, { skipHistory: true })
        }
        break

      case 'deleteEdge':
        if (store.deleteEdge) {
          store.deleteEdge(entry.data.id, { skipHistory: true })
        }
        break

      case 'setVariable':
        if (store.setVariable) {
          store.setVariable(entry.data.name, entry.data.value, { skipHistory: true })
        }
        break

      case 'deleteVariable':
        if (store.deleteVariable) {
          store.deleteVariable(entry.data.name, { skipHistory: true })
        }
        break

      default:
        console.warn(`Unknown history action: ${entry.action}`)
    }
  }

  /**
   * Emit history change event
   */
  private emitHistoryChange(): void {
    storeEventBus.emit({
      type: 'history:changed',
      data: { canUndo: this.canUndo(), canRedo: this.canRedo() },
    })
  }
}

// Global history manager instance
export const historyManager = new HistoryManager()

// Export for testing
export type { HistoryManagerOptions }
