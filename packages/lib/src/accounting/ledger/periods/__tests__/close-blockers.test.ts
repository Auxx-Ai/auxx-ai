// packages/lib/src/accounting/ledger/periods/__tests__/close-blockers.test.ts

import { describe, expect, it } from 'vitest'
import {
  closeBlockerMessage,
  describeIncompleteRevenue,
  describeInventoryBlockers,
  describeUnmappedRoles,
  incompleteRevenueLead,
  monthLabel,
} from '../close-blockers'

const JANUARY = '2026-01'

/** The counts, complete unless a test says otherwise. */
function counts(overrides: Partial<Parameters<typeof describeIncompleteRevenue>[0]> = {}) {
  return {
    periodKey: JANUARY,
    shipments: 0,
    draftChannelMemos: 0,
    ...overrides,
  }
}

describe('describeIncompleteRevenue', () => {
  it('says nothing about a complete month', () => {
    // The caller's signal not to refuse at all.
    expect(describeIncompleteRevenue(counts())).toEqual([])
  })

  it('omits the counts that are zero rather than rendering them as satisfied', () => {
    // 🛑 An operator with one problem sees one row. A card whose job is to list
    // work must not pad that list with a row saying there is none.
    const items = describeIncompleteRevenue(counts({ draftChannelMemos: 14 }))

    expect(items).toHaveLength(1)
    expect(items[0]?.key).toBe('draft_channel_memos')
    expect(items[0]?.count).toBe(14)
  })

  it('carries the month on every item, so a remedy knows what to scope to', () => {
    const items = describeIncompleteRevenue(counts({ shipments: 1, draftChannelMemos: 1 }))

    expect(items.map((item) => item.ref)).toEqual([JANUARY, JANUARY])
  })

  it('keeps the counts separate: neither subsumes the other', () => {
    // A shipment waits on the sweep and a draft memo waits on a decision.
    // Collapsing them sends somebody to the wrong screen.
    const items = describeIncompleteRevenue(counts({ shipments: 1, draftChannelMemos: 1 }))

    expect(items.map((item) => item.key)).toEqual(['unposted_shipments', 'draft_channel_memos'])
  })

  it('has nothing to say about an issued memo that never posted (88 D8)', () => {
    // The third count is gone: an issue the ledger refused never flips the
    // memo's status, so the state it described cannot exist.
    const keys: string[] = describeIncompleteRevenue(
      counts({ shipments: 1, draftChannelMemos: 1 })
    ).map((item) => item.key)

    expect(keys).not.toContain('unposted_credit_memos')
  })

  it('agrees with itself about number: one shipment is, two shipments are', () => {
    expect(describeIncompleteRevenue(counts({ shipments: 1 }))[0]?.label).toBe(
      '1 shipment is not posted'
    )
    expect(describeIncompleteRevenue(counts({ shipments: 2 }))[0]?.label).toBe(
      '2 shipments are not posted'
    )
    expect(describeIncompleteRevenue(counts({ draftChannelMemos: 1 }))[0]?.label).toBe(
      '1 channel credit memo is still a draft'
    )
  })

  it('leaves no trailing period on a label and ends every remedy with one', () => {
    // The two halves are joined back into prose by `closeBlockerMessage`, and
    // rendered as a row title and a button by the console. Both need the split
    // to be exactly here.
    for (const item of describeIncompleteRevenue(counts({ shipments: 3, draftChannelMemos: 2 }))) {
      expect(item.label.endsWith('.')).toBe(false)
      expect(item.remedy.endsWith('.')).toBe(true)
    }
  })
})

describe('closeBlockerMessage', () => {
  // 🛑 THE regression guard for this whole design. `PostResult.error` is stored
  // on the refusal, read in the logs and asserted by `close-month.test.ts`. The
  // items are a second rendering of one answer; the moment this message stops
  // matching what the gate used to write by hand, they have become two answers.
  it('reproduces the sentence the completeness gate has always written', () => {
    const items = describeIncompleteRevenue(counts({ shipments: 3, draftChannelMemos: 14 }))

    expect(closeBlockerMessage(incompleteRevenueLead(JANUARY), items)).toBe(
      'January 2026 still holds revenue that is not in the books. ' +
        '3 shipments are not posted. The shipment sweep posts the fulfillments for January 2026 ' +
        'on its next pass. Anything it refuses is on the Outbox Blocked tab under its own reason. ' +
        '14 channel credit memos are still a draft. Issue or void the channel credit memos dated in January 2026.'
    )
  })

  it('returns the lead alone when there is nothing outstanding', () => {
    expect(closeBlockerMessage('Nothing to report.', [])).toBe('Nothing to report.')
  })
})

