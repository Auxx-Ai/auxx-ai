// packages/lib/src/postings/__tests__/draft.test.ts
//
// All amounts are integer MINOR units (cents): 10_000 = $100.00.
//
// The reversal swap gets the heaviest coverage here. It is the rule that makes a
// correction readable by the NEXT close, and every way of getting it wrong
// produces an entry that still balances - so no downstream check catches it.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import {
  buildPostingDraft,
  type MonthEndInventorySnapshot,
  POSTING_DRAFT_VERSION,
  type PostingAssertions,
  parsePostingDraft,
  requiresAssertions,
  reverseAssertions,
} from '../draft'
import type { BuiltEntry } from '../types'

function snapshot(raw: number, wip: number, fg: number, labor = 0, oh = 0, adj = 0) {
  return {
    balances: {
      inventory_raw_materials: raw,
      inventory_wip: wip,
      inventory_finished_goods: fg,
    },
    activityTotals: {
      absorbedLabor: labor,
      absorbedOverhead: oh,
      inventoryAdjustments: adj,
    },
  } satisfies MonthEndInventorySnapshot
}

const ASSERTIONS: PostingAssertions = {
  kind: 'month_end_inventory',
  before: snapshot(1_000_000, 0, 400_000, 50_000, 20_000, -5_000),
  after: snapshot(1_095_000, 0, 454_000, 100_000, 40_000, -10_000),
}

const ENTRY: BuiltEntry = {
  postingType: 'month_end_inventory',
  periodKey: '2026-08',
  txnDate: '2026-08-31',
  lines: [],
  totalDebit: 154_000,
  totalCredit: 154_000,
}

function draft(assertions?: PostingAssertions) {
  return buildPostingDraft({
    docNumber: 'MEI-2026-08',
    revision: 0,
    entry: ENTRY,
    resolvedLines: [],
    assertions,
  })
}

describe('buildPostingDraft', () => {
  it('stamps the version, so nothing else has to remember to', () => {
    expect(draft().v).toBe(POSTING_DRAFT_VERSION)
  })

  it('round-trips through the parser', () => {
    expect(parsePostingDraft(JSON.parse(JSON.stringify(draft(ASSERTIONS))))).toEqual(
      draft(ASSERTIONS)
    )
  })

  it('carries no assertions when none were supplied', () => {
    expect(parsePostingDraft(JSON.parse(JSON.stringify(draft()))).assertions).toBeUndefined()
  })
})

describe('requiresAssertions', () => {
  it('demands them for month_end_inventory, which asserts a balance', () => {
    expect(requiresAssertions('month_end_inventory')).toBe(true)
  })

  it('does not demand them for a per-event posting', () => {
    expect(requiresAssertions('receipt')).toBe(false)
    expect(requiresAssertions('vendor_bill')).toBe(false)
  })
})

describe('reverseAssertions', () => {
  it('swaps the pair, so the next close reads the state before the original', () => {
    const reversed = reverseAssertions(ASSERTIONS)
    expect(reversed.before).toEqual(ASSERTIONS.after)
    expect(reversed.after).toEqual(ASSERTIONS.before)
  })

  it('is self-inverse: reversing a reversal lands back on the original', () => {
    expect(reverseAssertions(reverseAssertions(ASSERTIONS))).toEqual(ASSERTIONS)
  })

  it('keeps the discriminant, so the parser still recognises it', () => {
    expect(reverseAssertions(ASSERTIONS).kind).toBe('month_end_inventory')
  })

  it('preserves the SIGN of a shrinkage total rather than negating it', () => {
    // The lines of a reversal are negated; the assertions are SWAPPED. Negating
    // these too would double the correction, and the entry would still balance.
    const reversed = reverseAssertions(ASSERTIONS)
    expect(reversed.before.activityTotals.inventoryAdjustments).toBe(-10_000)
    expect(reversed.after.activityTotals.inventoryAdjustments).toBe(-5_000)
  })
})

describe('parsePostingDraft - failing loudly', () => {
  it('rejects a missing draft rather than reading it as "no assertions"', () => {
    expect(() => parsePostingDraft(undefined)).toThrow(UnprocessableEntityError)
    expect(() => parsePostingDraft(null)).toThrow(UnprocessableEntityError)
  })

  it('rejects an unknown version, naming it', () => {
    expect(() => parsePostingDraft({ ...draft(), v: 2 })).toThrow(/version 2/)
  })

  it('rejects assertions of an unknown kind', () => {
    expect(() =>
      parsePostingDraft({ ...draft(), assertions: { kind: 'payout', before: {}, after: {} } })
    ).toThrow(UnprocessableEntityError)
  })

  it('rejects a snapshot missing a side', () => {
    expect(() =>
      parsePostingDraft({
        ...draft(),
        assertions: { kind: 'month_end_inventory', before: ASSERTIONS.before },
      })
    ).toThrow(/assertions.after/)
  })

  it('rejects a non-integer balance - a float cent is a rounding bug', () => {
    const bad = structuredClone(ASSERTIONS)
    bad.after.balances.inventory_raw_materials = 1_095_000.5
    expect(() => parsePostingDraft({ ...draft(), assertions: bad })).toThrow(
      /inventory_raw_materials/
    )
  })

  it('rejects a balance that arrived as a string', () => {
    const bad = JSON.parse(JSON.stringify(ASSERTIONS))
    bad.after.balances.inventory_finished_goods = '454000'
    expect(() => parsePostingDraft({ ...draft(), assertions: bad })).toThrow(
      /inventory_finished_goods/
    )
  })

  it('ACCEPTS zero everywhere - 0 is a real balance, not an absent one', () => {
    // 1320 WIP is structurally zero under L1, so this is the ordinary case and
    // not an edge one. A parser that treated 0 as missing would drop the leg
    // every month and nothing would notice.
    const zeroed: PostingAssertions = {
      kind: 'month_end_inventory',
      before: snapshot(0, 0, 0),
      after: snapshot(0, 0, 0),
    }
    expect(parsePostingDraft({ ...draft(), assertions: zeroed }).assertions).toEqual(zeroed)
  })

  it('ACCEPTS a negative adjustment total - shrinkage is signed', () => {
    const shrink: PostingAssertions = {
      kind: 'month_end_inventory',
      before: snapshot(0, 0, 0, 0, 0, 0),
      after: snapshot(0, 0, 0, 0, 0, -5_000),
    }
    expect(
      parsePostingDraft({ ...draft(), assertions: shrink }).assertions?.after.activityTotals
        .inventoryAdjustments
    ).toBe(-5_000)
  })
})
