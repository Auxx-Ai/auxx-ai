// packages/lib/src/participants/search/merge-arms.test.ts
//
// The union's actual decisions. Everything either side of this is SQL, verified
// against a real database by `scripts/verify-recipient-search.ts`; this is the
// part with branches worth pinning.

import { describe, expect, it } from 'vitest'
import type { RecipientCandidate } from './search-recipients'
import { mergeArms } from './search-recipients'

const participant = (
  identifier: string,
  contactId: string | null = null,
  score = 1
): RecipientCandidate => ({
  identifier,
  identifierType: 'EMAIL',
  displayName: identifier,
  contactId,
  source: 'participant',
  score,
})

const contact = (
  identifier: string,
  contactId: string | null = 'c1',
  score = 1
): RecipientCandidate => ({
  identifier,
  identifierType: 'EMAIL',
  displayName: identifier,
  contactId,
  source: 'contact',
  score,
})

describe('mergeArms — suppression by contact id', () => {
  it('drops a contact row whose contact already appears as a participant', () => {
    // The participant row is strictly better: same person, plus a recency signal.
    const merged = mergeArms([participant('a@x.com', 'c1')], [contact('b@x.com', 'c1')], 20)
    expect(merged.map((r) => r.identifier)).toEqual(['a@x.com'])
  })

  it('keeps a contact row for a DIFFERENT contact', () => {
    const merged = mergeArms([participant('a@x.com', 'c1')], [contact('b@x.com', 'c2')], 20)
    expect(merged.map((r) => r.identifier)).toEqual(['a@x.com', 'b@x.com'])
  })

  it('does not suppress on a null contact id — null is not a key', () => {
    // Two unlinked rows are not evidence of the same person. Treating null as a
    // match would collapse every unlinked contact into the first one.
    const merged = mergeArms([participant('a@x.com', null)], [contact('b@x.com', null)], 20)
    expect(merged).toHaveLength(2)
  })
})

describe('mergeArms — dedupe by identifier', () => {
  it('drops a contact row with the same address as a participant, without a shared id', () => {
    // The `Participant.entityInstanceId` link is nullable and often absent, so the
    // contact-id rule alone would let the same address appear twice.
    const merged = mergeArms([participant('a@x.com', null)], [contact('a@x.com', 'c1')], 20)
    expect(merged.map((r) => r.identifier)).toEqual(['a@x.com'])
    expect(merged[0]?.source).toBe('participant')
  })

  it('is case-insensitive', () => {
    const merged = mergeArms([participant('Jane@Corp.com')], [contact('jane@corp.com', 'c9')], 20)
    expect(merged).toHaveLength(1)
  })

  it('dedupes contacts against each other too', () => {
    const merged = mergeArms([], [contact('a@x.com', 'c1'), contact('a@x.com', 'c2')], 20)
    expect(merged).toHaveLength(1)
  })
})

describe('mergeArms — ordering', () => {
  it('🔴 keeps participants ahead of contacts even when a contact scores higher', () => {
    // The scores are on different scales and nothing calibrates them, so sorting
    // the merged list would be a guess presented as a ranking.
    const merged = mergeArms([participant('p@x.com', null, 0.2)], [contact('c@x.com', 'c1', 9)], 20)
    expect(merged.map((r) => r.source)).toEqual(['participant', 'contact'])
  })

  it('preserves each arm’s own order', () => {
    const merged = mergeArms(
      [participant('p1@x.com', null, 3), participant('p2@x.com', null, 2)],
      [contact('c1@x.com', 'a'), contact('c2@x.com', 'b')],
      20
    )
    expect(merged.map((r) => r.identifier)).toEqual([
      'p1@x.com',
      'p2@x.com',
      'c1@x.com',
      'c2@x.com',
    ])
  })
})

describe('mergeArms — limit', () => {
  it('never exceeds the limit', () => {
    const participants = Array.from({ length: 30 }, (_, i) => participant(`p${i}@x.com`))
    expect(mergeArms(participants, [], 20)).toHaveLength(20)
  })

  it('truncates participants before contacts are considered', () => {
    const participants = Array.from({ length: 25 }, (_, i) => participant(`p${i}@x.com`))
    const merged = mergeArms(participants, [contact('c@x.com', 'c1')], 20)
    expect(merged).toHaveLength(20)
    expect(merged.every((r) => r.source === 'participant')).toBe(true)
  })

  it('fills the remainder with contacts when participants are short', () => {
    const merged = mergeArms(
      [participant('p@x.com')],
      Array.from({ length: 30 }, (_, i) => contact(`c${i}@x.com`, `id${i}`)),
      5
    )
    expect(merged).toHaveLength(5)
    expect(merged.filter((r) => r.source === 'contact')).toHaveLength(4)
  })

  it('handles both arms empty', () => {
    expect(mergeArms([], [], 20)).toEqual([])
  })
})
