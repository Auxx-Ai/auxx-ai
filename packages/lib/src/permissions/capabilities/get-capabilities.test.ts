// packages/lib/src/permissions/capabilities/get-capabilities.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserCapabilities } from './compose-user-capabilities'

/**
 * The `get-capabilities` seam: the cached `userCapabilities` blob is normalized
 * against the org-scoped `resources` projection here, NOT in the pure composer.
 *
 * Plan 20 removed the profile DEFINITION ceiling, which is what this file used to
 * cover (the slug→`entityDefinitionId` resolution existed only for it). What is
 * left — and what these cases pin — is the keyspace normalization that survives:
 * `ResourceAccess` rows are keyed inconsistently in practice (system defs by slug,
 * custom defs by CUID), so both `defAccess` and the org-wide restricted set must
 * be resolved through the SAME resolver `canViewEntity` normalizes its argument
 * with, or a slug-keyed grant silently never matches.
 */

const resources = [
  { id: 'res_contact', apiSlug: 'contact', entityDefinitionId: 'def_contact', entityType: null },
  { id: 'res_deal', apiSlug: 'deal', entityDefinitionId: 'def_deal', entityType: null },
]

let userCapabilities: UserCapabilities
let restrictedDefIds: string[]

vi.mock('../../cache', () => ({
  getCachedUserCapabilities: vi.fn(async () => userCapabilities),
  getCachedResources: vi.fn(async () => resources),
  getCachedRestrictedEntityDefIds: vi.fn(async () => restrictedDefIds),
  getCachedRestrictedInstanceIds: vi.fn(async () => [] as string[]),
  getOrgCache: () => ({
    get: vi.fn(async () => ({ user_1: { role: 'USER', seatType: 'full' } })),
  }),
}))

const { getCapabilities } = await import('./get-capabilities')
const { PermissionKey } = await import('./registry')

const baseCaps = (defAccess: Record<string, 'view' | 'edit' | 'admin' | 'none'> = {}) =>
  ({
    keys: [PermissionKey.recordsView, PermissionKey.recordsEdit],
    defAccess,
    instanceAccess: {},
  }) as UserCapabilities

describe('getCapabilities — keyspace normalization', () => {
  beforeEach(() => {
    userCapabilities = baseCaps()
    restrictedDefIds = []
  })

  it('resolves an apiSlug-keyed grant against an apiSlug-keyed restricted set', async () => {
    // Both sides arrive as `contact`; both must land on `def_contact` or the
    // grant never matches the restriction it is supposed to satisfy.
    userCapabilities = baseCaps({ contact: 'edit' })
    restrictedDefIds = ['contact', 'deal']
    const caps = await getCapabilities('user_1', 'org_1')
    expect(caps.canViewEntity('def_contact')).toBe(true)
    expect(caps.canEditEntity('contact')).toBe(true)
    // `deal` is restricted with no grant for this member → denied in every form.
    expect(caps.canViewEntity('def_deal')).toBe(false)
    expect(caps.canViewEntity('deal')).toBe(false)
  })

  it('an unrestricted def falls through to the base records level', async () => {
    const caps = await getCapabilities('user_1', 'org_1')
    expect(caps.canViewEntity('def_deal')).toBe(true)
    expect(caps.canEditEntity('def_deal')).toBe(true)
  })

  it('the client snapshot carries the normalized keyspace, not the raw blob keys', async () => {
    userCapabilities = baseCaps({ contact: 'admin' })
    restrictedDefIds = ['contact']
    const snapshot = (await getCapabilities('user_1', 'org_1')).toClientCapabilities()
    expect(snapshot.defAccess).toEqual({ def_contact: 'admin' })
    expect(snapshot.restrictedEntityDefIds).toEqual(['def_contact'])
  })
})
