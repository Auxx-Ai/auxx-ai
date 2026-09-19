// packages/lib/src/accounting/purchasing/intake/__tests__/client.test.ts

import { describe, expect, it } from 'vitest'
import type { IntakeLine } from '../client'
import {
  lineSumCents,
  parseIntakeMoney,
  printedLineGap,
  rateRoundingAllowance,
  resolveIntakeUnitPrice,
} from '../client'

const USD = 'USD'

describe('parseIntakeMoney — a money string, never prose that contains digits', () => {
  it('reads an amount through its currency affix', () => {
    expect(parseIntakeMoney('US$250,843.72', USD)).toBe(25_084_372)
    expect(parseIntakeMoney('$1,234.56', USD)).toBe(123_456)
    expect(parseIntakeMoney('45.00 each', USD)).toBe(4500)
    expect(parseIntakeMoney('2.16', USD)).toBe(216)
  })

  // 🛑 The real one. A vendor's tax box read this sentence, the model transcribed
  // it (correctly — rule 6 is to copy what is printed), and the old parse stripped
  // everything outside [0-9.,-] to leave "120240": $120,240.00 of tax assembled
  // out of a container count and two container sizes, committed to
  // `purchase_order_tax_total`.
  it('refuses a sentence that merely contains digits', () => {
    expect(
      parseIntakeMoney('including tax and 1*20ft+2*40ft deliervy by Ocean Cost', USD)
    ).toBeNull()
  })

  it('refuses anything holding more than one number', () => {
    expect(parseIntakeMoney('4.20 - 3.90', USD)).toBeNull()
    expect(parseIntakeMoney('100 @ 4.20 / 500 @ 3.90', USD)).toBeNull()
  })

  it('still reads a trailing note that carries no digits of its own', () => {
    expect(parseIntakeMoney('USD 1,234.56 (incl. VAT)', USD)).toBe(123_456)
  })

  it('keeps POA and the empties null', () => {
    expect(parseIntakeMoney('POA', USD)).toBeNull()
    expect(parseIntakeMoney('  ', USD)).toBeNull()
    expect(parseIntakeMoney(null, USD)).toBeNull()
  })
})

describe('resolveIntakeUnitPrice — recovering the precision the rate column lost', () => {
  const line = (unitPriceText: string | null, lineTotalText: string | null) => ({
    unitPriceText,
    lineTotalText,
  })

  // 🛑 From a real aluminium-extrusion quote. The vendor prints rates rounded to
  // cents and computes line totals from the rate they actually used, so
  // re-deriving 2,000 x 2.16 understates the line by $6.20. Across that document's
  // twelve lines it put our sum $11.28 above a printed grand total that was right
  // all along, and §3.1 blamed the vendor's arithmetic for our own rounding.
  it('adopts the rate the printed line total implies', () => {
    expect(resolveIntakeUnitPrice(line('2.16', '4326.20'), 2000, USD)).toBe(216.31)
    expect(resolveIntakeUnitPrice(line('5.80', '23212.44'), 4000, USD)).toBe(580.311)
    expect(resolveIntakeUnitPrice(line('11.03', '38590.12'), 3500, USD)).toBe(1102.575)
  })

  it('leaves a rate that already reproduces the printed total alone', () => {
    expect(resolveIntakeUnitPrice(line('0.069', '4140.00'), 60_000, USD)).toBe(6.9)
  })

  // 🛑 The proof, not a tolerance: the implied rate is adopted only when rounding
  // it back to the printed rate's own precision reproduces the printed rate. A
  // line discount, a vendor error or a misread fails that test, and then the
  // printed rate stands and the confrontation shows the difference.
  it('keeps the printed rate when the total implies a genuinely different one', () => {
    // 10 x 5.00 is 50.00; a printed 45.00 is a discount, not a rounding artifact.
    expect(resolveIntakeUnitPrice(line('5.00', '45.00'), 10, USD)).toBe(500)
  })

  it('reads the printed precision off the value, whatever the locale wrote', () => {
    // A three-decimal rate gets a three-decimal test: 0.069 may only absorb an
    // implied rate that rounds back to 0.069, not merely to 0.07.
    expect(resolveIntakeUnitPrice(line('0.069', '4200.00'), 60_000, USD)).toBe(6.9)
  })

  it('still back-solves a lump-sum line that prints no rate at all', () => {
    expect(resolveIntakeUnitPrice(line(null, '450.00'), 1, USD)).toBe(45_000)
  })

  it('falls back to the printed rate when there is no usable total', () => {
    expect(resolveIntakeUnitPrice(line('2.16', null), 2000, USD)).toBe(216)
    expect(resolveIntakeUnitPrice(line('2.16', 'POA'), 2000, USD)).toBe(216)
    expect(resolveIntakeUnitPrice(line('2.16', '4326.20'), 0, USD)).toBe(216)
  })

  it('is null when the line prints neither', () => {
    expect(resolveIntakeUnitPrice(line(null, null), 10, USD)).toBeNull()
  })
})

