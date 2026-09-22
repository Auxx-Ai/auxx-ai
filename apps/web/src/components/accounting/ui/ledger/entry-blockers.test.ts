// apps/web/src/components/accounting/ui/ledger/entry-blockers.test.ts

import { describe, expect, it } from 'vitest'
import { type FixableBlockerItemKey, ITEM_REMEDIES } from './entry-blockers'

/**
 * The host's switch, written out by hand ON PURPOSE.
 *
 * 🛑 This list is the tripwire. `FixableBlockerItemKey` cannot be derived from
 * `ITEM_REMEDIES` (the map is annotated, so `fix: true` widens to `boolean`),
 * and an item marked `fix: true` that the host page does not mount a dialog for
 * renders a button that does nothing at all - a refusal offering a dead remedy
 * is worse than one offering none.
 */
const FIXABLE: readonly FixableBlockerItemKey[] = ['unposted_shipments']

describe('ITEM_REMEDIES', () => {
  it('gives every item exactly one remedy: a destination or a host control', () => {
    for (const [key, remedy] of Object.entries(ITEM_REMEDIES)) {
      expect(remedy.actionLabel.length, key).toBeGreaterThan(0)
      // Never both, never neither. Both would render two competing buttons on
      // one row; neither renders a row that names work and offers no way to it.
      expect(Boolean(remedy.href) !== Boolean(remedy.fix), key).toBe(true)
    }
  })

  it('marks exactly the items the host page mounts a dialog for', () => {
    const marked = Object.entries(ITEM_REMEDIES)
      .filter(([, remedy]) => remedy.fix)
      .map(([key]) => key)
      .sort()

    expect(marked).toEqual([...FIXABLE].sort())
  })

  it('sends an unmapped role to its own row in the account map', () => {
    // The `ref` is the role, and it is what makes the row's button different
    // from every other row's. Dropping it silently sends all of them to the
    // same unfiltered page.
    const href = ITEM_REMEDIES.unmapped_role.href
    expect(
      href?.({ key: 'unmapped_role', label: 'cogs_freight', remedy: '', ref: 'cogs_freight' })
    ).toBe('/app/accounting/settings/accounts?role=cogs_freight')
  })

  it('sends an export failure to the account it names on the Chart tab', () => {
    // 🛑 `?s=chart` as well as `?account=`. The page keeps one selection param
    // per tab, so an account id alone lands on Mapping and selects nothing.
    for (const key of ['unmapped_account', 'invalid_mapping'] as const) {
      expect(ITEM_REMEDIES[key].href?.({ key, label: 'COGS', remedy: '', ref: 'acct-1' })).toBe(
        '/app/accounting/settings/accounts?s=chart&account=acct-1'
      )
    }
  })

  it('falls back to the chart with no account to seed', () => {
    expect(
      ITEM_REMEDIES.unmapped_account.href?.({ key: 'unmapped_account', label: 'x', remedy: '' })
    ).toBe('/app/accounting/settings/accounts?s=chart')
  })

  it('falls back to the account map when a role arrives with no ref', () => {
    const href = ITEM_REMEDIES.unmapped_role.href
    expect(href?.({ key: 'unmapped_role', label: 'x', remedy: '' })).toBe(
      '/app/accounting/settings/accounts'
    )
  })
})
