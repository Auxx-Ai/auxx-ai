// packages/lib/src/permissions/capabilities/get-capabilities.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserCapabilities } from './compose-user-capabilities'

/**
 * The `get-capabilities` seam (doc 19 step 4): the bound profile's definition
 * ceiling is cached RAW and slug-keyed inside `userCapabilities`, then resolved
 * to the canonical `entityDefinitionId` keyspace here — against the org-scoped
 * `resources` projection, which every `entity-def.*` event already invalidates.
 * That is what lets a def be created/archived/restored without touching the
 * user-scoped blob.
 */

const resources = [
  { id: 'res_contact', apiSlug: 'contact', entityDefinitionId: 'def_contact', entityType: null },
  { id: 'res_deal', apiSlug: 'deal', entityDefinitionId: 'def_deal', entityType: null },
  // Added to the org AFTER the profile ceiling was authored.
  { id: 'res_new', apiSlug: 'brand_new', entityDefinitionId: 'def_brand_new', entityType: null },
]

let userCapabilities: UserCapabilities

vi.mock('../../cache', () => ({
  getCachedUserCapabilities: vi.fn(async () => userCapabilities),
  getCachedResources: vi.fn(async () => resources),
  getCachedRestrictedEntityDefIds: vi.fn(async () => [] as string[]),
  getCachedRestrictedInstanceIds: vi.fn(async () => [] as string[]),
  getOrgCache: () => ({
    get: vi.fn(async () => ({ user_1: { role: 'USER', seatType: 'full' } })),
  }),
}))

const { getCapabilities } = await import('./get-capabilities')
const { PermissionKey } = await import('./registry')

const baseCaps = (ceilingDefs: UserCapabilities['ceilingDefs']): UserCapabilities => ({
  keys: [PermissionKey.recordsView, PermissionKey.recordsEdit],
  defAccess: {},
  instanceAccess: {},
  ceilingDefs,
})

describe('getCapabilities — profile definition-ceiling resolution', () => {
  beforeEach(() => {
    userCapabilities = baseCaps(null)
  })

  it('resolves stored apiSlugs to entityDefinitionIds and enforces `only`', async () => {
    userCapabilities = baseCaps({ mode: 'only', slugs: ['contact'] })
    const caps = await getCapabilities('user_1', 'org_1')
    expect(caps.canViewEntity('def_contact')).toBe(true)
    expect(caps.canViewEntity('def_deal')).toBe(false)
    // A definition created after the ceiling was authored is NOT in the
    // allow-list, so it is excluded — `only` fails closed (§0.13).
    expect(caps.canViewEntity('def_brand_new')).toBe(false)
    expect(caps.toClientCapabilities().ceilingDefs).toEqual({
      mode: 'only',
      defIds: ['def_contact'],
    })
  })

  it('`except` denies exactly the listed defs and admits later ones (fails open)', async () => {
    userCapabilities = baseCaps({ mode: 'except', slugs: ['deal'] })
    const caps = await getCapabilities('user_1', 'org_1')
    expect(caps.canViewEntity('def_deal')).toBe(false)
    expect(caps.canViewEntity('def_contact')).toBe(true)
    expect(caps.canViewEntity('def_brand_new')).toBe(true)
  })

  it('drops a slug that resolves to no live definition instead of throwing', async () => {
    // A deleted/renamed def leaves a dangling entry. It simply vanishes from the
    // set, which shrinks an `only` allow-list (stays closed) and an `except`
    // deny-list (stays open) — never a hard failure (§3 slug lifecycle).
    userCapabilities = baseCaps({ mode: 'only', slugs: ['contact', 'gone_forever'] })
    const caps = await getCapabilities('user_1', 'org_1')
    expect(caps.toClientCapabilities().ceilingDefs).toEqual({
      mode: 'only',
      defIds: ['def_contact'],
    })
  })

  it('a null ceiling in the cached blob resolves to no clamp at all', async () => {
    const caps = await getCapabilities('user_1', 'org_1')
    expect(caps.toClientCapabilities().ceilingDefs).toBeNull()
    expect(caps.canViewEntity('def_deal')).toBe(true)
  })
})
