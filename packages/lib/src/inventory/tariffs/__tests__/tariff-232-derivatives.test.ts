// packages/lib/src/inventory/tariffs/__tests__/tariff-232-derivatives.test.ts

import { describe, expect, it } from 'vitest'
import { loadTariff232Derivatives } from '../tariff-232-derivatives'
import { loadTariff301Memberships, loadTariffMemberships } from '../tariff-301-memberships'
import { findHtsGeneral, loadHtsGeneral } from '../tariff-hts-general'
import { expandTariffStarter, membershipsFor } from '../tariff-starters'

describe('the generated Section 232 table', () => {
  it('carries the four code spellings note 16(c) actually uses', async () => {
    const { memberships } = await loadTariff232Derivatives()
    const keys = Object.keys(memberships)
    const byLength = (n: number) => keys.filter((k) => k.replace(/\D/g, '').length === n)

    expect(byLength(4).length, '4-digit headings, e.g. 7601').toBeGreaterThan(0)
    expect(byLength(6).length, '6-digit subheadings, e.g. 7302.10').toBeGreaterThan(0)
    expect(byLength(8).length, '8-digit, e.g. 7216.10.00').toBeGreaterThan(0)
    expect(byLength(10).length, '10-digit, e.g. 7326.90.8688').toBeGreaterThan(0)
    expect(byLength(4).length + byLength(6).length + byLength(8).length + byLength(10).length).toBe(
      keys.length
    )
  })

  it('only holds codes in the chapters note 16(c) covers unconditionally', async () => {
    const { memberships, weightTested } = await loadTariff232Derivatives()
    for (const code of Object.keys(memberships)) {
      expect(['72', '73', '74', '76'], `${code} is outside ch. 72/73/74/76`).toContain(
        code.slice(0, 2)
      )
    }
    // Every code in lists (i)-(v) is in those chapters today, so the
    // weight-tested set is empty. If a revision changes that, this fails and the
    // warning surface (61 §3.3) becomes owed rather than hypothetical.
    expect(Object.keys(weightTested)).toHaveLength(0)
  })

  it('every entry names the one action key', async () => {
    const { memberships } = await loadTariff232Derivatives()
    for (const keys of Object.values(memberships)) expect(keys).toEqual(['232-metal'])
  })
})

describe('the merged membership table', () => {
  it('is a superset of the 301 table and never loses a 301 key', async () => {
    const [{ memberships: only301 }, merged] = await Promise.all([
      loadTariff301Memberships(),
      loadTariffMemberships(),
    ])
    for (const [code, keys] of Object.entries(only301)) {
      expect(merged[code], `${code} lost its 301 keys in the merge`).toEqual(
        expect.arrayContaining([...keys])
      )
    }
  })

  it('🛑 returns BOTH duties for a code listed at two different key lengths', async () => {
    // 7326.90.8688 is a Section 232 derivative at 10 digits and Section 301
    // List 3 at 8. First-hit-wins would drop the 25-point 301 duty silently.
    const merged = await loadTariffMemberships()
    const keys = membershipsFor('7326.90.86.88', merged)
    expect(keys).toContain('232-metal')
    expect(keys).toContain('301-3')
  })

  it('matches a 4-digit heading membership for a 10-digit code beneath it', async () => {
    const merged = await loadTariffMemberships()
    // 7206 is a bare heading in note 16(c)(iii).
    expect(membershipsFor('7206.10.00.00', merged)).toContain('232-metal')
  })

  it('deduplicates rather than repeating a key matched at two lengths', async () => {
    const keys = membershipsFor('7326.90.86.88', await loadTariffMemberships())
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('the CBP Form 7501 this catalogue was reconciled against', () => {
  // 7326.90.8688 / CN, entered value $14,172.00, total duty $11,039.99 = 77.90%:
  //   9903.88.03  Section 301 List 3   25.00%   $3,543.00
  //   9903.05.90  note 52 exemption     0.00%       $0.00
  //   9903.82.02  Section 232          50.00%   $7,086.00
  //   7326.90.8688 MFN base             2.90%     $410.99
  // No IEEPA line - which is why both IEEPA actions carry a dated 0 at
  // IEEPA_STOPPED_COLLECTION. See tariff-starters.ts for the limits on that.
  it('resolves to the 77.90% the entry was assessed at', async () => {
    const [memberships, catalogue] = await Promise.all([loadTariffMemberships(), loadHtsGeneral()])
    const line = findHtsGeneral(catalogue.lines, '7326.90.86.88')
    expect(line).toBeDefined()
    if (!line) return

    const expansion = expandTariffStarter(line, 'CN', memberships)

    // Latest step per authority as of a day after the last one, summed - the
    // same rule `resolveTariffRate` applies.
    const asOf = '2026-09-18'
    const latest = new Map<string, { rate: number; from: string }>()
    for (const row of expansion.rows) {
      if (row.effectiveFrom > asOf) continue
      const key = (row.authority ?? '').trim().toLowerCase()
      const held = latest.get(key)
      if (!held || row.effectiveFrom >= held.from) {
        latest.set(key, { rate: row.rate, from: row.effectiveFrom })
      }
    }
    const total = [...latest.values()].reduce((sum, entry) => sum + entry.rate, 0)

    expect(total).toBeCloseTo(77.9, 10)
    expect(Math.round(14172 * (total / 100) * 100) / 100).toBeCloseTo(11039.99, 2)
  })
})