describe('describeUnmappedRoles', () => {
  const details = {
    unresolvedRoles: ['inventory_absorption', 'cogs_freight'],
    unresolvedReasons: ["'inventory_absorption' is not mapped.", "'cogs_freight' is not mapped."],
  }

  it('pairs each role with its own reason', () => {
    expect(describeUnmappedRoles(details)).toEqual([
      {
        key: 'unmapped_role',
        label: 'inventory_absorption',
        remedy: "'inventory_absorption' is not mapped.",
        ref: 'inventory_absorption',
      },
      {
        key: 'unmapped_role',
        label: 'cogs_freight',
        remedy: "'cogs_freight' is not mapped.",
        ref: 'cogs_freight',
      },
    ])
  })

  // ⚠️ Every case below FAILS CLOSED: no items, and the console falls back to
  // the verbatim message it always rendered. A card that invented a role name
  // would send somebody to remap an account that was never the problem.
  it.each([
    ['nothing at all', undefined],
    ['a non-object', 'unresolvedRoles'],
    ['no pairing', { organizationId: 'org_1' }],
    ['only one half', { unresolvedRoles: ['a'] }],
    ['arrays of unequal length', { unresolvedRoles: ['a', 'b'], unresolvedReasons: ['x'] }],
    ['an empty pairing', { unresolvedRoles: [], unresolvedReasons: [] }],
    ['a non-string member', { unresolvedRoles: ['a', 2], unresolvedReasons: ['x', 'y'] }],
  ])('renders no rows for %s', (_label, input) => {
    expect(describeUnmappedRoles(input)).toEqual([])
  })
})

describe('monthLabel', () => {
  it('carries the year, because a console can be looking at any month of any year', () => {
    expect(monthLabel('2026-07')).toBe('July 2026')
  })

  it('returns a key that is not a month unchanged rather than mangling it', () => {
    // `GlPosting` documents period keys that are not dates at all.
    expect(monthLabel('payout-2026-07-14-abc')).toBe('payout-2026-07-14-abc')
    expect(monthLabel('2026-13')).toBe('2026-13')
  })
})

describe('describeInventoryBlockers', () => {
  const MONTH = '2026-07'

  it('produces NOTHING for a month that ties with every movement posted', () => {
    expect(
      describeInventoryBlockers({
        periodKey: MONTH,
        unpostedMovements: 0,
        subledgerMinor: 812_500,
        ledgerMinor: 812_500,
      })
    ).toEqual([])
  })

  it('names the unposted movements, and puts completeness first', () => {
    const items = describeInventoryBlockers({
      periodKey: MONTH,
      unpostedMovements: 3,
      subledgerMinor: 100_000,
      ledgerMinor: 97_000,
    })

    expect(items.map((item) => item.key)).toEqual(['inventory_unposted', 'inventory_balance'])
    expect(items[0]?.count).toBe(3)
    expect(items[0]?.label).toContain('3 stock movements')
    expect(items[0]?.remedy).toContain('July 2026')
  })

  it('reports a balance difference in either direction', () => {
    const short = describeInventoryBlockers({
      periodKey: MONTH,
      unpostedMovements: 0,
      subledgerMinor: 90_000,
      ledgerMinor: 100_000,
    })
    expect(short).toHaveLength(1)
    expect(short[0]?.key).toBe('inventory_balance')
    expect(short[0]?.label).toContain('-10000')

    const over = describeInventoryBlockers({
      periodKey: MONTH,
      unpostedMovements: 0,
      subledgerMinor: 100_000,
      ledgerMinor: 90_000,
    })
    expect(over[0]?.label).toContain('10000')
  })

  // 73 §6.2 rule 4. The movement sum and the ledger are the same money added
  // twice, so a residue hand-written into an inventory account ties against
  // both; the parts list does not, and that is the whole point of the check.
  it('catches a residue the movement sum cannot see', () => {
    const items = describeInventoryBlockers({
      periodKey: MONTH,
      unpostedMovements: 0,
      // Somebody journalled 2,200 into Raw Materials. Both of these agree.
      subledgerMinor: 100_000,
      ledgerMinor: 100_000,
      // The shelf holds 8 x 14 + 6 x 22 = 244.00 - not 1,000.00.
      standardValueMinor: 97_800,
    })

    expect(items.map((item) => item.key)).toEqual(['inventory_standard_value'])
    expect(items[0]?.label).toContain('-2200')
    expect(items[0]?.remedy).toContain('July 2026')
  })

  it('says nothing when the accounts equal quantity on hand times standard', () => {
    expect(
      describeInventoryBlockers({
        periodKey: MONTH,
        unpostedMovements: 0,
        subledgerMinor: 24_400,
        ledgerMinor: 24_400,
        standardValueMinor: 24_400,
      })
    ).toEqual([])
  })

  it('says nothing when the parts list could not be valued at all', () => {
    // An org short of the standard-cost fields gets no blocker it cannot act on.
    expect(
      describeInventoryBlockers({
        periodKey: MONTH,
        unpostedMovements: 0,
        subledgerMinor: 24_400,
        ledgerMinor: 24_400,
        standardValueMinor: null,
      })
    ).toEqual([])
  })

  it('carries the month on every item so a remedy knows what to act on', () => {
    const items = describeInventoryBlockers({
      periodKey: MONTH,
      unpostedMovements: 1,
      subledgerMinor: 1,
      ledgerMinor: 0,
    })
    expect(items.every((item) => item.ref === MONTH)).toBe(true)
  })
})
