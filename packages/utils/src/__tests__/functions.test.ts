// packages/utils/src/__tests__/functions.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debounce } from '../functions'

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('defers until the wait has elapsed since the last call', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1500)

    debounced()
    vi.advanceTimersByTime(1400)
    debounced()
    vi.advanceTimersByTime(1400)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('passes the most recent arguments', () => {
    const fn = vi.fn()
    const debounced = debounce(fn as (...args: [string]) => void, 1000)

    debounced('first')
    debounced('second')
    vi.advanceTimersByTime(1000)

    expect(fn).toHaveBeenCalledExactlyOnceWith('second')
  })

  it('without maxWait, a continuous burst never fires', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1500)

    for (let i = 0; i < 20; i++) {
      debounced()
      vi.advanceTimersByTime(1000)
    }

    expect(fn).not.toHaveBeenCalled()
  })

  it('with maxWait, a continuous burst fires on the cadence', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1500, { maxWait: 10_000 })

    for (let i = 0; i < 20; i++) {
      debounced()
      vi.advanceTimersByTime(1000)
    }

    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('restarts the maxWait clock after an invocation', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1500, { maxWait: 5000 })

    debounced()
    vi.advanceTimersByTime(1500)
    expect(fn).toHaveBeenCalledTimes(1)

    debounced()
    vi.advanceTimersByTime(1500)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('cancel drops the pending call', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1000, { maxWait: 5000 })

    debounced()
    debounced.cancel()
    vi.advanceTimersByTime(10_000)

    expect(fn).not.toHaveBeenCalled()
  })

  it('flush runs a pending call immediately and only once', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1000)

    debounced()
    debounced.flush()
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(10_000)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('flush is a no-op when nothing is pending', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1000)

    debounced.flush()
    expect(fn).not.toHaveBeenCalled()
  })
})
