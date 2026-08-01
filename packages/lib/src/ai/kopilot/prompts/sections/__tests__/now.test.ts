// packages/lib/src/ai/kopilot/prompts/sections/__tests__/now.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeCtx } from '../__test-helpers'
import { nowSection } from '../now'
import { SYSTEM_PROMPT_SECTIONS } from '../registry'

describe('nowSection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-04T09:07:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the date, the 24h time, the zone, and an ISO date', () => {
    const out = nowSection.render(makeCtx({ runMode: 'interactive' }))
    expect(out).toContain('Wednesday, 4 March 2026, 09:07')
    expect(out).toContain('timezone **UTC**')
    expect(out).toContain('`2026-03-04`')
  })

  it('renders the local calendar date when a zone is threaded', () => {
    // 09:07 UTC is 20:07 the same day in Sydney; the ISO date must follow the
    // zone, not UTC — this is the whole point of passing a zone.
    const out = nowSection.render(makeCtx({ runMode: 'interactive', timezone: 'Australia/Sydney' }))
    expect(out).toContain('Wednesday, 4 March 2026, 20:07')
    expect(out).toContain('timezone **Australia/Sydney**')
    expect(out).toContain('`2026-03-04`')
  })

  it('crosses the date line into the previous day for a behind-UTC zone', () => {
    const out = nowSection.render(makeCtx({ runMode: 'interactive', timezone: 'Pacific/Midway' }))
    expect(out).toContain('Tuesday, 3 March 2026')
    expect(out).toContain('`2026-03-03`')
  })

  it('falls back to UTC on an invalid zone instead of throwing', () => {
    const out = nowSection.render(makeCtx({ runMode: 'interactive', timezone: 'Mars/Olympus' }))
    expect(out).toContain('timezone **UTC**')
    expect(out).toContain('`2026-03-04`')
  })

  it('renders in autonomous mode too', () => {
    expect(nowSection.render(makeCtx({ runMode: 'autonomous' }))).toContain('2026')
  })

  it('is registered in the turn tier, after the last cached section', () => {
    // A `static`/`org` section is cached across calls — the date would freeze.
    expect(nowSection.stability).toBe('turn')
    const ids = SYSTEM_PROMPT_SECTIONS.map((s) => s.id)
    const nowIdx = ids.indexOf('now')
    expect(nowIdx).toBeGreaterThanOrEqual(0)
    const lastCachedIdx = SYSTEM_PROMPT_SECTIONS.reduce(
      (acc, s, i) => (s.stability === 'turn' ? acc : i),
      -1
    )
    expect(nowIdx).toBeGreaterThan(lastCachedIdx)
  })
})
