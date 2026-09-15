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
const FIXABLE: readonly FixableBlockerItemKey[] = ['unposted_shipments', 'unposted_credit_memos']

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

  it('falls back to the account map when a role arrives with no ref', () => {
    const href = ITEM_REMEDIES.unmapped_role.href
    expect(href?.({ key: 'unmapped_role', label: 'x', remedy: '' })).toBe(
      '/app/accounting/settings/accounts'
    )
  })
})
