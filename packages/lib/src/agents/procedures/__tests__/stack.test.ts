// packages/lib/src/agents/procedures/__tests__/stack.test.ts

import { describe, expect, it } from 'vitest'
import {
  atDepthCap,
  clear,
  depth,
  emptyStack,
  MAX_DEPTH,
  pop,
  push,
  replaceTop,
  top,
} from '../stack'
import type { ProcedureFrame } from '../types'

const frame = (id: string, pushedBy: ProcedureFrame['pushedBy'] = 'selection'): ProcedureFrame => ({
  procedureId: id,
  procedureVersionId: `${id}-v1`,
  cursor: 'step-0',
  status: 'running',
  history: [],
  pushedBy,
})

describe('stack helpers', () => {
  it('emptyStack / top / depth', () => {
    const s = emptyStack()
    expect(s.frames).toEqual([])
    expect(top(s)).toBeNull()
    expect(depth(s)).toBe(0)
  })

  it('push returns a new object and adds to the top', () => {
    const s0 = emptyStack()
    const s1 = push(s0, frame('a'))
    expect(s1).not.toBe(s0)
    expect(s0.frames).toHaveLength(0) // original untouched
    expect(depth(s1)).toBe(1)
    expect(top(s1)?.procedureId).toBe('a')

    const s2 = push(s1, frame('b', 'digression'))
    expect(top(s2)?.procedureId).toBe('b')
    expect(depth(s2)).toBe(2)
  })

  it('pop returns the new stack and the removed frame', () => {
    const s = push(push(emptyStack(), frame('a')), frame('b'))
    const { stack, popped } = pop(s)
    expect(popped?.procedureId).toBe('b')
    expect(depth(stack)).toBe(1)
    expect(top(stack)?.procedureId).toBe('a')
    expect(s.frames).toHaveLength(2) // original untouched
  })

  it('pop on an empty stack is a no-op', () => {
    const s = emptyStack()
    const { stack, popped } = pop(s)
    expect(popped).toBeNull()
    expect(depth(stack)).toBe(0)
  })

  it('replaceTop swaps the running frame without changing depth', () => {
    const s = push(push(emptyStack(), frame('a')), frame('b'))
    const r = replaceTop(s, frame('c', 'switch'))
    expect(depth(r)).toBe(2)
    expect(top(r)?.procedureId).toBe('c')
    expect(r.frames[0]?.procedureId).toBe('a') // beneath untouched
  })

  it('replaceTop on an empty stack pushes', () => {
    const r = replaceTop(emptyStack(), frame('c'))
    expect(depth(r)).toBe(1)
    expect(top(r)?.procedureId).toBe('c')
  })

  it('clear empties the stack', () => {
    const s = push(push(emptyStack(), frame('a')), frame('b'))
    expect(clear(s).frames).toEqual([])
  })

  it('atDepthCap at MAX_DEPTH', () => {
    let s = emptyStack()
    for (let i = 0; i < MAX_DEPTH; i++) {
      expect(atDepthCap(s)).toBe(false)
      s = push(s, frame(`f${i}`))
    }
    expect(depth(s)).toBe(MAX_DEPTH)
    expect(atDepthCap(s)).toBe(true)
  })
})
