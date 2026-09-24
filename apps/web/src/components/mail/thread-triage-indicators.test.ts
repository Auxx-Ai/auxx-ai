// apps/web/src/components/mail/thread-triage-indicators.test.ts

import { describe, expect, it } from 'vitest'
import { getTriageIndicators } from './thread-triage-indicators'

const empty = { priority: null, needsReply: null, sentiment: null, spamScore: null }

describe('getTriageIndicators', () => {
  it('renders nothing for an unclassified thread', () => {
    expect(getTriageIndicators(empty, 'all')).toEqual([])
    expect(getTriageIndicators({}, 'all')).toEqual([])
  })

  it('shows every set value in all mode, in display order', () => {
    const out = getTriageIndicators(
      { priority: 'LOW', needsReply: false, sentiment: 'NEUTRAL', spamScore: 0.1 },
      'all'
    )
    expect(out.map((i) => i.key)).toEqual(['priority', 'needsReply', 'sentiment', 'spam'])
    expect(out.map((i) => i.label)).toEqual([
      'Low priority',
      'No reply needed',
      'Neutral sentiment',
      'Unlikely spam (10%)',
    ])
    expect(
      getTriageIndicators(
        { priority: 'LOW', needsReply: false, sentiment: 'NEUTRAL', spamScore: 0.1 },
        'notable'
      )
    ).toEqual([])
  })

  it('keeps only actionable values in notable mode', () => {
    const out = getTriageIndicators(
      { priority: 'URGENT', needsReply: true, sentiment: 'NEGATIVE', spamScore: 0.7 },
      'notable'
    )
    expect(out.map((i) => i.label)).toEqual([
      'Urgent priority',
      'Needs a reply',
      'Negative sentiment',
      'Likely spam (70%)',
    ])
  })

  it('treats HIGH as notable and MEDIUM / POSITIVE / sub-threshold spam as not', () => {
    const out = getTriageIndicators(
      { priority: 'HIGH', needsReply: null, sentiment: 'POSITIVE', spamScore: 0.69 },
      'notable'
    )
    expect(out.map((i) => i.key)).toEqual(['priority'])
    expect(getTriageIndicators({ ...empty, priority: 'MEDIUM' }, 'notable')).toEqual([])
  })
})
