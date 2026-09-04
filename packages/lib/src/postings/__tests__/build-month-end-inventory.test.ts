// packages/lib/src/postings/__tests__/build-month-end-inventory.test.ts
//
// All amounts are integer MINOR units (cents): 10_000 = $100.00.
//
// 🛑 **This is the file a CPA is shown, so every test is named for the
// ACCOUNTING FACT it pins, not the code path it walks.**
//
// The sign tests below carry the whole weight of this module's correctness.
// 5000 is the balancing plug, which means flipping any one lane's direction
// still produces a PERFECTLY BALANCED entry - the plug simply absorbs twice the
// error. `buildEntry`'s balance gate cannot see it. A property test cannot see
// it. The exact per-lane, per-sign assertions in
// `describe('the sign table', ...)` are the ONLY guard there is, which is why
// they assert a literal direction rather than deriving one.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import { ACCOUNT_ROLES } from '../build-entry'
import {
  buildMonthEndInventoryEntry,
  type MonthEndInventoryInputs,
} from '../build-month-end-inventory'
import type { MonthEndInventorySnapshot } from '../draft'

const PERIOD = '2026-08'
const TXN_DATE = '2026-08-31'

interface SnapshotShorthand {
  raw?: number
  wip?: number
  fg?: number
  labor?: number
  overhead?: number
  adjustments?: number
}

function snap(values: SnapshotShorthand = {}): MonthEndInventorySnapshot {
  return {
    balances: {
      inventory_raw_materials: values.raw ?? 0,
      inventory_wip: values.wip ?? 0,
      inventory_finished_goods: values.fg ?? 0,
    },
    activityTotals: {
      absorbedLabor: values.labor ?? 0,
      absorbedOverhead: values.overhead ?? 0,
      inventoryAdjustments: values.adjustments ?? 0,
    },
  }
}

function build(prior: SnapshotShorthand, current: SnapshotShorthand) {
  const inputs: MonthEndInventoryInputs = {
    periodKey: PERIOD,
    txnDate: TXN_DATE,
    prior: snap(prior),
    current: snap(current),
  }
  return buildMonthEndInventoryEntry(inputs)
}

/** `[role, direction, amount]` per line, in emitted order. The golden shape. */
function legs(draft: ReturnType<typeof build>): Array<[string, string, number]> {
  // `accountRole` is `string | undefined` on the widened `GlPostingLineInput`
  // union (HANDOFF slot 1A). Every line this builder emits is a ROLE line, so
  // the fallback is unreachable and would fail the golden comparison loudly.
  return draft.entry.lines.map((line) => [line.accountRole ?? '', line.direction, line.amount])
}