describe('printedLineGap — the vendor disagrees with themselves', () => {
  const printed = (quantity: number | null, unitPriceText: string | null, lineTotalText: string) =>
    ({ quantity, unitPriceText, lineTotalText }) as const

  // 🛑 Every line of the aluminium quote. The rate column is rounded to cents and
  // the totals are computed from more places, which `resolveIntakeUnitPrice`
  // proves and absorbs — so NONE of these may be marked, or a per-thousand quote
  // wears twelve warnings that all mean "your vendor rounds".
  it('stays silent on a rate that was merely printed rounded', () => {
    expect(printedLineGap(printed(2000, '2.16', '4326.20'), USD)).toBeNull()
    expect(printedLineGap(printed(4000, '5.80', '23212.44'), USD)).toBeNull()
    expect(printedLineGap(printed(3500, '11.03', '38590.12'), USD)).toBeNull()
    expect(printedLineGap(printed(8000, '9.51', '76094.25'), USD)).toBeNull()
    expect(printedLineGap(printed(60_000, '0.069', '4140.00'), USD)).toBeNull()
  })

  it('reports a difference the rounding cannot explain', () => {
    // 10 x 5.00 is 50.00, printed as 45.00 — a discount, a typo, or a misread qty.
    expect(printedLineGap(printed(10, '5.00', '45.00'), USD)).toBe(500)
    // Ours lower than theirs reports negative, so the direction survives.
    expect(printedLineGap(printed(10, '5.00', '55.00'), USD)).toBe(-500)
  })

  // 🛑 The tolerance scales with quantity because the residue does: a rate is
  // quantised at RATE_DECIMALS, so 60,000 units multiply that quantum 60,000
  // times. A flat cents tolerance would fire on exactly the high-quantity lines
  // this check exists to watch.
  it('does not false-positive on a large quantity', () => {
    expect(printedLineGap(printed(100_000, '0.01594', '1594.00'), USD)).toBeNull()
  })

  it('is null when the line does not print all three numbers', () => {
    expect(printedLineGap(printed(10, null, '45.00'), USD)).toBeNull()
    expect(printedLineGap(printed(null, '5.00', '45.00'), USD)).toBeNull()
    expect(printedLineGap(printed(0, '5.00', '45.00'), USD)).toBeNull()
    expect(
      printedLineGap({ quantity: 10, unitPriceText: '5.00', lineTotalText: null }, USD)
    ).toBeNull()
  })

  it('is null when the total was prose rather than an amount', () => {
    expect(printedLineGap(printed(10, '5.00', 'included in the above'), USD)).toBeNull()
  })
})

describe('rateRoundingAllowance — telling our own rounding from a real defect', () => {
  const line = (quantity: number, unitPriceText: string, lineTotalText: string | null) =>
    ({
      lineId: `l${quantity}${unitPriceText}`,
      printed: {
        lineNumber: null,
        vendorCode: null,
        description: null,
        quantity,
        unit: null,
        unitPriceText,
        lineTotalText,
        leadTime: null,
        priceBreaks: [],
      },
      tier: 'none',
      candidates: [],
      partRecordId: null,
      vendorPartRecordId: null,
      description: null,
      quantity,
      unitPriceCents: resolveIntakeUnitPrice({ unitPriceText, lineTotalText }, quantity, USD),
      chosenBreakIndex: null,
      foldedInto: null,
      removed: false,
    }) as unknown as IntakeLine

  // The real quote, all twelve lines.
  const quote = [
    line(2000, '2.16', '4326.20'),
    line(4000, '2.91', '11632.43'),
    line(4000, '5.80', '23212.44'),
    line(2000, '4.69', '9371.19'),
    line(1000, '3.53', '3532.50'),
    line(2000, '4.88', '9759.09'),
    line(2000, '7.67', '15349.71'),
    line(4000, '9.70', '38781.70'),
    line(60_000, '0.069', '4140.00'),
    line(8000, '9.51', '76094.25'),
    line(2000, '8.03', '16054.10'),
    line(3500, '11.03', '38590.12'),
  ]

  it('covers the residue the real quote actually leaves', () => {
    const printedTotal = 25_084_372
    const difference = Math.abs(printedTotal - lineSumCents(quote))
    expect(difference).toBe(7) // seven cents, down from 1128 before the rate fix
    expect(difference).toBeLessThanOrEqual(rateRoundingAllowance(quote, USD))
  })

  // 🛑 The bound must stay tight enough to be worth having. A missed line, a
  // transposed digit, a dropped zero — all of those must still land outside it.
  it('does not stretch to cover a missing line', () => {
    const short = quote.slice(0, -1)
    const difference = Math.abs(25_084_372 - lineSumCents(short))
    expect(difference).toBeGreaterThan(rateRoundingAllowance(short, USD))
  })

  it('counts only lines that printed a total to approximate', () => {
    expect(rateRoundingAllowance([line(1000, '1.00', null)], USD)).toBe(0)
  })

  it('counts nothing for a line ordering zero', () => {
    expect(rateRoundingAllowance([line(0, '1.00', '0.00')], USD)).toBe(0)
  })
})
