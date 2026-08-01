// packages/lib/src/jobs/approvals/__tests__/learned-extraction-gates.test.ts

import { describe, expect, it } from 'vitest'
import { hasHumanOutbound, learnedExtractionSkipReason } from '../learned-extraction-gates'

function thread(
  overrides: Partial<Parameters<typeof learnedExtractionSkipReason>[0]> = {}
): Parameters<typeof learnedExtractionSkipReason>[0] {
  return {
    status: 'ARCHIVED',
    mergedIntoThreadId: null,
    messageCount: 4,
    learnedExtractedAt: null,
    lastMessageAt: new Date('2026-07-01T10:00:00Z'),
    ...overrides,
  }
}

describe('learnedExtractionSkipReason', () => {
  it('passes a resolved, never-extracted thread with conversation', () => {
    expect(learnedExtractionSkipReason(thread())).toBeUndefined()
  })

  it('skips threads that are not ARCHIVED', () => {
    expect(learnedExtractionSkipReason(thread({ status: 'OPEN' }))).toBe('not_resolved')
    expect(learnedExtractionSkipReason(thread({ status: 'SPAM' }))).toBe('not_resolved')
    expect(learnedExtractionSkipReason(thread({ status: 'IGNORED' }))).toBe('not_resolved')
  })

  it('skips merged threads', () => {
    expect(learnedExtractionSkipReason(thread({ mergedIntoThreadId: 'other' }))).toBe('merged')
  })

  it('skips threads with fewer than 2 messages', () => {
    expect(learnedExtractionSkipReason(thread({ messageCount: 1 }))).toBe('too_few_messages')
    expect(learnedExtractionSkipReason(thread({ messageCount: 0 }))).toBe('too_few_messages')
  })

  it('skips a reopen→re-close with no new messages since extraction', () => {
    expect(
      learnedExtractionSkipReason(
        thread({
          learnedExtractedAt: new Date('2026-07-02T10:00:00Z'),
          lastMessageAt: new Date('2026-07-01T10:00:00Z'),
        })
      )
    ).toBe('already_extracted')
  })

  it('re-extracts when new messages accrued after extraction', () => {
    expect(
      learnedExtractionSkipReason(
        thread({
          learnedExtractedAt: new Date('2026-07-01T10:00:00Z'),
          lastMessageAt: new Date('2026-07-02T10:00:00Z'),
        })
      )
    ).toBeUndefined()
  })

  it('skips extracted threads with no lastMessageAt at all', () => {
    expect(
      learnedExtractionSkipReason(
        thread({
          learnedExtractedAt: new Date('2026-07-01T10:00:00Z'),
          lastMessageAt: null,
        })
      )
    ).toBe('already_extracted')
  })
})

describe('hasHumanOutbound', () => {
  it('is false when nobody replied', () => {
    expect(hasHumanOutbound([])).toBe(false)
  })

  it('is false when every outbound message came from an agent', () => {
    expect(hasHumanOutbound([{ authorUserType: 'AGENT' }, { authorUserType: 'AGENT' }])).toBe(false)
  })

  it('is true when a human replied alongside the agent', () => {
    expect(hasHumanOutbound([{ authorUserType: 'AGENT' }, { authorUserType: 'USER' }])).toBe(true)
  })

  it('treats a provider-synced send (null author) as human', () => {
    expect(hasHumanOutbound([{ authorUserType: null }])).toBe(true)
  })
})
