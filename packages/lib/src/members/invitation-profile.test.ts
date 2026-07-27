// packages/lib/src/members/invitation-profile.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Audit rows written during a test, in order. */
const auditWrites: Array<Record<string, unknown>> = []

vi.mock('../audit-log', () => ({
  recordAudit: vi.fn(async (input: Record<string, unknown>) => {
    auditWrites.push(input)
    return { isErr: () => false }
  }),
}))

// inviteMember's side effects — none of them are what these tests assert on.
vi.mock('@auxx/config/server', () => ({ WEBAPP_URL: 'http://localhost:3000' }))
vi.mock('../events', () => ({ publisher: { publishLater: vi.fn() } }))
vi.mock('../jobs/email', () => ({ enqueueEmailJob: vi.fn(async () => {}) }))
vi.mock('./invitation-links', () => ({
  INVITATION_EXPIRATION_HOURS: 72,
  generateAcceptLink: () => 'http://localhost:3000/accept-invitation?token=t',
  generateSignupLink: () => 'http://localhost:3000/signup?token=t',
}))
vi.mock('./guards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./guards')>()),
  requireMemberManage: vi.fn(async () => {}),
}))
// The inviter's own membership — an OWNER, so the role-escalation guards pass
// and the seat/profile logic under test is what decides the outcome.
vi.mock('./member-queries', () => ({
  findMemberByUser: vi.fn(async () => ({ id: 'm_inviter', role: 'OWNER', seatType: 'full' })),
}))

/** Seat class `assertSeatAvailable` was called with, or null if never called. */
let seatCheckedWith: { organizationId: string; seatType: string } | null = null
vi.mock('./seat-limits', () => ({
  assertSeatAvailable: vi.fn(async (params: { organizationId: string; seatType: string }) => {
    seatCheckedWith = params
  }),
}))

import { loadInvitableProfile, resolveInvitationProfile } from './invitation-profile'
import { inviteMember } from './invitations'

const ORG = 'org_1'

type ProfileRow = {
  id: string
  slug: string
  name: string
  seat: 'full' | 'worker'
  appliesTo: 'member' | 'agent' | 'any'
  role: 'OWNER' | 'ADMIN' | 'USER'
  organizationId: string
}

const memberProfile: ProfileRow = {
  id: 'prof_member',
  slug: 'member',
  name: 'Member',
  seat: 'full',
  appliesTo: 'member',
  role: 'USER',
  organizationId: ORG,
}

const fieldTechProfile: ProfileRow = {
  ...memberProfile,
  id: 'prof_field',
  slug: 'field_tech',
  name: 'Field Tech',
  seat: 'worker',
}

/**
 * Chainable drizzle stub. `schema` is a Proxy with `undefined` columns under
 * vitest, so the queries are told apart by the *projection keys* they select —
 * those survive as plain object keys.
 */
function chain(rows: unknown[]) {
  const node: Record<string, unknown> = {}
  node.where = () => node
  node.orderBy = () => node
  // Every query under test ends in `.limit()`, so the chain never needs to be
  // awaitable on its own.
  node.limit = () => Promise.resolve(rows)
  return node
}

interface FakeRows {
  profile?: ProfileRow | null
  /** Metadata on the `member.invitation_profile_bound` audit row, if one exists. */
  boundAudit?: Record<string, unknown> | null
  /** Existing user rows the invite path finds for the email. */
  users?: Array<{ id: string; name: string }>
  /** Pending invitations the invite path finds for the email. */
  pending?: Array<{ id: string }>
}

