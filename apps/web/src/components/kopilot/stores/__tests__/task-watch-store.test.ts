// apps/web/src/components/kopilot/stores/__tests__/task-watch-store.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { taskWatchKey, useTaskWatchStore } from '../task-watch-store'

const WATCH = { sessionId: 's1', kind: 'eval-suite', ref: 'esr_1' }
const KEY = taskWatchKey(WATCH)

beforeEach(() => {
  useTaskWatchStore.setState({ watches: {} })
})

describe('task-watch store', () => {
  it('registers a watch once — re-registration never resets state', () => {
    const store = useTaskWatchStore.getState()
    store.registerWatch(WATCH)
    expect(useTaskWatchStore.getState().watches[KEY]?.state).toBe('watching')

    store.markTerminal(KEY)
    store.registerWatch(WATCH)
    expect(useTaskWatchStore.getState().watches[KEY]?.state).toBe('terminal-queued')

    store.markDone(KEY)
    store.registerWatch(WATCH)
    // A done watch stays done — this is what prevents notify loops after the
    // replay scan re-sees the same tool output.
    expect(useTaskWatchStore.getState().watches[KEY]?.state).toBe('done')
  })

  it('markTerminal transitions only from watching', () => {
    const store = useTaskWatchStore.getState()
    store.registerWatch(WATCH)
    store.markDone(KEY)
    store.markTerminal(KEY)
    expect(useTaskWatchStore.getState().watches[KEY]?.state).toBe('done')
  })

  it('resumeWatching reopens a queued watch (422 race) but never a done one', () => {
    const store = useTaskWatchStore.getState()
    store.registerWatch(WATCH)
    store.markTerminal(KEY)
    store.resumeWatching(KEY)
    expect(useTaskWatchStore.getState().watches[KEY]?.state).toBe('watching')

    store.markTerminal(KEY)
    store.markDone(KEY)
    store.resumeWatching(KEY)
    expect(useTaskWatchStore.getState().watches[KEY]?.state).toBe('done')
  })

  it('keys are scoped by session, kind, and ref', () => {
    expect(taskWatchKey(WATCH)).toBe('s1:eval-suite:esr_1')
    expect(taskWatchKey({ ...WATCH, sessionId: 's2' })).not.toBe(KEY)
  })
})