describe('the worked example - a month that produced, absorbed and shrank', () => {
  // Raw materials rose $950, finished goods rose $540, $500 of labour and $200
  // of overhead were absorbed, and a count found $50 of stock missing. The
  // residual - what shipped, at full frozen cost - is the $840 COGS plug.
  const draft = build(
    { raw: 1_000_000, wip: 0, fg: 400_000, labor: 0, overhead: 0, adjustments: 0 },
    {
      raw: 1_095_000,
      wip: 0,
      fg: 454_000,
      labor: 50_000,
      overhead: 20_000,
      adjustments: -5_000,
    }
  )

  it('posts exactly six legs, debits first, with COGS as the plug', () => {
    expect(legs(draft)).toEqual([
      [ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS, 'debit', 95_000],
      [ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS, 'debit', 54_000],
      [ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE, 'debit', 5_000],
      [ACCOUNT_ROLES.PAYROLL_CLEARING, 'credit', 50_000],
      [ACCOUNT_ROLES.APPLIED_OVERHEAD, 'credit', 20_000],
      [ACCOUNT_ROLES.COGS_PRODUCT_COST, 'credit', 84_000],
    ])
  })

  it('balances at 154_000 on both sides', () => {
    expect(draft.entry.totalDebit).toBe(154_000)
    expect(draft.entry.totalCredit).toBe(154_000)
  })

  it('omits the 1320 WIP leg, because the WIP balance did not move', () => {
    expect(legs(draft).map(([role]) => role)).not.toContain(ACCOUNT_ROLES.INVENTORY_WIP)
  })

  it('is a month_end_inventory posting dated the last day of the period', () => {
    expect(draft.entry.postingType).toBe('month_end_inventory')
    expect(draft.entry.periodKey).toBe(PERIOD)
    expect(draft.entry.txnDate).toBe(TXN_DATE)
  })

  it('stamps every line with the period as its audit source', () => {
    for (const line of draft.entry.lines) {
      expect(line.sourceType).toBe('month_end_inventory')
      expect(line.sourceId).toBe(PERIOD)
    }
    expect(draft.entry.lines.map((l) => l.sortOrder)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('gives every line a human memo naming its lane', () => {
    for (const line of draft.entry.lines) {
      expect(line.memo).toBeTruthy()
    }
  })
})

// 🛑 Each of the six assertions below is the only thing standing between a
// flipped direction and a balanced, wrong, undetectable journal entry. Each
// isolates ONE lane so the plug is the only other leg, which makes the
// direction unambiguous rather than inferred from a mix.
describe('the sign table - each lane maps its sign to a direction differently', () => {
  it('a RISING inventory balance is a DEBIT to inventory', () => {
    expect(legs(build({ raw: 100_000 }, { raw: 110_000 }))).toEqual([
      [ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS, 'debit', 10_000],
      [ACCOUNT_ROLES.COGS_PRODUCT_COST, 'credit', 10_000],
    ])
  })

  it('a FALLING inventory balance is a CREDIT to inventory', () => {
    expect(legs(build({ raw: 100_000 }, { raw: 90_000 }))).toEqual([
      [ACCOUNT_ROLES.COGS_PRODUCT_COST, 'debit', 10_000],
      [ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS, 'credit', 10_000],
    ])
  })

  it('MORE cumulative absorbed labour is a CREDIT to payroll clearing', () => {
    expect(legs(build({ labor: 0 }, { labor: 10_000 }))).toEqual([
      [ACCOUNT_ROLES.COGS_PRODUCT_COST, 'debit', 10_000],
      [ACCOUNT_ROLES.PAYROLL_CLEARING, 'credit', 10_000],
    ])
  })

  // Cumulative absorption falls when a build is REVERSED: `reverse-build.ts`
  // writes a negated `build_labor_cost` on a second row, so the cumulative sum
  // nets the correction out on its own and the delta goes negative.
  it('LESS cumulative absorbed labour is a DEBIT to payroll clearing', () => {
    expect(legs(build({ labor: 10_000 }, { labor: 0 }))).toEqual([
      [ACCOUNT_ROLES.PAYROLL_CLEARING, 'debit', 10_000],
      [ACCOUNT_ROLES.COGS_PRODUCT_COST, 'credit', 10_000],
    ])
  })

  it('MORE cumulative absorbed overhead is a CREDIT to applied overhead', () => {
    expect(legs(build({ overhead: 0 }, { overhead: 10_000 }))).toEqual([
      [ACCOUNT_ROLES.COGS_PRODUCT_COST, 'debit', 10_000],
      [ACCOUNT_ROLES.APPLIED_OVERHEAD, 'credit', 10_000],
    ])
  })

  it('LESS cumulative absorbed overhead is a DEBIT to applied overhead', () => {
    expect(legs(build({ overhead: 10_000 }, { overhead: 0 }))).toEqual([
      [ACCOUNT_ROLES.APPLIED_OVERHEAD, 'debit', 10_000],
      [ACCOUNT_ROLES.COGS_PRODUCT_COST, 'credit', 10_000],
    ])
  })

  // A recount that found MORE than the system thought: a favourable adjustment.
  it('a RISING cumulative adjustment total is a CREDIT to 5095', () => {
    expect(legs(build({ adjustments: 0 }, { adjustments: 10_000 }))).toEqual([
      [ACCOUNT_ROLES.COGS_PRODUCT_COST, 'debit', 10_000],
      [ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE, 'credit', 10_000],
    ])
  })

  // Shrinkage. The expense lands in 5095, separately from PPV, per `G12`.
  it('a FALLING cumulative adjustment total is a DEBIT to 5095', () => {
    expect(legs(build({ adjustments: 0 }, { adjustments: -10_000 }))).toEqual([
      [ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE, 'debit', 10_000],
      [ACCOUNT_ROLES.COGS_PRODUCT_COST, 'credit', 10_000],
    ])
  })
})

describe('1320 work in process', () => {
  // Structurally zero today: every movement writer resolves through
  // `resolveInventoryRoleForPartKind`, whose range is two values, and a build's
  // consume and produce movements commit together at completion.
  it('is omitted when its balance did not move, so an unmapped role is never resolved', () => {
    const draft = build({ raw: 100_000, wip: 0 }, { raw: 110_000, wip: 0 })
    expect(legs(draft).map(([role]) => role)).not.toContain(ACCOUNT_ROLES.INVENTORY_WIP)
  })

  it('posts a normal balance leg the day the subledger can reach it', () => {
    const draft = build({ wip: 0 }, { wip: 25_000 })
    expect(legs(draft)).toEqual([
      [ACCOUNT_ROLES.INVENTORY_WIP, 'debit', 25_000],
      [ACCOUNT_ROLES.COGS_PRODUCT_COST, 'credit', 25_000],
    ])
  })
})

describe('a month in which inventory fell', () => {
  // Everything shipped and nothing was built: all three balances drop, no
  // absorption, and the whole relief lands in COGS as one debit.
  const draft = build(
    { raw: 500_000, wip: 30_000, fg: 200_000 },
    { raw: 460_000, wip: 20_000, fg: 150_000 }
  )

  it('credits all three inventory accounts and debits COGS for the total', () => {
    expect(legs(draft)).toEqual([
      [ACCOUNT_ROLES.COGS_PRODUCT_COST, 'debit', 100_000],
      [ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS, 'credit', 40_000],
      [ACCOUNT_ROLES.INVENTORY_WIP, 'credit', 10_000],
      [ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS, 'credit', 50_000],
    ])
    expect(draft.entry.totalDebit).toBe(100_000)
  })
})

describe('the COGS plug', () => {
  // Everything built and nothing shipped: the inventory increase is exactly the
  // labour and overhead absorbed into it, so there is no residual to classify.
  it('is omitted entirely when absorption exactly equals the inventory increase', () => {
    const draft = build({}, { fg: 70_000, labor: 50_000, overhead: 20_000 })
    expect(legs(draft)).toEqual([
      [ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS, 'debit', 70_000],
      [ACCOUNT_ROLES.PAYROLL_CLEARING, 'credit', 50_000],
      [ACCOUNT_ROLES.APPLIED_OVERHEAD, 'credit', 20_000],
    ])
  })

  // `G10` as amended: under L1 nothing posts to 5090 during the year, and a
  // `receive` movement freezes actual cost with no standard to difference it
  // against, so purchase price variance is a REPORT and never a leg of this
  // entry.
  it('is never a 5090 purchase price variance leg', () => {
    const draft = build(
      { raw: 1_000_000, fg: 400_000 },
      { raw: 1_095_000, fg: 454_000, labor: 50_000, overhead: 20_000, adjustments: -5_000 }
    )
    expect(legs(draft).map(([role]) => role)).not.toContain(ACCOUNT_ROLES.PPV)
  })
})

describe('the assertions the poster persists', () => {
  const prior = snap({ raw: 1_000_000, fg: 400_000, labor: 4_000 })
  const current = snap({ raw: 1_095_000, fg: 454_000, labor: 54_000, adjustments: -5_000 })
  const draft = buildMonthEndInventoryEntry({
    periodKey: PERIOD,
    txnDate: TXN_DATE,
    prior,
    current,
  })

  it('carries the prior snapshot as `before`, verbatim and unmodified', () => {
    expect(draft.assertions.before).toBe(prior)
    expect(draft.assertions.before).toEqual(snap({ raw: 1_000_000, fg: 400_000, labor: 4_000 }))
  })

  it('carries the gathered snapshot as `after`, verbatim and unmodified', () => {
    expect(draft.assertions.after).toBe(current)
    expect(draft.assertions.after).toEqual(
      snap({ raw: 1_095_000, fg: 454_000, labor: 54_000, adjustments: -5_000 })
    )
  })

  it('is discriminated as month_end_inventory', () => {
    expect(draft.assertions.kind).toBe('month_end_inventory')
  })
})

describe('a month in which nothing moved', () => {
  it('refuses to build an entry, naming the period', () => {
    expect(() => build({ raw: 100_000, fg: 50_000 }, { raw: 100_000, fg: 50_000 })).toThrow(
      /Nothing moved in 2026-08/
    )
  })

  it('refuses with a 422 rather than an empty entry', () => {
    try {
      build({}, {})
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityError)
      expect((error as UnprocessableEntityError).statusCode).toBe(422)
      expect((error as UnprocessableEntityError).details.periodKey).toBe(PERIOD)
    }
  })
})

describe('input validation - a poisoned number names itself', () => {
  // `NaN - 0` is `NaN` and `Math.abs(NaN)` is `NaN`, so an unchecked bad input
  // reaches `buildEntry` and is rejected naming a ROLE rather than the field
  // that poisoned it. The person reading that message is trying to close the
  // books; they need the row, not the account.
  it('rejects a fractional prior balance, naming the field', () => {
    expect(() => build({ raw: 1_000.5 }, { raw: 2_000 })).toThrow(
      /prior\.balances\.inventory_raw_materials must be an integer/
    )
  })

  it('rejects a fractional current balance, naming the field', () => {
    expect(() => build({}, { fg: 0.1 })).toThrow(
      /current\.balances\.inventory_finished_goods must be an integer/
    )
  })

  it('rejects NaN in a cumulative activity total, naming the field', () => {
    expect(() => build({}, { labor: Number.NaN })).toThrow(
      /current\.activityTotals\.absorbedLabor must be an integer/
    )
  })

  it('rejects Infinity, naming the field', () => {
    expect(() => build({}, { overhead: Number.POSITIVE_INFINITY })).toThrow(
      /current\.activityTotals\.absorbedOverhead must be an integer/
    )
  })

  it('rejects a fractional adjustment total, naming the field', () => {
    expect(() => build({}, { adjustments: -5_000.25 })).toThrow(
      /current\.activityTotals\.inventoryAdjustments must be an integer/
    )
  })

  it('rejects a missing snapshot rather than reading through it', () => {
    expect(() =>
      buildMonthEndInventoryEntry({
        periodKey: PERIOD,
        txnDate: TXN_DATE,
        prior: undefined as unknown as MonthEndInventorySnapshot,
        current: snap({ raw: 1 }),
      })
    ).toThrow(/prior is missing/)
  })

  it('reports the offending field in error details for structured logging', () => {
    try {
      build({ wip: 1.5 }, {})
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as UnprocessableEntityError).details.field).toBe('prior.balances.inventory_wip')
    }
  })
})

