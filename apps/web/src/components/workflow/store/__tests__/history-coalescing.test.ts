// apps/web/src/components/workflow/store/__tests__/history-coalescing.test.ts
//
// The undo stack coalesces by IDENTITY, not by time. Before this, a single 2 s
// trailing debounce sat in front of every producer, which bought three
// separate failures: atomic gestures were 2 s late, a sustained typing session
// recorded nothing at all (the timer never settled), and — the correctness one
// — unrelated edits merged, so one undo reverted two things and the state
// between them was unrecoverable.
//
// These tests pin the replacement.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HistoryManager } from '../history-manager'

function entry(tag: string) {
  return {
    action: 'workflow_event',
    store: 'workflow',
    data: { event: 'NodeChange', nodes: [{ id: tag }], edges: [] },
    label: tag,
  }
}

describe('HistoryManager coalescing', () => {
  let manager: HistoryManager

  beforeEach(() => {
    manager = new HistoryManager()
  })

  it('merges same-key records into one entry holding the LATEST snapshot', () => {
    manager.record(entry('initial'))
    manager.record(entry('a1'), { coalesceKey: 'NodeChange:n1' })
    manager.record(entry('a2'), { coalesceKey: 'NodeChange:n1' })
    manager.record(entry('a3'), { coalesceKey: 'NodeChange:n1' })

    const history = manager.getHistory()
    expect(history).toHaveLength(2)
    expect(history[1].data.nodes[0].id).toBe('a3')
  })

  it('breaks the session on a keyless record — unrelated edits never merge', () => {
    manager.record(entry('initial'))
    manager.record(entry('typing'), { coalesceKey: 'NodeChange:n1' })
    manager.record(entry('delete-other-node'))
    manager.record(entry('typing-again'), { coalesceKey: 'NodeChange:n1' })

    // Four entries, so the typing is still reachable behind the delete. Under
    // the old shared debounce these collapsed into ONE entry labelled for
    // whichever event happened to be last.
    expect(manager.getHistory()).toHaveLength(4)
  })

  it('breaks the session on a different key', () => {
    manager.record(entry('initial'))
    manager.record(entry('node-1'), { coalesceKey: 'NodeChange:n1' })
    manager.record(entry('node-2'), { coalesceKey: 'NodeChange:n2' })

    expect(manager.getHistory()).toHaveLength(3)
  })

  it('never merges a resize into a drag of the same node', () => {
    manager.record(entry('initial'))
    manager.record(entry('resized'), { coalesceKey: 'NodeResize:n1' })
    manager.record(entry('dragged'), { coalesceKey: 'NodeDragStop:n1' })

    expect(manager.getHistory()).toHaveLength(3)
  })

  it('undo after a coalesced session lands before the session began', () => {
    const store = { setNodes: vi.fn(), setEdges: vi.fn() }
    manager.registerStore('workflow', store)

    manager.record(entry('initial'))
    manager.record(entry('a1'), { coalesceKey: 'NodeChange:n1' })
    manager.record(entry('a2'), { coalesceKey: 'NodeChange:n1' })

    manager.undo()

    // Not the intermediate 'a1' — the state from before the typing started.
    expect(store.setNodes).toHaveBeenCalledTimes(1)
    expect(store.setNodes.mock.calls[0][0][0].id).toBe('initial')
  })

  it('records immediately — no timer has to run first', () => {
    vi.useFakeTimers()
    try {
      manager.record(entry('added'))
      // No `vi.advanceTimersByTime` here on purpose.
      expect(manager.getHistory()).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a sustained session still records — there is no timer to keep resetting', () => {
    vi.useFakeTimers()
    try {
      manager.record(entry('initial'))
      // 30 s of continuous editing, one edit per second.
      for (let i = 0; i < 30; i++) {
        manager.record(entry(`edit-${i}`), { coalesceKey: 'NodeChange:n1' })
        vi.advanceTimersByTime(1000)
      }
      // Every edit is on the stack somewhere; the old debounce recorded NOTHING
      // across a burst like this because its trailing timer never settled.
      expect(manager.getHistory().length).toBeGreaterThan(1)
      expect(manager.canUndo()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('HistoryManager coalescing — the window is an idle gap', () => {
  it('holds one entry across a continuous gesture however long it runs', () => {
    vi.useFakeTimers()
    try {
      const manager = new HistoryManager({ coalesceWindow: 500 })
      manager.record(entry('initial'))

      // A resize drag fires per pointer frame for three seconds — six times the
      // window. Anchoring on the FIRST write would fragment this into an entry
      // every 500 ms; anchoring on the last keeps it as one.
      for (let i = 0; i < 180; i++) {
        manager.record(entry(`frame-${i}`), { coalesceKey: 'NodeResize:n1' })
        vi.advanceTimersByTime(16)
      }

      expect(manager.getHistory()).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts a new entry when the same field is edited again after a pause', () => {
    vi.useFakeTimers()
    try {
      const manager = new HistoryManager({ coalesceWindow: 500 })
      manager.record(entry('initial'))
      manager.record(entry('first-edit'), { coalesceKey: 'NodeChange:n1' })

      vi.advanceTimersByTime(10_000)
      manager.record(entry('much-later-edit'), { coalesceKey: 'NodeChange:n1' })

      // Three entries, so 'first-edit' is still reachable. With no window at
      // all these would be one entry and that state would be lost forever.
      expect(manager.getHistory()).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('HistoryManager coalescing — the redo stack', () => {
  it('a coalesced write invalidates the future, exactly like a pushed one', () => {
    const manager = new HistoryManager()
    manager.record(entry('initial'))
    manager.record(entry('typing'), { coalesceKey: 'NodeChange:n1' })
    manager.record(entry('deleted-node-b'))

    manager.undo()
    expect(manager.canRedo()).toBe(true)

    // Same key as the entry now on top, so this coalesces rather than pushes.
    manager.record(entry('typing-more'), { coalesceKey: 'NodeChange:n1' })

    // Redo must be gone. If it survived, redoing would restore the
    // 'deleted-node-b' snapshot on top of a graph that never had it — a state
    // the user was never in.
    expect(manager.canRedo()).toBe(false)
  })
})

describe('HistoryManager.jumpToEntryId', () => {
  it('jumps by id, so a stale index cannot mis-target', () => {
    const store = { setNodes: vi.fn(), setEdges: vi.fn() }
    const manager = new HistoryManager()
    manager.registerStore('workflow', store)

    manager.record(entry('one'))
    manager.record(entry('two'))
    manager.record(entry('three'))

    const target = manager.getNavigationHistory().find((e) => e.label === 'one')
    manager.jumpToEntryId(target!.id)

    expect(store.setNodes.mock.calls.at(-1)?.[0][0].id).toBe('one')
    expect(manager.getCurrentStateIndex()).toBe(0)
  })

  it('ignores an id that is not in the stack', () => {
    const manager = new HistoryManager()
    manager.record(entry('one'))
    manager.record(entry('two'))

    manager.jumpToEntryId('does-not-exist')

    expect(manager.getCurrentStateIndex()).toBe(1)
  })

  it('reaches entries on the redo stack', () => {
    const store = { setNodes: vi.fn(), setEdges: vi.fn() }
    const manager = new HistoryManager()
    manager.registerStore('workflow', store)

    manager.record(entry('one'))
    manager.record(entry('two'))
    manager.undo()

    const future = manager.getNavigationHistory().find((e) => e.label === 'two')
    manager.jumpToEntryId(future!.id)

    expect(store.setNodes.mock.calls.at(-1)?.[0][0].id).toBe('two')
  })
})

describe('HistoryManager batching', () => {
  it('stamps the batch id instead of a null asserted non-null', () => {
    const manager = new HistoryManager()
    manager.startBatch('Layout organization')
    manager.record(entry('laid-out'))
    manager.endBatch()

    expect(manager.getHistory()[0].batch).toEqual(expect.any(String))
  })

  it('leaves batch undefined outside a batch', () => {
    const manager = new HistoryManager()
    manager.record(entry('plain'))

    expect(manager.getHistory()[0].batch).toBeUndefined()
  })

  it('names unlabelled entries after the batch', () => {
    const manager = new HistoryManager()
    manager.startBatch('Layout organization')
    manager.record({ action: 'workflow_event', store: 'workflow', data: {} })
    manager.endBatch()

    expect(manager.getHistory()[0].label).toBe('Layout organization')
  })
})

// The description half. `describe` exists so a label can be derived against the
// state the entry is recorded ON TOP OF — the only way a delete can name what it
// deleted, and the only way a rename can be spotted at all. Which entry counts
// as "on top of" differs between a push and a merge, and getting that wrong is
// what would make a rename label drift with every keystroke.
describe('HistoryManager.record — describe', () => {
  it('passes the current top as the baseline on a push', () => {
    const manager = new HistoryManager()
    const seen: (string | undefined)[] = []

    manager.record(entry('first'))
    manager.record(entry('second'), {
      describe: (baseline) => {
        seen.push(baseline?.label)
        return { label: 'described' }
      },
    })

    expect(seen).toEqual(['first'])
    expect(manager.getHistory()[1].label).toBe('described')
  })

  it('passes the entry BELOW the merge target as the baseline on a merge', () => {
    const manager = new HistoryManager()
    const seen: (string | undefined)[] = []
    const watch = (tag: string) => ({
      coalesceKey: 'NodeChange:n1',
      describe: (baseline: { label?: string } | undefined) => {
        seen.push(baseline?.label)
        return { label: tag }
      },
    })

    manager.record(entry('pre-session'))
    manager.record(entry('typing-1'), watch('described-1'))
    manager.record(entry('typing-2'), watch('described-2'))
    manager.record(entry('typing-3'), watch('described-3'))

    // Every call sees the state the session STARTED from, not the partially
    // typed entry it is about to overwrite. That is what makes a rename label
    // converge on the final title instead of chasing each keystroke.
    expect(seen).toEqual(['pre-session', 'pre-session', 'pre-session'])
    expect(manager.getHistory()).toHaveLength(2)
    expect(manager.getHistory()[1].label).toBe('described-3')
  })

  it('passes undefined on the very first record', () => {
    const manager = new HistoryManager()
    let called = false

    manager.record(entry('first'), {
      describe: (baseline) => {
        called = true
        expect(baseline).toBeUndefined()
        return {}
      },
    })

    expect(called).toBe(true)
  })

  it('replaces subject and verb on a merge, and CLEARS a rename that was undone', () => {
    const manager = new HistoryManager()
    manager.record(entry('pre-session'))

    manager.record(entry('renamed'), {
      coalesceKey: 'NodeChange:n1',
      describe: () => ({
        label: 'A renamed to B',
        verb: 'renamed to',
        subject: { id: 'n1', title: 'A' },
        renamedTo: 'B',
      }),
    })
    expect(manager.getHistory()[1].renamedTo).toBe('B')

    // Typed the original name back: the entry must stop claiming a rename.
    manager.record(entry('renamed-back'), {
      coalesceKey: 'NodeChange:n1',
      describe: () => ({ label: 'A changed', verb: 'changed', subject: { id: 'n1', title: 'A' } }),
    })

    const top = manager.getHistory()[1]
    expect(top.renamedTo).toBeUndefined()
    expect(top.verb).toBe('changed')
    expect(top.label).toBe('A changed')
  })

  it('keeps the plain label when no describe is given', () => {
    const manager = new HistoryManager()
    manager.record(entry('plain'))

    expect(manager.getHistory()[0].label).toBe('plain')
    expect(manager.getHistory()[0].subject).toBeUndefined()
  })
})
