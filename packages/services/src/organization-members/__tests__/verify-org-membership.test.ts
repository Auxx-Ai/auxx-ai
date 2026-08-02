// packages/services/src/organization-members/__tests__/verify-org-membership.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const findFirst = vi.fn()

vi.mock('@auxx/database', () => ({
  database: {
    query: {
      Organization: { findFirst: (...args: unknown[]) => findFirst(...args) },
    },
  },
}))

import { verifyOrgMembership } from '../verify-org-membership'

const USER_ID = 'user_1'
const ORG_ID = 'org_1'
const MEMBER = { id: 'member_1', userId: USER_ID, organizationId: ORG_ID, role: 'member' }

describe('verifyOrgMembership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the member for an active organization', async () => {
    findFirst.mockResolvedValue({ id: ORG_ID, disabledAt: null, members: [MEMBER] })

    const result = await verifyOrgMembership({ userId: USER_ID, organizationId: ORG_ID })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({ id: 'member_1' })
  })

  it('rejects a member of a disabled organization', async () => {
    findFirst.mockResolvedValue({
      id: ORG_ID,
      disabledAt: new Date(),
      disabledReason: 'non-payment',
      members: [MEMBER],
    })

    const result = await verifyOrgMembership({ userId: USER_ID, organizationId: ORG_ID })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'ORG_DISABLED',
      disabledReason: 'non-payment',
    })
  })

  it('rejects a non-member of an active organization', async () => {
    findFirst.mockResolvedValue({ id: ORG_ID, disabledAt: null, members: [] })

    const result = await verifyOrgMembership({ userId: USER_ID, organizationId: ORG_ID })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toMatchObject({ code: 'NOT_MEMBER' })
  })

  it('rejects a missing organization', async () => {
    findFirst.mockResolvedValue(undefined)

    const result = await verifyOrgMembership({ userId: USER_ID, organizationId: ORG_ID })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toMatchObject({ code: 'ORGANIZATION_NOT_FOUND' })
  })
})
