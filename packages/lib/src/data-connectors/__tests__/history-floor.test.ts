// packages/lib/src/data-connectors/__tests__/history-floor.test.ts
// The history floor never passes an accounting-active org's cutover (v13 N2, v14 §3).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const accounting = { active: false, cutoverStart: null as Date | null }
const readActiveCutoverStart = vi.fn(async () =>
  accounting.active ? accounting.cutoverStart : null
)
vi.mock('../../accounting/ledger/setup/cutover-start', () => ({
  readActiveCutoverStart: () => readActiveCutoverStart(),
}))

import { historyFloor } from '../slice-orchestrator'

beforeEach(() => {
  accounting.active = false
  accounting.cutoverStart = null
  readActiveCutoverStart.mockClear()
})

describe('historyFloor', () => {
  it('has no floor without a history date, and never reads the cutover', async () => {
    expect(await historyFloor('org1', undefined)).toBeUndefined()
    expect(await historyFloor('org1', 'not-a-date')).toBeUndefined()
    expect(readActiveCutoverStart).not.toHaveBeenCalled()
  })

  it('is the date at UTC midnight for an org without active accounting', async () => {
    accounting.cutoverStart = new Date('2025-10-01T07:00:00.000Z')
    expect(await historyFloor('org1', '2026-06-01')).toBe('2026-06-01T00:00:00.000Z')
  })

  it('moves earlier to a cutover before the date', async () => {
    accounting.active = true
    accounting.cutoverStart = new Date('2025-10-01T07:00:00.000Z')
    expect(await historyFloor('org1', '2026-06-01')).toBe('2025-10-01T07:00:00.000Z')
  })

  it('keeps the date when the cutover is later than it', async () => {
    accounting.active = true
    accounting.cutoverStart = new Date('2026-09-01T07:00:00.000Z')
    expect(await historyFloor('org1', '2026-06-01')).toBe('2026-06-01T00:00:00.000Z')
  })
})
