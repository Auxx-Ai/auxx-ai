// packages/lib/src/postings/__tests__/period-lock.test.ts
//
// `periods.ts` is pure and exhaustively tested with no database. This module is
// the one thing it delegates: turning a settings row into the `PeriodLock` that
// `assertPeriodOpen` compares against.
//
// There is really only one behaviour worth defending here and every test below
// is a face of it: **a value this function cannot understand must stop posting,
// not permit it.** Treating a malformed lock as "nothing is closed" allows an
// entry into a month an accountant has already filed numbers for, the entry
// balances so nothing downstream detects it, and there is no un-post. Refusing
// is a five-second repair of one settings row.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** What `getOrganizationSetting` answers with for `ledger.lockedThroughMonth`. */
  value: null as unknown,
  /** Every key the module asked for, so the test can prove it read the right one. */
  keysRead: [] as string[],
}))

vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: async (params: { key: string }) => {
    h.keysRead.push(params.key)
    return h.value
  },
}))

import { UnprocessableEntityError } from '../../errors'
import { PERIOD_LOCK_SETTING_KEY, resolvePeriodLock } from '../period-lock'
import { assertPeriodOpen, isPeriodLocked } from '../periods'

const ORG = 'org_1'

beforeEach(() => {
  h.value = null
  h.keysRead = []
})

describe('resolvePeriodLock', () => {
  it('reads the catalog key it declares, and nothing else', async () => {
    h.value = '2026-07'
    await resolvePeriodLock(ORG)
    expect(h.keysRead).toEqual([PERIOD_LOCK_SETTING_KEY])
    expect(PERIOD_LOCK_SETTING_KEY).toBe('ledger.lockedThroughMonth')
  })

  it('returns the stored month', async () => {
    h.value = '2026-07'
    await expect(resolvePeriodLock(ORG)).resolves.toEqual({ lockedThroughMonth: '2026-07' })
  })

  it('trims incidental whitespace rather than refusing a hand-typed value', async () => {
    h.value = '  2026-07 '
    await expect(resolvePeriodLock(ORG)).resolves.toEqual({ lockedThroughMonth: '2026-07' })
  })

  describe('nothing closed yet', () => {
    // The state every organization starts in and most stay in until their first
    // close. All three spellings have to mean the same thing: the catalog
    // default is `null`, a settings form clearing a text input writes `''`, and
    // a form that trims nothing writes whitespace.
    it.each([
      ['the catalog default', null],
      ['an empty string', ''],
      ['whitespace', '   '],
    ])('resolves %s to no lock', async (_label, stored) => {
      h.value = stored
      await expect(resolvePeriodLock(ORG)).resolves.toEqual({ lockedThroughMonth: null })
    })

    it('leaves every period open', async () => {
      h.value = null
      const lock = await resolvePeriodLock(ORG)
      expect(isPeriodLocked('2020-01', lock)).toBe(false)
      expect(() => assertPeriodOpen('2020-01-01', lock)).not.toThrow()
    })
  })

  describe('fails closed on a malformed value', () => {
    // Each of these would be read as "nothing is closed" by a resolver that
    // shrugged, and each would then let a posting into a closed month.
    it.each([
      ['a month with no zero padding', '2026-7'],
      ['a bare year', '2026'],
      ['a month 13', '2026-13'],
      ['a month 00', '2026-00'],
      ['prose', 'closed'],
      ['a slash-separated month', '2026/07'],
      ['a trailing revision suffix', '2026-07:rev'],
    ])('refuses %s', async (_label, stored) => {
      h.value = stored
      await expect(resolvePeriodLock(ORG)).rejects.toBeInstanceOf(UnprocessableEntityError)
    })

    it.each([
      ['a number', 202607],
      ['a boolean', true],
      ['an object', { lockedThroughMonth: '2026-07' }],
      ['an array', ['2026-07']],
    ])('refuses %s', async (_label, stored) => {
      h.value = stored
      await expect(resolvePeriodLock(ORG)).rejects.toBeInstanceOf(UnprocessableEntityError)
    })

    it('refuses a DAY key, because a lock is by month', async () => {
      // `parsePeriodKey` accepts this happily - it is a real date. The refusal is
      // this module's, and it is deliberate: `'2026-07-15'` either locks all of
      // July or none of it, and choosing silently is failing open in a costume.
      h.value = '2026-07-15'
      await expect(resolvePeriodLock(ORG)).rejects.toBeInstanceOf(UnprocessableEntityError)
      await expect(resolvePeriodLock(ORG)).rejects.toThrow(/date, not a month/)
    })

    it('names the setting and the offending value, so the repair is obvious', async () => {
      h.value = 'last july'
      await expect(resolvePeriodLock(ORG)).rejects.toThrow(/ledger\.lockedThroughMonth/)
      await expect(resolvePeriodLock(ORG)).rejects.toThrow(/last july/)
      await expect(resolvePeriodLock(ORG)).rejects.toThrow(/YYYY-MM/)
    })
  })

  describe('feeds the pure period check', () => {
    it('closes the locked month and every month before it', async () => {
      h.value = '2026-07'
      const lock = await resolvePeriodLock(ORG)

      expect(isPeriodLocked('2026-06', lock)).toBe(true)
      expect(isPeriodLocked('2026-07', lock)).toBe(true)
      expect(isPeriodLocked('2026-08', lock)).toBe(false)
      // A day key is bounded by the month that contains it.
      expect(isPeriodLocked('2026-07-31', lock)).toBe(true)
      expect(isPeriodLocked('2026-08-01', lock)).toBe(false)
    })

    it('produces a lock `assertPeriodOpen` accepts', async () => {
      h.value = '2026-07'
      const lock = await resolvePeriodLock(ORG)
      expect(() => assertPeriodOpen('2026-07-15', lock)).toThrow(/closed through 2026-07/)
      expect(() => assertPeriodOpen('2026-08-15', lock)).not.toThrow()
    })
  })
})
