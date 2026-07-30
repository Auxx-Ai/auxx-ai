// apps/web/src/components/resources/hooks/use-viewable-resources.test.ts
//
// Plan v3/03 §6.1 (P5) — **the nav front door**.
//
// The seam that stood at `use-viewable-resources.ts:36` promised exactly this OR
// ("Phase 8 (§6.5): OR in a nonempty per-record instance-grant set for the def
// once per-record CRM access ships"). These tests pin the resulting behaviour
// end-to-end through the SHIPPED client resolver — `toResolvedRecordAccess` →
// `hasDefPresence` — rather than through a stub, so a change to either half has
// to break a test.
//
// The hook itself is a thin `filter(hasDefPresence)` over the resource store; the
// interesting half is the predicate, and it is asserted on the same
// `ClientCapabilities` wire shape the provider receives.

import type { ClientCapabilities } from '@auxx/lib/permissions/client'
import {
  Area,
  expandLevelsToKeys,
  hasDefPresence,
  Level,
  toResolvedRecordAccess,
} from '@auxx/lib/permissions/client'
import { describe, expect, it } from 'vitest'

/** A def the member has no def-level access to. */
const CLOSED_DEF = 'edf_deals0000000000000000000'
/** A second closed def, to prove the front door is per-def and not a flag. */
const OTHER_DEF = 'edf_orders000000000000000000'

/**
 * The wire snapshot for a member at `Records: None` — no def-level access to
 * anything — with `grantedDefIds` as the only variable.
 */
function snapshot(grantedDefIds?: Record<string, true>): ClientCapabilities {
  return {
    keys: expandLevelsToKeys({ [Area.records]: Level.None }),
    defAccess: {},
    restrictedEntityDefIds: [],
    role: 'USER',
    seatType: 'full',
    ...(grantedDefIds ? { grantedDefIds } : {}),
  }
}

describe('the nav entry appears with a grant and disappears without one', () => {
  it('no grants ⇒ the def is filtered OUT of the nav', () => {
    const caps = toResolvedRecordAccess(snapshot())
    expect(hasDefPresence(caps, CLOSED_DEF)).toBe(false)
  })

  it('one per-record grant ⇒ the def is IN the nav', () => {
    // This reverses plan 08 §4.7 ("deep-link only, no nav re-entry"), on purpose:
    // the support ticket that lock generated — "I shared it and they say they
    // can't find it" — costs more than this widening.
    const caps = toResolvedRecordAccess(snapshot({ [CLOSED_DEF]: true }))
    expect(hasDefPresence(caps, CLOSED_DEF)).toBe(true)
  })

  it('revoking the grant removes the nav entry again — no build-for-it needed', () => {
    // Revocation reaches the client as a recomposed capabilities blob with the
    // def gone (capabilities invalidation → realtime nudge → refetch). Nothing
    // in the hook has to know about revocation; the filter simply stops matching.
    const granted = toResolvedRecordAccess(snapshot({ [CLOSED_DEF]: true }))
    expect(hasDefPresence(granted, CLOSED_DEF)).toBe(true)
    const revoked = toResolvedRecordAccess(snapshot({}))
    expect(hasDefPresence(revoked, CLOSED_DEF)).toBe(false)
  })

  it('the front door is PER DEF — a grant on one def does not open another', () => {
    const caps = toResolvedRecordAccess(snapshot({ [CLOSED_DEF]: true }))
    expect(hasDefPresence(caps, CLOSED_DEF)).toBe(true)
    expect(hasDefPresence(caps, OTHER_DEF)).toBe(false)
  })

  it('an absent `grantedDefIds` closes the door — the fail-closed default', () => {
    // A capabilities blob composed before the field existed lacks it entirely.
    // That must read as "no front door", never as "unknown, so allow".
    const caps = toResolvedRecordAccess(snapshot())
    expect(caps.grantedDefIds).toEqual({})
    expect(hasDefPresence(caps, CLOSED_DEF)).toBe(false)
  })

  it('a member who can see the whole def keeps presence with no grants at all', () => {
    const viewer = toResolvedRecordAccess({
      ...snapshot(),
      keys: expandLevelsToKeys({ [Area.records]: Level.Read }),
    })
    expect(hasDefPresence(viewer, CLOSED_DEF)).toBe(true)
  })
})
