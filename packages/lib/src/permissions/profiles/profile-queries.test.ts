// packages/lib/src/permissions/profiles/profile-queries.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Area, Level } from '../capabilities/registry'
import type { CachedPermissionProfile } from './types'

/**
 * The profile READ path — what every picker, grantee row and profile screen
 * resolves through. It must be query-free (org cache only), deterministically
 * ordered, and org-scoped: an id from another org is a 404, never a leak.
 */

const cachedProfiles = vi.fn<(orgId: string) => Promise<CachedPermissionProfile[]>>()

vi.mock('../../cache', () => ({
  getCachedPermissionProfiles: (orgId: string) => cachedProfiles(orgId),
}))

const {
  findPermissionProfile,
  getPermissionProfile,
  getProfileActorsByIds,
  listPermissionProfiles,
  listProfileActors,
  toProfileActor,
} = await import('./profile-queries')

function profile(overrides: Partial<CachedPermissionProfile>): CachedPermissionProfile {
  return {
    id: 'p_default',
    slug: 'custom',
    name: 'Custom',
    description: null,
    icon: null,
    seat: 'full',
    appliesTo: 'member',
    baseLevel: null,
    ceiling: null,
    agentPolicy: null,
    isSystem: false,
    updatedAt: null,
    ...overrides,
  }
}

const member = profile({ id: 'p_member', slug: 'member', name: 'Member', isSystem: true })
const admin = profile({ id: 'p_admin', slug: 'admin', name: 'Admin', isSystem: true })
const fieldTech = profile({
  id: 'p_field',
  slug: 'field_tech',
  name: 'Field tech',
  seat: 'worker',
  isSystem: true,
})
const agentProfile = profile({
  id: 'p_agent',
  slug: 'agent',
  name: 'Agent',
  appliesTo: 'agent',
  isSystem: true,
  agentPolicy: {
    areas: { default: 'read', overrides: {} },
    definitions: { default: 'none', overrides: {} },
    resourceDefault: 'none',
    resources: {},
  },
})
const zebra = profile({ id: 'p_zebra', slug: 'zebra', name: 'Zebra' })
const alpha = profile({
  id: 'p_alpha',
  slug: 'alpha',
  name: 'Alpha',
  description: 'A custom one',
  ceiling: { areas: { [Area.files]: Level.Read } },
})

beforeEach(() => {
  cachedProfiles.mockReset()
  cachedProfiles.mockResolvedValue([zebra, agentProfile, member, alpha, admin, fieldTech])
})

describe('listPermissionProfiles', () => {
  it('orders seeded profiles by the system ladder, then custom ones by name', async () => {
    const rows = await listPermissionProfiles('org_1')
    expect(rows.map((r) => r.slug)).toEqual([
      'admin',
      'member',
      'field_tech',
      'agent',
      'alpha',
      'zebra',
    ])
  })

  it('returns picker rows without the policy blobs', async () => {
    const [first] = await listPermissionProfiles('org_1')
    expect(Object.keys(first!).sort()).toEqual([
      'appliesTo',
      'baseLevel',
      'description',
      'icon',
      'id',
      'isSystem',
      'name',
      'seat',
      'slug',
    ])
  })

  it('reads only the caller org cache entry', async () => {
    await listPermissionProfiles('org_1')
    expect(cachedProfiles).toHaveBeenCalledWith('org_1')
  })

  it('filters by principal kind, keeping "any" profiles in both directions', async () => {
    cachedProfiles.mockResolvedValue([
      member,
      agentProfile,
      profile({ id: 'p_any', slug: 'any_one', name: 'Any', appliesTo: 'any' }),
    ])
    expect(
      (await listPermissionProfiles('org_1', { appliesTo: 'member' })).map((p) => p.id)
    ).toEqual(['p_member', 'p_any'])
    expect(
      (await listPermissionProfiles('org_1', { appliesTo: 'agent' })).map((p) => p.id)
    ).toEqual(['p_agent', 'p_any'])
  })

  it('filters by seat class', async () => {
    const rows = await listPermissionProfiles('org_1', { seat: 'worker' })
    expect(rows.map((p) => p.id)).toEqual(['p_field'])
  })
})

describe('getPermissionProfile', () => {
  it('carries the ceiling and agent policy', async () => {
    // `ceiling` is the narrowed, unauthored area clamp (plan 20 §2.a.3) — no def
    // half. It rides along so the detail shape mirrors what composition reads.
    const detail = await getPermissionProfile('org_1', 'p_alpha')
    expect(detail.ceiling).toEqual({ areas: { [Area.files]: Level.Read } })
    expect(detail.agentPolicy).toBeNull()

    const agentDetail = await getPermissionProfile('org_1', 'p_agent')
    expect(agentDetail.agentPolicy?.definitions.default).toBe('none')
  })

  it('throws NotFoundError for an id absent from this org cache (unknown or cross-org)', async () => {
    await expect(getPermissionProfile('org_1', 'p_other_org')).rejects.toThrow(
      'Permission profile not found'
    )
  })

  it('findPermissionProfile degrades to null instead of throwing', async () => {
    expect(await findPermissionProfile('org_1', 'p_other_org')).toBeNull()
  })
})

describe('profile actors', () => {
  it('maps a profile to a profile:<id> ActorId with its grantee-row fields', () => {
    expect(toProfileActor(alpha)).toEqual({
      actorId: 'profile:p_alpha',
      type: 'profile',
      name: 'Alpha',
      avatarUrl: null,
      profileId: 'p_alpha',
      slug: 'alpha',
      description: 'A custom one',
      seat: 'full',
      appliesTo: 'member',
      isSystem: false,
    })
  })

  it('excludes agent profiles from the picker feed — they are not sharing grantees', async () => {
    const actors = await listProfileActors('org_1')
    expect(actors.map((a) => a.slug)).not.toContain('agent')
  })

  it('still hydrates an agent profile by id so an existing row renders by name', async () => {
    const actors = await getProfileActorsByIds('org_1', ['p_agent', 'p_missing'])
    expect(actors.map((a) => a.actorId)).toEqual(['profile:p_agent'])
  })

  it('short-circuits an empty id batch without touching the cache', async () => {
    expect(await getProfileActorsByIds('org_1', [])).toEqual([])
    expect(cachedProfiles).not.toHaveBeenCalled()
  })
})
