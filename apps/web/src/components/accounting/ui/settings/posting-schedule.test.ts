// apps/web/src/components/accounting/ui/settings/posting-schedule.test.ts
//
// Brief 28 §3.2: "Next" for a schedule trigger is computed from the policy's
// cron; for every other trigger kind it is a sentence, so the helper answers
// null and the page prints the sentence.

import { POSTING_POLICY, type PostingTrigger } from '@auxx/lib/accounting/ledger/client'
import { describe, expect, it } from 'vitest'
import { describeNextFire, nextScheduledFire } from './posting-schedule'

const PAYOUT: PostingTrigger = {
  kind: 'schedule',
  cron: '30 4 * * *',
  tz: 'UTC',
  description: 'Daily at 04:30 UTC',
}

describe('nextScheduledFire', () => {
  it('finds the next fire later the same UTC day', () => {
    const next = nextScheduledFire(PAYOUT, new Date('2026-09-14T03:00:00.000Z'))
    expect(next?.toISOString()).toBe('2026-09-14T04:30:00.000Z')
  })

  it('rolls to the next day once today has fired', () => {
    const next = nextScheduledFire(PAYOUT, new Date('2026-09-14T05:00:00.000Z'))
    expect(next?.toISOString()).toBe('2026-09-15T04:30:00.000Z')
  })

  it('is strictly after now, so a run at the exact minute reports tomorrow', () => {
    const next = nextScheduledFire(PAYOUT, new Date('2026-09-14T04:30:00.000Z'))
    expect(next?.toISOString()).toBe('2026-09-15T04:30:00.000Z')
  })

  it('answers null for every trigger kind that is not a schedule', () => {
    const now = new Date('2026-09-14T03:00:00.000Z')
    expect(nextScheduledFire({ kind: 'event', on: 'Send on an invoice' }, now)).toBeNull()
    expect(nextScheduledFire({ kind: 'console', where: 'The close console' }, now)).toBeNull()
    expect(nextScheduledFire({ kind: 'inbound', from: 'The connected system' }, now)).toBeNull()
    expect(nextScheduledFire({ kind: 'never' }, now)).toBeNull()
  })

  it('parses every schedule the policy declares', () => {
    // A cron the policy declares but croner cannot read would throw at render
    // time on the Posting page. Walk the real declarations.
    const now = new Date('2026-09-14T00:00:00.000Z')
    for (const policy of Object.values(POSTING_POLICY)) {
      if (policy.trigger.kind !== 'schedule') continue
      const next = nextScheduledFire(policy.trigger, now)
      expect(next, policy.type).not.toBeNull()
      expect(next!.getTime()).toBeGreaterThan(now.getTime())
    }
  })
})

describe('describeNextFire', () => {
  it('says today, tomorrow, or names the day, in UTC', () => {
    const now = new Date('2026-09-14T03:00:00.000Z')
    expect(describeNextFire(new Date('2026-09-14T04:30:00.000Z'), now)).toBe('today at 04:30 UTC')
    expect(describeNextFire(new Date('2026-09-15T04:30:00.000Z'), now)).toBe(
      'tomorrow at 04:30 UTC'
    )
    expect(describeNextFire(new Date('2026-09-16T03:45:00.000Z'), now)).toBe(
      'on Sep 16 at 03:45 UTC'
    )
  })

  it('takes the day boundary in UTC, not in the browser zone', () => {
    // 23:30 UTC on the 14th to 04:30 UTC on the 15th is "tomorrow" in UTC even
    // though a UTC-8 browser would call both the 14th.
    const now = new Date('2026-09-14T23:30:00.000Z')
    expect(describeNextFire(new Date('2026-09-15T04:30:00.000Z'), now)).toBe(
      'tomorrow at 04:30 UTC'
    )
  })
})
