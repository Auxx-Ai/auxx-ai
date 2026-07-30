// packages/lib/src/inboxes/inbox-floor-feature-gate.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan v3/03 §7.6 (D9) — the inbox FLOOR gate moved onto
 * `FeatureKey.granularPermissions` with every other permission-layer gate, and
 * must still be its OWN function.
 *
 * The separation is load-bearing and documented on `assertInboxFloorFeature`:
 * `assertMailSharingFeature` keys on `lens != null && lens !== 'read'`, while the
 * RESTRICTED floor is `rung: 'none'` with a NULL lens — so folding the two
 * would let the paywall on "nobody in the org sees this inbox" quietly disappear.
 * §7.6 changes the KEY, not the shape, and this file pins both halves.
 */

const h = vi.hoisted(() => ({
  requireAccess: vi.fn(async () => {}),
}))

vi.mock('@auxx/database', () => ({
  // Drizzle columns are undefined under vitest (project memory); nothing here
  // touches a column, so a Proxy is enough to satisfy the module's imports.
  schema: new Proxy(
    {},
    { get: (_t, table) => new Proxy({}, { get: (_t2, col) => `${String(table)}.${String(col)}` }) }
  ),
  database: {},
}))
vi.mock('../cache/invalidate', () => ({ onCacheEvent: vi.fn(async () => {}) }))
vi.mock('../resource-access/resource-access-service', () => ({
  emitResourceAccessInstanceChanged: vi.fn(async () => {}),
}))
vi.mock('../permissions/feature-permission-service', () => ({
  FeaturePermissionService: class {
    requireAccess = h.requireAccess
  },
}))

const { assertInboxFloorFeature } = await import('./inbox-floor')
const { FeatureKey } = await import('../permissions/types')

const DB = {} as never
const ORG = 'org_1'
const USER = 'usr_1'

beforeEach(() => {
  h.requireAccess.mockReset().mockResolvedValue(undefined)
})

describe('assertInboxFloorFeature — the plan gate on a sub-`full` floor', () => {
  it.each([
    'none',
    'metadata',
    'identity',
  ] as const)('gates a `%s` floor on granularPermissions (§7.6)', async (lens) => {
    await assertInboxFloorFeature(DB, ORG, USER, lens)
    // The KEY, not merely "the gate ran": a retired key would allow every floor
    // on every plan, and an unseeded one would deny every floor on every plan.
    expect(h.requireAccess).toHaveBeenCalledWith(ORG, FeatureKey.granularPermissions)
  })

  it('still leaves the RESTRICTED floor covered here and nowhere else', () => {
    // The `none` case above is the reason this function exists separately from
    // `assertMailSharingFeature` — that gate tests the LENS, and a restricted floor
    // carries a null one.
    expect(FeatureKey).not.toHaveProperty('mailPermissions')
  })

  it('OVER-DENIAL CONTROL: raising back to `full` is never gated', async () => {
    await assertInboxFloorFeature(DB, ORG, USER, 'read')
    expect(h.requireAccess).not.toHaveBeenCalled()
  })

  it('OVER-DENIAL CONTROL: a system path with no user passes through', async () => {
    await assertInboxFloorFeature(DB, ORG, null, 'none')
    await assertInboxFloorFeature(DB, ORG, undefined, 'identity')
    expect(h.requireAccess).not.toHaveBeenCalled()
  })
})