// A property test cannot catch a flipped sign - see the file header - so this
// pins the weaker but still worth-having claim: whatever the inputs, the plug
// makes the entry balance, so the assembly can never produce something
// `buildEntry` would refuse.
describe('property - the entry balances for any inputs', () => {
  /** Deterministic PRNG (mulberry32). Fixed seed, so a failure is reproducible. */
  function rng(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (state + 0x6d2b79f5) >>> 0
      let t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  it('holds over 500 pseudo-random snapshots', () => {
    const next = rng(20260831)
    const amount = () => Math.floor(next() * 10_000_001) - 5_000_000

    let built = 0
    for (let i = 0; i < 500; i++) {
      const prior: SnapshotShorthand = {
        raw: amount(),
        wip: amount(),
        fg: amount(),
        labor: amount(),
        overhead: amount(),
        adjustments: amount(),
      }
      const current: SnapshotShorthand = {
        raw: amount(),
        wip: amount(),
        fg: amount(),
        labor: amount(),
        overhead: amount(),
        adjustments: amount(),
      }

      const draft = build(prior, current)
      built++

      let debits = 0
      let credits = 0
      for (const line of draft.entry.lines) {
        expect(Number.isInteger(line.amount)).toBe(true)
        expect(line.amount).toBeGreaterThan(0)
        if (line.direction === 'debit') debits += line.amount
        else credits += line.amount
      }
      expect(debits).toBe(credits)
      expect(debits).toBe(draft.entry.totalDebit)
      expect(credits).toBe(draft.entry.totalCredit)
    }
    expect(built).toBe(500)
  })
})