function fakeDb(rows: FakeRows, sink: { inserted?: Record<string, unknown> } = {}): Database {
  const db = {
    select: (projection: Record<string, unknown> = {}) => ({
      from: () => {
        const keys = Object.keys(projection)
        if (keys.includes('metadata')) {
          return chain(rows.boundAudit ? [{ metadata: rows.boundAudit }] : [])
        }
        if (keys.includes('appliesTo')) return chain(rows.profile ? [rows.profile] : [])
        if (keys.includes('name')) return chain(rows.users ?? [])
        return chain(rows.pending ?? [])
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        sink.inserted = values
        return {
          returning: () => Promise.resolve([{ id: 'inv_1' }]),
        }
      },
    }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  }
  return db as unknown as Database
}

const invitation = {
  id: 'inv_1',
  organizationId: ORG,
  email: 'new@example.com',
  permissionProfileId: memberProfile.id,
}

beforeEach(() => {
  auditWrites.length = 0
  seatCheckedWith = null
})

describe('loadInvitableProfile', () => {
  it('returns the profile with its declared seat class', async () => {
    const profile = await loadInvitableProfile(
      { organizationId: ORG, permissionProfileId: memberProfile.id },
      fakeDb({ profile: memberProfile })
    )
    expect(profile).toMatchObject({ id: 'prof_member', slug: 'member', seat: 'full' })
  })

  it('throws when the profile does not exist', async () => {
    await expect(
      loadInvitableProfile({ organizationId: ORG, permissionProfileId: 'gone' }, fakeDb({}))
    ).rejects.toThrow(/no longer exists/i)
  })

  it('refuses a profile owned by another organization — an FK does not check the org', async () => {
    await expect(
      loadInvitableProfile(
        { organizationId: ORG, permissionProfileId: memberProfile.id },
        fakeDb({ profile: { ...memberProfile, organizationId: 'org_other' } })
      )
    ).rejects.toThrow(/another organization/i)
  })

  it('refuses an agent-only profile', async () => {
    await expect(
      loadInvitableProfile(
        { organizationId: ORG, permissionProfileId: 'prof_agent' },
        fakeDb({ profile: { ...memberProfile, id: 'prof_agent', appliesTo: 'agent' } })
      )
    ).rejects.toThrow(/agents, not members/i)
  })
})

describe('resolveInvitationProfile', () => {
  it('carries a valid binding onto the member without flagging anything', async () => {
    const resolved = await resolveInvitationProfile(
      { invitation, role: 'USER', seatType: 'full' },
      fakeDb({ profile: memberProfile })
    )
    expect(resolved).toEqual({ permissionProfileId: 'prof_member', fallback: null })
    expect(auditWrites).toHaveLength(0)
  })

  it('flags a profile deleted before acceptance and falls back to the system template', async () => {
    const resolved = await resolveInvitationProfile(
      {
        // The FK nulled the column when the profile row was deleted.
        invitation: { ...invitation, permissionProfileId: null },
        role: 'USER',
        seatType: 'full',
      },
      fakeDb({ boundAudit: { permissionProfileId: 'prof_gone', permissionProfileSlug: 'support' } })
    )

    expect(resolved.permissionProfileId).toBeNull()
    expect(resolved.fallback).toEqual({
      reason: 'deleted',
      boundProfileId: 'prof_gone',
      boundProfileSlug: 'support',
      systemProfileSlug: 'member',
    })
    expect(auditWrites).toHaveLength(1)
    expect(auditWrites[0]).toMatchObject({
      action: 'member.invitation_profile_missing',
      targetType: 'OrganizationInvitation',
      targetId: 'inv_1',
      visibility: 'admin',
    })
  })

  it('falls back to field_tech for a worker seat', async () => {
    const resolved = await resolveInvitationProfile(
      {
        invitation: { ...invitation, permissionProfileId: null },
        role: 'USER',
        seatType: 'worker',
      },
      fakeDb({ boundAudit: { permissionProfileId: 'prof_gone' } })
    )
    expect(resolved.fallback?.systemProfileSlug).toBe('field_tech')
  })

  it('does NOT flag an invitation that never bound a profile', async () => {
    const resolved = await resolveInvitationProfile(
      { invitation: { ...invitation, permissionProfileId: null }, role: 'USER', seatType: 'full' },
      fakeDb({ boundAudit: null })
    )
    expect(resolved).toEqual({ permissionProfileId: null, fallback: null })
    expect(auditWrites).toHaveLength(0)
  })

  it('flags a dangling binding whose profile row is gone', async () => {
    const resolved = await resolveInvitationProfile(
      { invitation, role: 'USER', seatType: 'full' },
      fakeDb({ profile: null })
    )
    expect(resolved.fallback).toMatchObject({ reason: 'dangling', boundProfileId: 'prof_member' })
    expect(auditWrites).toHaveLength(1)
  })

  it('flags a binding that points at another organization', async () => {
    const resolved = await resolveInvitationProfile(
      { invitation, role: 'USER', seatType: 'full' },
      fakeDb({ profile: { ...memberProfile, organizationId: 'org_other' } })
    )
    expect(resolved.permissionProfileId).toBeNull()
    expect(resolved.fallback?.reason).toBe('foreign_org')
  })

  it('flags an agent-only profile rather than applying it to a human', async () => {
    const resolved = await resolveInvitationProfile(
      { invitation, role: 'USER', seatType: 'full' },
      fakeDb({ profile: { ...memberProfile, appliesTo: 'agent' } })
    )
    expect(resolved.fallback?.reason).toBe('agent_profile')
  })

  it('flags a profile whose seat class disagrees with the invitation', async () => {
    const resolved = await resolveInvitationProfile(
      { invitation, role: 'USER', seatType: 'full' },
      fakeDb({ profile: { ...memberProfile, seat: 'worker' } })
    )
    expect(resolved.fallback?.reason).toBe('seat_mismatch')
  })

  it('resolves the admin template for an ADMIN invitation', async () => {
    const resolved = await resolveInvitationProfile(
      { invitation, role: 'ADMIN', seatType: 'full' },
      fakeDb({ profile: null })
    )
    expect(resolved.fallback?.systemProfileSlug).toBe('admin')
  })
})

describe('inviteMember with a permission profile', () => {
  const base = {
    organizationId: ORG,
    inviterUserId: 'u_admin',
    inviterName: 'Admin',
    organizationName: 'Acme',
    email: 'new@example.com',
  }

  it("checks the cap against the PROFILE's seat class, not the caller's seatType", async () => {
    const sink: { inserted?: Record<string, unknown> } = {}
    await inviteMember(
      {
        ...base,
        role: 'USER',
        // A stale/absent caller value must not win over the profile's declaration.
        seatType: 'full',
        permissionProfileId: fieldTechProfile.id,
      },
      fakeDb({ profile: fieldTechProfile }, sink)
    )

    expect(seatCheckedWith).toEqual({ organizationId: ORG, seatType: 'worker' })
    expect(sink.inserted).toMatchObject({
      seatType: 'worker',
      permissionProfileId: 'prof_field',
    })
  })

  it('persists the profile on the invitation and records the binding for later', async () => {
    const sink: { inserted?: Record<string, unknown> } = {}
    await inviteMember(
      { ...base, role: 'USER', permissionProfileId: memberProfile.id },
      fakeDb({ profile: memberProfile }, sink)
    )

    expect(sink.inserted).toMatchObject({ permissionProfileId: 'prof_member', seatType: 'full' })
    expect(auditWrites).toHaveLength(1)
    expect(auditWrites[0]).toMatchObject({
      action: 'member.invitation_profile_bound',
      targetType: 'OrganizationInvitation',
      targetId: 'inv_1',
      metadata: expect.objectContaining({ permissionProfileId: 'prof_member' }),
    })
  })

  it('derives the rank from the profile — a caller-supplied ADMIN role is ignored (plan 21 §2.a.3)', async () => {
    const sink: { inserted?: Record<string, unknown> } = {}
    await inviteMember(
      { ...base, role: 'ADMIN', permissionProfileId: fieldTechProfile.id },
      fakeDb({ profile: fieldTechProfile }, sink)
    )

    // The field-tech profile declares USER, so the invite succeeds AS USER —
    // the worker ⇒ USER refusal is unreachable when a profile is bound, because
    // no profile can declare `seat: 'worker'` with a non-USER rank.
    expect(sink.inserted).toMatchObject({
      role: 'USER',
      seatType: 'worker',
      permissionProfileId: 'prof_field',
    })
  })

  it('still rejects a profileless worker-seat invite carrying ADMIN — the server invariant survives', async () => {
    await expect(
      inviteMember({ ...base, role: 'ADMIN', seatType: 'worker' }, fakeDb({}))
    ).rejects.toThrow(/Field seats are limited to the Member role/i)
    expect(seatCheckedWith).toBeNull()
  })

  it('leaves the binding null and still caps the seat when no profile is chosen', async () => {
    const sink: { inserted?: Record<string, unknown> } = {}
    await inviteMember({ ...base, role: 'USER', seatType: 'worker' }, fakeDb({}, sink))

    expect(seatCheckedWith).toEqual({ organizationId: ORG, seatType: 'worker' })
    expect(sink.inserted).toMatchObject({ seatType: 'worker', permissionProfileId: null })
    expect(auditWrites).toHaveLength(0)
  })
})
