// packages/lib/src/ai/agent-framework/__tests__/preview-args.test.ts

import { describe, expect, it } from 'vitest'
import { previewArgs, previewValue } from '../utils'

/**
 * `previewArgs` is the structured sibling of `previewValue`. The log sink can
 * filter on `args.<field>` only if the emitted value is a real object, so the
 * bounds (leaf strings ~200 chars, arrays ~20 items, ~600 chars total) have to
 * be applied to the leaves rather than to a serialized whole.
 *
 * See plans/search/2026-07-31-retrieval-execution-sequence.md §1.0 gap 1.
 */
describe('previewArgs', () => {
  it('returns an object so args.<field> stays queryable', () => {
    const out = previewArgs({ assigneeId: 'user:abc', limit: 25, unread: true })

    expect(out).toEqual({ assigneeId: 'user:abc', limit: 25, unread: true })
    // The old behavior — a JSON-encoded string — is what made it unfilterable.
    expect(typeof previewValue({ assigneeId: 'user:abc' })).toBe('string')
  })

  it('preserves nested object structure', () => {
    const out = previewArgs({ filter: { status: ['open', 'pending'], sender: 'a@b.com' } })

    expect(out).toEqual({ filter: { status: ['open', 'pending'], sender: 'a@b.com' } })
  })

  it('clips leaf strings at 200 chars', () => {
    const out = previewArgs({ query: 'x'.repeat(500) })

    expect(typeof out.query).toBe('string')
    expect((out.query as string).length).toBeLessThanOrEqual(201)
    expect(out.query).toMatch(/^x{200}…$/)
  })

  it('caps arrays at 20 items and marks the remainder', () => {
    const out = previewArgs({ tagIds: Array.from({ length: 35 }, (_, i) => i) })
    const tagIds = out.tagIds as unknown[]

    expect(tagIds).toHaveLength(21)
    expect(tagIds[20]).toBe('…(+15)')
  })

  it('spends a shared total budget across leaves', () => {
    const out = previewArgs({
      a: 'a'.repeat(200),
      b: 'b'.repeat(200),
      c: 'c'.repeat(200),
      d: 'd'.repeat(200),
    })

    expect(JSON.stringify(out).length).toBeLessThan(900)
    // Later keys are still present (as truncation markers) — the field names
    // survive even when their values don't.
    expect(Object.keys(out).length).toBeGreaterThan(1)
  })

  it('marks cycles instead of throwing', () => {
    const cyclic: Record<string, unknown> = { name: 'root' }
    cyclic.self = cyclic

    expect(previewArgs(cyclic)).toEqual({ name: 'root', self: '[Circular]' })
  })

  it('collapses deep nesting to a marker', () => {
    let deep: Record<string, unknown> = { leaf: true }
    for (let i = 0; i < 10; i++) deep = { nested: deep }

    expect(JSON.stringify(previewArgs(deep))).toContain('[…]')
  })

  it('returns {} for undefined args', () => {
    expect(previewArgs(undefined)).toEqual({})
  })
})
