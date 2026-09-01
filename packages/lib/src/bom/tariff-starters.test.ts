// packages/lib/src/bom/tariff-starters.test.ts
//
// Two jobs. First, the cross-reference review the catalogue cannot do for
// itself (plans/money/tasks/32-tariff-starter-catalogue.md §1.3): every
// membership names a real 'listed' action, every action's steps are well
// formed, no two actions for one country share an authority, every action's
// country and chapter99Code are present and valid. Second, the expander's and
// `membershipsFor`'s behaviour against the worked examples the brief names.

import { describe, expect, it } from 'vitest'
import { ISO_COUNTRY_OPTIONS } from '../resources/registry/iso-country-options'
import {
  type ActionKey,
  expandTariffStarter,
  membershipsFor,
  starterNote,
  TARIFF_ACTIONS,
  TARIFF_MEMBERSHIPS,
  TARIFF_STARTERS_VERSION,
} from './tariff-starters'
import { resolveTariffRate, type TariffRateRow } from './vendor-cost'

const ISO_COUNTRIES = new Set(ISO_COUNTRY_OPTIONS.map((option) => option.value))

describe('TARIFF_ACTIONS / TARIFF_MEMBERSHIPS cross-reference', () => {
  it('every membership key names an existing action with covers: listed', () => {
    for (const [prefix, keys] of Object.entries(TARIFF_MEMBERSHIPS)) {
      for (const key of keys) {
        const action = TARIFF_ACTIONS[key]
        expect(action, `${prefix} names unknown action ${key}`).toBeDefined()
        expect(action.covers, `${prefix} names ${key}, which is not 'listed'`).toBe('listed')
      }
    }
  })

  it('every action’s steps are strictly ascending, ISO-dated, and rates are finite and >= 0', () => {
    for (const [key, action] of Object.entries(TARIFF_ACTIONS)) {
      expect(action.steps.length, `${key} has no steps`).toBeGreaterThan(0)

      let previous: string | null = null
      for (const [from, rate] of action.steps) {
        expect(from, `${key} step date ${from}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(Number.isFinite(rate), `${key} step ${from} has a non-finite rate`).toBe(true)
        expect(rate, `${key} step ${from} rate is negative`).toBeGreaterThanOrEqual(0)
        if (previous !== null) {
          expect(from > previous, `${key} steps are not strictly ascending at ${from}`).toBe(true)
        }
        previous = from
      }
    }
  })

  it('no two actions for the same country share an authority (folded)', () => {
    const seen = new Map<string, string>() // `${country}::${foldedAuthority}` -> key

    for (const [key, action] of Object.entries(TARIFF_ACTIONS)) {
      const folded = `${action.country}::${action.authority.trim().toLowerCase()}`
      const existing = seen.get(folded)
      expect(existing, `${key} shares an authority with ${existing} for ${action.country}`).toBe(
        undefined
      )
      seen.set(folded, key)
    }
  })

  it('every action country is a valid ISO country option', () => {
    for (const [key, action] of Object.entries(TARIFF_ACTIONS)) {
      expect(
        ISO_COUNTRIES.has(action.country),
        `${key} has unknown country ${action.country}`
      ).toBe(true)
    }
  })

  it('every action has a non-empty chapter99Code', () => {
    for (const [key, action] of Object.entries(TARIFF_ACTIONS)) {
      expect(action.chapter99Code.trim(), `${key} has no chapter99Code`).not.toBe('')
    }
  })

  it('every membership key is an 8- or 6-digit HTS prefix', () => {
    for (const prefix of Object.keys(TARIFF_MEMBERSHIPS)) {
      expect(prefix).toMatch(/^\d{4}\.\d{2}(\.\d{2})?$/)
    }
  })
})

/** Maps `StarterRow`s onto `TariffRateRow`s so they can run through the resolver. */
function asTariffRateRows(rows: ReturnType<typeof expandTariffStarter>['rows']): TariffRateRow[] {
  return rows.map((row, index) => ({
    id: `row-${index}`,
    authority: row.authority,
    rate: row.rate,
    effectiveFrom: row.effectiveFrom,
    chapter99Code: row.chapter99Code,
  }))
}

describe('expandTariffStarter', () => {
  const valve: [code: string, rate: number, description: string] = ['8481.80.9005', 2, 'Valves']

  it('resolves the CN worked example to MFN + 301 List 3 + IEEPA fentanyl + IEEPA reciprocal', () => {
    const expansion = expandTariffStarter(valve, 'CN')
    expect(expansion.membershipRecorded).toBe(true)

    const mfnRow = expansion.rows.find((row) => row.authority === null)
    expect(mfnRow).toBeDefined()
    expect(mfnRow?.note).not.toContain('not recorded')

    const resolution = resolveTariffRate(
      asTariffRateRows(expansion.rows),
      new Date('2025-06-01T00:00:00.000Z')
    )
    expect(resolution.status).toBe('resolved')
    expect(resolution.rate).toBe(57)

    const byAuthority = new Map(resolution.components.map((c) => [c.authority, c.rate]))
    expect(byAuthority.get(null)).toBe(2)
    expect(byAuthority.get('Section 301 List 3')).toBe(25)
    expect(byAuthority.get('IEEPA fentanyl')).toBe(20)
    expect(byAuthority.get('IEEPA reciprocal')).toBe(10)
    expect(byAuthority.size).toBe(4)
  })

  it('resolves the same code for DE to the MFN row alone', () => {
    const expansion = expandTariffStarter(valve, 'DE')
    expect(expansion.rows).toHaveLength(1)
    expect(expansion.rows.at(0)?.authority).toBeNull()
    expect(expansion.membershipRecorded).toBeNull()
  })

  it('flags an unrecorded membership for a CN code with no membership entry', () => {
    const unlisted: [code: string, rate: number, description: string] = ['9999.99.9999', 5, 'x']
    const expansion = expandTariffStarter(unlisted, 'CN')

    expect(expansion.membershipRecorded).toBe(false)

    const mfnRow = expansion.rows.find((row) => row.authority === null)
    expect(mfnRow?.note).toContain('Section 301 membership not recorded')

    // MFN plus the two 'all' actions for CN (ieepa-fentanyl-cn, ieepa-reciprocal-cn).
    const authorities = expansion.rows.map((row) => row.authority)
    expect(authorities).toContain(null)
    expect(authorities).toContain('IEEPA fentanyl')
    expect(authorities).toContain('IEEPA reciprocal')
    expect(authorities).not.toContain('Section 301 List 3')
    expect(expansion.rows).toHaveLength(1 + 3 + 3)
  })
})

describe('membershipsFor', () => {
  it('resolves a 10-digit code to its 6-digit membership entry', () => {
    expect(membershipsFor('8481.80.9005')).toEqual(['301-3'])
  })

  it('normalizes a code with no separators', () => {
    expect(membershipsFor('84818090')).toEqual(['301-3'])
  })

  it('finds a 6-digit-keyed entry from a 10-digit code using a custom table', () => {
    const customMemberships: Record<string, readonly ActionKey[]> = {
      '1234.56': ['301-1'],
    }
    expect(membershipsFor('1234.56.7890', customMemberships)).toEqual(['301-1'])
  })

  it('returns an empty list for an unknown code', () => {
    expect(membershipsFor('0000.00.0000')).toEqual([])
  })
})

describe('starterNote', () => {
  it('carries the version by default', () => {
    expect(starterNote()).toContain(TARIFF_STARTERS_VERSION)
  })
})
