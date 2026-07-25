// apps/web/src/server/api/grantee-schema.test.ts

import { ResourceGranteeType, ResourceGranteeTypeValues } from '@auxx/database/enums'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCachedPermissionProfiles = vi.fn()
vi.mock('@auxx/lib/cache', () => ({
  getCachedPermissionProfiles: (...args: unknown[]) => getCachedPermissionProfiles(...args),
}))

import { assertProfileGranteesAuthorable, granteeTypeSchema } from './grantee-schema'

const humanProfile = { id: 'p_member', name: 'Member', appliesTo: 'member' }
const anyProfile = { id: 'p_any', name: 'Anyone', appliesTo: 'any' }
const agentProfile = { id: 'p_agent', name: 'Chat agent', appliesTo: 'agent' }

beforeEach(() => {
  getCachedPermissionProfiles.mockReset()
  getCachedPermissionProfiles.mockResolvedValue([humanProfile, anyProfile, agentProfile])
})

describe('granteeTypeSchema', () => {
  it('accepts the full ResourceGranteeType vocabulary — no kind is silently missing', () => {
    for (const value of ResourceGranteeTypeValues) {
      expect(granteeTypeSchema.parse(value)).toBe(value)
    }
  })

  it('accepts profile (doc 19 §0.1 / §0.28 — a profile is an additive grantee)', () => {
    expect(granteeTypeSchema.parse(ResourceGranteeType.profile)).toBe('profile')
  })

  it('still rejects a kind outside the enum', () => {
    expect(() => granteeTypeSchema.parse('everyone')).toThrow()
  })
})

describe('assertProfileGranteesAuthorable', () => {
  it('does nothing for the non-profile kinds (and costs no cache read)', async () => {
    for (const granteeType of ['group', 'user', 'team', 'role'] as const) {
      await expect(
        assertProfileGranteesAuthorable('org1', granteeType, ['whatever'])
      ).resolves.toBeUndefined()
    }
    expect(getCachedPermissionProfiles).not.toHaveBeenCalled()
  })

  it('allows a member-bindable profile', async () => {
    await expect(
      assertProfileGranteesAuthorable('org1', ResourceGranteeType.profile, ['p_member', 'p_any'])
    ).resolves.toBeUndefined()
  })

  it('rejects an unknown profile id — the row would restrict without granting', async () => {
    await expect(
      assertProfileGranteesAuthorable('org1', ResourceGranteeType.profile, ['p_gone'])
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects an agent profile — agents never read ResourceAccess', async () => {
    await expect(
      assertProfileGranteesAuthorable('org1', ResourceGranteeType.profile, ['p_agent'])
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects when ANY id in a set-style batch is unauthorable', async () => {
    await expect(
      assertProfileGranteesAuthorable('org1', ResourceGranteeType.profile, ['p_member', 'p_agent'])
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('is a no-op for an empty grant list (the "clear all rows" call)', async () => {
    await expect(
      assertProfileGranteesAuthorable('org1', ResourceGranteeType.profile, [])
    ).resolves.toBeUndefined()
    expect(getCachedPermissionProfiles).not.toHaveBeenCalled()
  })
})
