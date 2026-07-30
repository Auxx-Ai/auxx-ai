// packages/lib/src/dashboards/dashboard-privacy.test.ts

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { type DashboardShareRow, isPrivateFromBaseline } from './dashboard-queries'

const OWNER = 'u_owner'

const share = (over: Partial<DashboardShareRow>): DashboardShareRow => ({
  entityInstanceId: 'dash_1',
  granteeType: ResourceGranteeType.group,
  granteeId: 'g_1',
  ...over,
})

describe('isPrivateFromBaseline', () => {
  it('is private with no baseline row and nothing shared', () => {
    expect(isPrivateFromBaseline(undefined, [], OWNER)).toBe(true)
  })

  it('is private with an explicit none baseline', () => {
    expect(isPrivateFromBaseline('none', [], OWNER)).toBe(true)
  })

  it('is not private once the workspace baseline opens it', () => {
    expect(isPrivateFromBaseline('read', [], OWNER)).toBe(false)
  })

  it('stays private when the only grant is the owner’s own admin row', () => {
    const owned = [share({ granteeType: ResourceGranteeType.user, granteeId: OWNER })]
    expect(isPrivateFromBaseline('none', owned, OWNER)).toBe(true)
  })

  it('is NOT private when shared with a permission profile (19a #14)', () => {
    const shared = [share({ granteeType: ResourceGranteeType.profile, granteeId: 'prof_field' })]
    expect(isPrivateFromBaseline('none', shared, OWNER)).toBe(false)
  })

  it('is NOT private when shared with a group or another user', () => {
    expect(isPrivateFromBaseline(undefined, [share({})], OWNER)).toBe(false)
    expect(
      isPrivateFromBaseline(
        undefined,
        [share({ granteeType: ResourceGranteeType.user, granteeId: 'u_other' })],
        OWNER
      )
    ).toBe(false)
  })

  it('treats an ownerless dashboard’s user grants as real shares', () => {
    const shared = [share({ granteeType: ResourceGranteeType.user, granteeId: 'u_someone' })]
    expect(isPrivateFromBaseline(undefined, shared, null)).toBe(false)
  })
})
