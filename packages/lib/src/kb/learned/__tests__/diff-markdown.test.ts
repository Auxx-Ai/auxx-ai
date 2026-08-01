// packages/lib/src/kb/learned/__tests__/diff-markdown.test.ts

import { describe, expect, it } from 'vitest'
import { diffMarkdownLines } from '../diff-markdown'

const text = (lines: string[]) => lines.join('\n')

describe('diffMarkdownLines', () => {
  it('reports no changes for identical bodies', () => {
    const body = text(['# Refunds', 'We refund within 30 days.'])
    const diff = diffMarkdownLines(body, body)
    expect(diff.addedCount).toBe(0)
    expect(diff.removedCount).toBe(0)
    expect(diff.lines.every((l) => l.type === 'same')).toBe(true)
  })

  it('surfaces a dropped human line — the failure the diff exists to catch', () => {
    const before = text([
      '# Refunds',
      'We refund within 30 days.',
      'Dealers get 60 days (agreed with Mark).',
    ])
    const after = text(['# Refunds', 'We refund within 30 days.', 'Shipping is not refundable.'])

    const diff = diffMarkdownLines(before, after)
    expect(diff.removedCount).toBe(1)
    expect(diff.addedCount).toBe(1)
    expect(diff.lines).toContainEqual({
      type: 'remove',
      text: 'Dealers get 60 days (agreed with Mark).',
    })
    expect(diff.lines).toContainEqual({ type: 'add', text: 'Shipping is not refundable.' })
  })

  it('marks a pure append as added with nothing removed', () => {
    const before = text(['# Refunds', 'We refund within 30 days.'])
    const after = text(['# Refunds', 'We refund within 30 days.', 'Dealers get 60 days.'])

    const diff = diffMarkdownLines(before, after)
    expect(diff.removedCount).toBe(0)
    expect(diff.addedCount).toBe(1)
  })

  it('ignores blank-line churn', () => {
    const diff = diffMarkdownLines('# Refunds\n\nWe refund.', '# Refunds\nWe refund.\n\n\n')
    expect(diff.addedCount).toBe(0)
    expect(diff.removedCount).toBe(0)
  })

  it('treats an empty original as an all-added article', () => {
    const diff = diffMarkdownLines('', text(['# New topic', 'Body.']))
    expect(diff.removedCount).toBe(0)
    expect(diff.addedCount).toBe(2)
  })

  it('keeps a rewritten line as one removal plus one addition', () => {
    const diff = diffMarkdownLines('We refund within 30 days.', 'We refund within 45 days.')
    expect(diff.removedCount).toBe(1)
    expect(diff.addedCount).toBe(1)
  })
})
