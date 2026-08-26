// apps/web/src/components/workflow/store/history-manager.ts

import { stableStringify } from '@auxx/utils/json'
import { v4 as uuidv4 } from 'uuid'
import { storeEventBus } from './event-bus'
import type { HistoryDescription, HistoryEntry } from './types'

interface HistoryManagerOptions {
  maxHistorySize?: number
  batchingWindow?: number
  coalesceWindow?: number
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
 * Options for {@link HistoryManager.record}.
 */
export interface RecordOptions {
  /**
   * Identity of the logical edit this record belongs to, e.g.
   * `NodeChange:<nodeId>`. A record whose key matches the top of the stack
   * **overwrites** it instead of pushing, which is how a burst of keystrokes in
   * one panel becomes one undo step rather than one per character.
   *
   * Omit it for anything that happens once per gesture (add, delete, paste,
   * drag-stop, layout). A keyless record can never merge into a keyed session,
   * which is what stops two unrelated edits collapsing into a single entry.
   */
  coalesceKey?: string

  /**
   * Describe the entry against the state it is being recorded ON TOP OF.
   *
   * On a push, `baseline` is the current top of the stack. On a MERGE it is the
   * entry *below* the one being overwritten — the state the coalescing session
   * began from — and the result replaces the merged entry's description. Both
   * halves matter:
   *
   * - The baseline is how a description can name something the new graph no
   *   longer has, which is the only way a delete knows what it deleted.
   * - Re-describing on every merge is how a rename converges. Typing `O`,
   *   `Ou`, `Out`, `Output` re-diffs each time against the PRE-SESSION title,
   *   so the entry settles on "Node 1 renamed to Output" instead of freezing at
   *   the first keystroke or drifting to "Out renamed to Output".
   */
  describe?: (baseline: HistoryEntry | undefined) => HistoryDescription
}

/**
 * How long a coalescing session stays open, measured from its LAST write.
 *
 * This is an idle gap, not a maximum duration — the anchor moves forward on
 * every merge. Both properties depend on that: a continuous gesture (resize
 * fires per pointer frame) stays one entry however long it runs, while a field
 * edited now and edited again after a pause becomes two entries, so the
 * intermediate state is still reachable.
 */
const DEFAULT_COALESCE_WINDOW = 500

/**
 * Centralized history manager for undo/redo functionality across all stores
 */
export class HistoryManager {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private stores = new Map<string, StoreInstance>()
  private currentBatch: { id: string; label: string } | null = null
  private batchTimeout: NodeJS.Timeout | null = null
  private currentStateIndex: number = -1 // Current position in combined history

  private maxHistorySize: number
  private batchingWindow: number
  private coalesceWindow: number

  constructor(options: HistoryManagerOptions = {}) {
    this.maxHistorySize = options.maxHistorySize || 50
    this.batchingWindow = options.batchingWindow || 300
    this.coalesceWindow = options.coalesceWindow ?? DEFAULT_COALESCE_WINDOW
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
   * Record a history entry.
   *
   * Writes happen on the edit — there is no debounce in front of this. Volume
   * is handled by coalescing on {@link RecordOptions.coalesceKey} instead of by
   * waiting, so `canUndo()`, the undo/redo buttons and the history popover are
   * always current, and unrelated edits can never merge into one entry.
   */
  record(entry: Omit<HistoryEntry, 'id' | 'timestamp'>, options: RecordOptions = {}): void {
    const { coalesceKey, describe } = options
    const top = this.undoStack[this.undoStack.length - 1]
    const now = Date.now()

    const willCoalesce =
      !!coalesceKey && top?.coalesceKey === coalesceKey && now - top.timestamp < this.coalesceWindow

    // An entry identical to the one on top of the stack is never worth
    // recording: undoing onto it is a no-op, and it costs one of the
    // `maxHistorySize` slots that a real edit needs.
    //
    // This is belt-and-braces behind the callers, who should not be recording
    // no-op edits in the first place — but the failure mode when one does is
    // severe and silent. `coalesceWindow` is 500 ms, tuned for keystroke
    // bursts, so a repeating writer even slightly SLOWER than that misses the
    // merge entirely: it pushes a fresh entry every time, clears the redo stack
    // on each push, and once 50 entries overflow it evicts the user's real
    // edits off the front. An app panel's iframe echo did exactly that at
    // ~1 Hz — see `plans/kopilot/workflow/29-app-panel-write-loop.md` §3.1.
    //
    // Do NOT "fix" that class of bug by widening `coalesceWindow`: that would
    // start merging genuinely separate user edits into one undo step, which is
    // the failure moving history off a time debounce was meant to end.
    if (top && !willCoalesce && stableStringify(entry.data) === stableStringify(top.data)) {
      return
    }

    // The state this entry is recorded on top of. When merging, the entry being
    // overwritten is NOT that state — the one below it is.
    const baseline = this.undoStack[this.undoStack.length - (willCoalesce ? 2 : 1)]
    const described = describe?.(baseline)

    if (willCoalesce) {
      // The same logical edit continuing: replace the snapshot in place. Undo
      // still lands on the state from before the session began, because that
      // one lives in the PREVIOUS entry.
      top.data = entry.data
      top.label = described?.label ?? entry.label ?? top.label
      top.subject = described?.subject ?? top.subject
      top.verb = described?.verb ?? top.verb
      // Assigned unconditionally: a session that renames and then renames BACK
      // must drop the claim, not keep the stale one.
      top.renamedTo = described?.renamedTo
      top.timestamp = now

      // A coalesced write is a new action just as much as a pushed one, so it
      // has to invalidate the future the same way. Without this, an undo
      // followed by a same-key edit leaves a redo stack whose entries describe
      // a graph that no longer exists — redo would then restore a state the
      // user was never in.
      this.redoStack = []
      this.currentStateIndex = this.undoStack.length - 1

      this.emitHistoryChange()
      return
    }

    const historyEntry: HistoryEntry = {
      ...entry,
      ...described,
      id: uuidv4(),
      timestamp: now,
      label: described?.label ?? entry.label ?? this.currentBatch?.label,
      batch: this.currentBatch?.id,
      coalesceKey,
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
   * Start a batch of operations. `label` names the entries recorded inside it
   * that do not carry a label of their own.
   */
  startBatch(label: string): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout)
      this.batchTimeout = null
    }
    this.currentBatch = { id: uuidv4(), label }
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
      actionDescription: entry.label || `${entry.action} operation`,
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
   * Jump to the state a specific entry describes.
   *
   * The id is the address, not the index: a caller holding a rendered list of
   * entries cannot compute a correct index once the stack has moved underneath
   * it, and the list moves whenever an edit lands.
   */
  jumpToEntryId(id: string): void {
    const allEntries = [...this.undoStack, ...this.redoStack.slice().reverse()]
    const targetIndex = allEntries.findIndex((entry) => entry.id === id)
    if (targetIndex === -1) return
    this.jumpToState(targetIndex)
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
