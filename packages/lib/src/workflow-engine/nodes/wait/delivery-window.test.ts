// packages/lib/src/workflow-engine/nodes/wait/delivery-window.test.ts

import { describe, expect, it } from 'vitest'
import { type DeliveryWindow, snapToDeliveryWindow } from './delivery-window'

// Calendar anchors below are shared with `recurrence/expand.test.ts`'s DST suite:
// 2026 spring-forward: America/New_York jumps 2:00 AM EST -> 3:00 AM EDT on
// Sunday 2026-03-08 (so 2026-03-05..03-10 = Thu, Fri, Sat, Sun, Mon, Tue).
// 2026 fall-back: America/New_York falls 2:00 AM EDT -> 1:00 AM EST on
// Sunday 2026-11-01 (so 2026-10-29..11-03 = Thu, Fri, Sat, Sun, Mon, Tue).

const businessWindow: DeliveryWindow = {
  startTime: '09:00',
  endTime: '17:00',
  timezone: 'America/New_York',
  businessDaysOnly: true,
}

describe('snapToDeliveryWindow — before/inside/after (no weekend involved)', () => {
  it('snaps a pre-window instant forward to the same day at startTime', () => {
    // Tue 2026-03-10, post-transition (EDT, UTC-4): 09:00 UTC -> 05:00 local, before 09:00.
    const result = snapToDeliveryWindow(new Date('2026-03-10T09:00:00Z'), businessWindow)
    expect(result.toISOString()).toBe('2026-03-10T13:00:00.000Z')
  })

  it('leaves an in-window instant unchanged', () => {
    // Tue 2026-03-10 (EDT, UTC-4): 15:00 UTC -> 11:00 local, inside [09:00, 17:00].
    const input = new Date('2026-03-10T15:00:00Z')
    const result = snapToDeliveryWindow(input, businessWindow)
    expect(result.toISOString()).toBe(input.toISOString())
  })

  it('treats the end boundary as inclusive', () => {
    // Tue 2026-03-10 (EDT, UTC-4): 21:00 UTC -> 17:00 local, exactly at endTime.
    const input = new Date('2026-03-10T21:00:00Z')
    const result = snapToDeliveryWindow(input, businessWindow)
    expect(result.toISOString()).toBe(input.toISOString())
  })

  it('snaps a post-window instant forward to the next day at startTime', () => {
    // Tue 2026-03-10 (EDT, UTC-4): 22:00 UTC -> 18:00 local, after 17:00.
    // Next day, Wed 2026-03-11, is a weekday — no weekend roll needed.
    const result = snapToDeliveryWindow(new Date('2026-03-10T22:00:00Z'), businessWindow)
    expect(result.toISOString()).toBe('2026-03-11T13:00:00.000Z')
  })
})

describe('snapToDeliveryWindow — weekend skip (businessDaysOnly)', () => {
  it('rolls a Saturday-before-window instant to the following Monday at startTime', () => {
    // Sat 2026-03-07, pre-transition (EST, UTC-5): 09:00 UTC -> 04:00 local, before window.
    // Same-day snap lands on Saturday 09:00 EST (14:00 UTC) -> weekend -> roll to
    // Monday 2026-03-09, which is POST-transition (EDT, UTC-4): 09:00 local = 13:00 UTC.
    const result = snapToDeliveryWindow(new Date('2026-03-07T09:00:00Z'), businessWindow)
    expect(result.toISOString()).toBe('2026-03-09T13:00:00.000Z')
  })

  it('rolls a Friday-evening (after-window) instant to the following Monday at startTime', () => {
    // Fri 2026-03-06, pre-transition (EST, UTC-5): 23:00 UTC -> 18:00 local, after window.
    // Next-day snap lands on Saturday 2026-03-07 09:00 EST -> weekend -> roll to
    // Monday 2026-03-09 (EDT, UTC-4): 09:00 local = 13:00 UTC.
    const result = snapToDeliveryWindow(new Date('2026-03-06T23:00:00Z'), businessWindow)
    expect(result.toISOString()).toBe('2026-03-09T13:00:00.000Z')
  })

  it('does not roll off the weekend when businessDaysOnly is false', () => {
    const noBusinessDaysWindow: DeliveryWindow = { ...businessWindow, businessDaysOnly: false }
    // Sat 2026-03-07 (EST, UTC-5): 09:00 UTC -> 04:00 local, before window -> same-day snap.
    const result = snapToDeliveryWindow(new Date('2026-03-07T09:00:00Z'), noBusinessDaysWindow)
    expect(result.toISOString()).toBe('2026-03-07T14:00:00.000Z')
  })
})

describe('snapToDeliveryWindow — DST transitions', () => {
  it('keeps startTime at 9:00 AM local across the spring-forward transition (via weekend roll)', () => {
    // Covered above: 2026-03-07 (Sat, EST) rolling to 2026-03-09 (Mon, EDT) both land
    // exactly at 9:00 AM local — re-asserted here directly against the zoned wall clock.
    const result = snapToDeliveryWindow(new Date('2026-03-07T09:00:00Z'), businessWindow)
    // 2026-03-09T13:00:00.000Z in America/New_York (EDT, UTC-4) is 09:00 local.
    const localHour = result.getUTCHours() - 4
    expect(localHour).toBe(9)
  })

  it('keeps startTime at 9:00 AM local across the fall-back transition', () => {
    // Sun 2026-11-01 is the fall-back day itself; by 23:00 UTC the zone has already
    // settled into EST (UTC-5): local = 23:00 - 5 = 18:00, after the window.
    // Next day, Mon 2026-11-02, is a weekday: 09:00 EST local = 14:00 UTC.
    const result = snapToDeliveryWindow(new Date('2026-11-01T23:00:00Z'), businessWindow)
    expect(result.toISOString()).toBe('2026-11-02T14:00:00.000Z')
  })
})

describe('snapToDeliveryWindow — timezone offset correctness', () => {
  it('applies a non-UTC IANA offset correctly (America/New_York, EDT)', () => {
    // Wed 2026-07-15 (EDT, UTC-4): 10:00 UTC -> 06:00 local, before window.
    const result = snapToDeliveryWindow(new Date('2026-07-15T10:00:00Z'), businessWindow)
    expect(result.toISOString()).toBe('2026-07-15T13:00:00.000Z')
  })
})
