// packages/lib/src/ai/providers/anthropic/__tests__/build-system-blocks.test.ts

import { describe, expect, it } from 'vitest'
import { buildSystemBlocks } from '../anthropic-llm-client'

const SENTINEL = '<!--auxx:cache-break-->'

describe('buildSystemBlocks', () => {
  it('emits one block with one cache marker when no sentinel is present', () => {
    const out = buildSystemBlocks('hello world')
    expect(out).toEqual([
      { type: 'text', text: 'hello world', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('splits on sentinels and marks one cache per sentinel', () => {
    const input = `static-tier\n\n${SENTINEL}\n\norg-tier\n\n${SENTINEL}\n\nturn-tier`
    const out = buildSystemBlocks(input)
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({
      type: 'text',
      text: 'static-tier',
      cache_control: { type: 'ephemeral' },
    })
    expect(out[1]).toEqual({ type: 'text', text: 'org-tier', cache_control: { type: 'ephemeral' } })
    expect(out[2]).toEqual({ type: 'text', text: 'turn-tier', cache_control: undefined })
  })

  it('marks every segment when sentinel count equals segment count (no per-turn tail)', () => {
    const input = `static-tier\n\n${SENTINEL}\n\norg-tier\n\n${SENTINEL}`
    const out = buildSystemBlocks(input)
    expect(out).toHaveLength(2)
    expect(out.map((b) => b.cache_control)).toEqual([{ type: 'ephemeral' }, { type: 'ephemeral' }])
  })

  it('caps cache markers at 4 (Anthropic API limit)', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f'].join(`\n\n${SENTINEL}\n\n`)
    const out = buildSystemBlocks(input)
    const markerCount = out.filter((b) => b.cache_control).length
    expect(markerCount).toBeLessThanOrEqual(4)
  })
})
