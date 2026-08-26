// apps/web/src/components/workflow/store/__tests__/history-manager-noop.test.ts
//
// The app-panel write loop (plans/kopilot/workflow/29-app-panel-write-loop.md)
// landed a no-op `NodeChange` on the undo stack roughly once a second. The
// coalesce key looked like it should have absorbed that, and did not: the
// window is 500 ms and the loop's measured period was 993 ms median / 872 ms
// minimum, so EVERY tick missed the merge and took the push branch — a fresh
// entry each time, the redo stack wiped on each one, and the user's real edits
// evicted off the front once 50 entries overflowed.
//
// So these tests are deliberately written at the loop's own cadence. A version
// spaced under 500 ms passes against the unfixed code and proves nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HistoryManager } from '../history-manager'

/** A snapshot whose content is a function of `tag` alone. */
function entry(tag: string) {
  return {
    action: 'workflow_event',
    store: 'workflow',
    data: { event: 'NodeChange', nodes: [{ id: 'n1', data: { value: tag } }], edges: [] },
    label: tag,
  }
}

/** Longer than the 500 ms coalesce window — the gap the real loop ran at. */
const OUTSIDE_COALESCE_WINDOW = 1000

describe('HistoryManager — no-op entries', () => {
  let manager: HistoryManager

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new HistoryManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores a record identical to the top of the stack, at the loop cadence', () => {
    manager.record(entry('initial'))
    manager.record(entry('edited'), { coalesceKey: 'NodeChange:n1' })
    expect(manager.getHistory()).toHaveLength(2)

    for (let tick = 0; tick < 5; tick++) {
      vi.advanceTimersByTime(OUTSIDE_COALESCE_WINDOW)
      manager.record(entry('edited'), { coalesceKey: 'NodeChange:n1' })
    }

    expect(manager.getHistory()).toHaveLength(2)
    expect(manager.getHistory()[1].data.nodes[0].data.value).toBe('edited')
  })

  it('leaves the redo stack intact across repeated no-op records', () => {
    manager.record(entry('one'))
    manager.record(entry('two'))
    manager.undo()
    expect(manager.canRedo()).toBe(true)

    // The loop ticking while the user has something to redo.
    for (let tick = 0; tick < 3; tick++) {
      vi.advanceTimersByTime(OUTSIDE_COALESCE_WINDOW)
      manager.record(entry('one'), { coalesceKey: 'NodeChange:n1' })
    }

    expect(manager.canRedo()).toBe(true)
  })

  it('never evicts real edits — a no-op writer cannot overflow the stack', () => {
    const small = new HistoryManager({ maxHistorySize: 5 })
    small.record(entry('real-edit'))
    small.record(entry('current'))

    for (let tick = 0; tick < 40; tick++) {
      vi.advanceTimersByTime(OUTSIDE_COALESCE_WINDOW)
      small.record(entry('current'), { coalesceKey: 'NodeChange:n1' })
    }

    const history = small.getHistory()
    expect(history).toHaveLength(2)
    expect(history[0].data.nodes[0].data.value).toBe('real-edit')
  })

  it('still records a genuinely different snapshot at the same cadence', () => {
    manager.record(entry('initial'))
    vi.advanceTimersByTime(OUTSIDE_COALESCE_WINDOW)
    manager.record(entry('a'), { coalesceKey: 'NodeChange:n1' })
    vi.advanceTimersByTime(OUTSIDE_COALESCE_WINDOW)
    manager.record(entry('b'), { coalesceKey: 'NodeChange:n1' })

    const history = manager.getHistory()
    expect(history).toHaveLength(3)
    expect(history[2].data.nodes[0].data.value).toBe('b')
  })

  it('still coalesces a fast burst of real changes into one entry', () => {
    manager.record(entry('initial'))
    manager.record(entry('typed-h'), { coalesceKey: 'NodeChange:n1' })
    vi.advanceTimersByTime(100)
    manager.record(entry('typed-he'), { coalesceKey: 'NodeChange:n1' })
    vi.advanceTimersByTime(100)
    manager.record(entry('typed-hel'), { coalesceKey: 'NodeChange:n1' })

    const history = manager.getHistory()
    expect(history).toHaveLength(2)
    expect(history[1].data.nodes[0].data.value).toBe('typed-hel')
  })
})
