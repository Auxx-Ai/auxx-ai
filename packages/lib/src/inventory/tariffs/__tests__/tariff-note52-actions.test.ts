// packages/lib/src/inventory/tariffs/__tests__/tariff-note52-actions.test.ts

import { describe, expect, it } from 'vitest'
import { ISO_COUNTRY_OPTIONS } from '../../../resources/registry/iso-country-options'
import { loadTariffMemberships } from '../tariff-301-memberships'
import { findHtsGeneral, loadHtsGeneral } from '../tariff-hts-general'
import { loadNote52Actions, loadTariffActions } from '../tariff-note52-actions'
import { expandTariffStarter, TARIFF_ACTIONS } from '../tariff-starters'

const ISO = new Set(ISO_COUNTRY_OPTIONS.map((option) => option.value))

describe('the generated note 52 actions', () => {
  it('names a real ISO country for every origin, exactly once', async () => {
    const actions = await loadNote52Actions()
    const countries = Object.values(actions).map((action) => action.country)
    for (const country of countries) expect(ISO.has(country), `${country}`).toBe(true)
    expect(new Set(countries).size).toBe(countries.length)
  })

  it('fans the EU headings out to all 27 member states', async () => {
    const actions = await loadNote52Actions()
    for (const member of ['DE', 'FR', 'IT', 'ES', 'NL', 'IE', 'PL', 'SE']) {
      expect(actions[`note52-${member.toLowerCase()}`], member).toBeDefined()
    }
  })

  it('carries the note 52(f) carve-out on every action', async () => {
    const actions = await loadNote52Actions()
    for (const [key, action] of Object.entries(actions)) {
      expect(action.excludedBy, key).toEqual(['232-metal'])
      expect(action.covers, key).toBe('all')
    }
  })

  it('gives every topUpTo action both of its two headings', async () => {
    const actions = await loadNote52Actions()
    for (const [key, action] of Object.entries(actions)) {
      if (action.rateBasis !== 'topUpTo') continue
      expect(action.chapter99CodeWhenZero, key).toBeDefined()
      expect(action.chapter99CodeWhenZero, key).not.toBe(action.chapter99Code)
    }
  })

  it('does not collide with a hand-kept action for the same country', async () => {
    const merged = await loadTariffActions()
    expect(Object.keys(merged).length).toBe(
      Object.keys(TARIFF_ACTIONS).length + Object.keys(await loadNote52Actions()).length
    )
    // `resolveTariffRate` folds on the authority alone, so a note 52 action must
    // not reuse a hand-kept authority for the same origin.
    const seen = new Set<string>()
    for (const action of Object.values(merged)) {
      const folded = `${action.country}::${action.authority.trim().toLowerCase()}`
      expect(seen.has(folded), folded).toBe(false)
      seen.add(folded)
    }
  })
})

describe('the topUpTo rate basis', () => {
  const expand = async (code: string, country: string) => {
    const [memberships, actions, catalogue] = await Promise.all([
      loadTariffMemberships(),
      loadTariffActions(),
      loadHtsGeneral(),
    ])
    const line = findHtsGeneral(catalogue.lines, code)
    if (!line) throw new Error(`no line for ${code}`)
    return { line, expansion: expandTariffStarter(line, country, memberships, { actions }) }
  }

  it('tops a below-threshold MFN rate up to the threshold, and no further', async () => {
    // 8481.80.90.05 is 2% MFN; Germany's threshold is 10.
    const { expansion } = await expand('8481.80.90.05', 'DE')
    const row = expansion.rows.find((r) => r.authority === 'HTS note 52 additional duty')
    expect(row?.rate).toBe(8)
    // MFN 2 + top-up 8 = the 10% the heading sets as the total.
    expect((expansion.rows[0]?.rate ?? 0) + (row?.rate ?? 0)).toBe(10)
  })

  it('emits 0 and the other heading when the MFN rate already clears it', async () => {
    const [memberships, actions] = await Promise.all([loadTariffMemberships(), loadTariffActions()])
    // A synthetic 25% line: well above every threshold in the table.
    const expansion = expandTariffStarter(['9999.99.9999', 25, 'x'], 'DE', memberships, { actions })
    const row = expansion.rows.find((r) => r.authority === 'HTS note 52 additional duty')
    expect(row?.rate).toBe(0)
    expect(row?.chapter99Code).toBe(actions['note52-de']?.chapter99CodeWhenZero)
  })
})

describe('the note 52(f) Section 232 carve-out', () => {
  it('drops note 52 for a code Section 232 already covers', async () => {
    // 7326.90.86.88 is the code on the Form 7501 behind task 61: it carries
    // Section 232, and the broker claimed 9903.05.90 to zero out note 52.
    const [memberships, actions, catalogue] = await Promise.all([
      loadTariffMemberships(),
      loadTariffActions(),
      loadHtsGeneral(),
    ])
    const line = findHtsGeneral(catalogue.lines, '7326.90.86.88')
    if (!line) throw new Error('no line')

    const expansion = expandTariffStarter(line, 'CN', memberships, { actions })
    const authorities = expansion.rows.map((r) => r.authority)
    expect(authorities).toContain('Section 232 metal and derivative articles')
    expect(authorities).not.toContain('HTS note 52 additional duty')
  })

  it('keeps note 52 for a CN code Section 232 does not cover', async () => {
    const [memberships, actions, catalogue] = await Promise.all([
      loadTariffMemberships(),
      loadTariffActions(),
      loadHtsGeneral(),
    ])
    const line = findHtsGeneral(catalogue.lines, '8481.80.90.05')
    if (!line) throw new Error('no line')

    const expansion = expandTariffStarter(line, 'CN', memberships, { actions })
    const row = expansion.rows.find((r) => r.authority === 'HTS note 52 additional duty')
    expect(row?.rate).toBe(12.5)
    expect(row?.chapter99Code).toBe('9903.05.31')
  })
})
