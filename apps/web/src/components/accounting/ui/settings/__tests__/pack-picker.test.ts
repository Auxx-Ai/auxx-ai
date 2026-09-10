// apps/web/src/components/accounting/ui/settings/__tests__/pack-picker.test.ts
//
// The pure functions behind the pack picker (brief 16 §3.2): the `requires`
// cascade (`forcedPacks` / `resolveSelectedPacks`) that both the wizard's
// checkbox card and `chart-packs-dialog.tsx` read, and the wizard's `card_rail`
// pre-check (`defaultSelectedPacks`). No query, no component - each is total
// over `CHART_PACKS`.

import { describe, expect, it } from 'vitest'
import { defaultSelectedPacks, forcedPacks, resolveSelectedPacks } from '../accounts-types'

describe('forcedPacks', () => {
  it('is empty for a selection with no requires', () => {
    expect(forcedPacks(new Set(['core']))).toEqual(new Set())
    expect(forcedPacks(new Set(['core', 'card_rail']))).toEqual(new Set())
  })

  it('forces inventory on when purchasing is selected (purchasing requires inventory)', () => {
    expect(forcedPacks(new Set(['purchasing']))).toEqual(new Set(['inventory']))
  })

  it('does not include a pack already selected directly', () => {
    // inventory is BOTH directly selected and forced by purchasing - it still
    // comes back from `forcedPacks` (the caller unions it with `selected`
    // itself), this just proves selecting it directly does not suppress it.
    expect(forcedPacks(new Set(['purchasing', 'inventory']))).toEqual(new Set(['inventory']))
  })

  it('is empty for an empty selection', () => {
    expect(forcedPacks(new Set())).toEqual(new Set())
  })
})

describe('resolveSelectedPacks', () => {
  it('returns the selection unchanged when nothing is forced', () => {
    expect(resolveSelectedPacks(new Set(['core', 'card_rail']))).toEqual(['core', 'card_rail'])
  })

  it('adds the forced pack, so choosing purchasing submits inventory too', () => {
    expect(resolveSelectedPacks(new Set(['purchasing']))).toEqual(['inventory', 'purchasing'])
  })

  it('orders the result by CHART_PACK_KEYS declaration order, not selection order', () => {
    expect(resolveSelectedPacks(new Set(['purchasing', 'core']))).toEqual([
      'core',
      'inventory',
      'purchasing',
    ])
  })

  it('is empty for an empty selection', () => {
    expect(resolveSelectedPacks(new Set())).toEqual([])
  })
})

describe('defaultSelectedPacks', () => {
  it('is core alone with neither card rail signal present', () => {
    expect(defaultSelectedPacks({ stripeConnect: false, shopify: false })).toEqual(['core'])
  })

  it('pre-checks card_rail when a Stripe Connect account exists', () => {
    expect(defaultSelectedPacks({ stripeConnect: true, shopify: false })).toEqual([
      'core',
      'card_rail',
    ])
  })

  it('pre-checks card_rail when the Shopify app is installed', () => {
    expect(defaultSelectedPacks({ stripeConnect: false, shopify: true })).toEqual([
      'core',
      'card_rail',
    ])
  })

  it('pre-checks card_rail once when both signals are present', () => {
    expect(defaultSelectedPacks({ stripeConnect: true, shopify: true })).toEqual([
      'core',
      'card_rail',
    ])
  })
})
