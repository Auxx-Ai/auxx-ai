// packages/lib/src/snippets/__tests__/snippet-sharing.test.ts

import type { Database } from '@auxx/database'
import { ResourceGranteeType, ResourcePermission, SnippetSharingType } from '@auxx/database/enums'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResourceAccessInfo } from '../../resource-access/types'

// Typed rest params so `mock.calls[n][i]` is indexable (an argless `vi.fn` types
// every recorded call as the empty tuple).
const setInstanceAccess = vi.fn(async (..._args: unknown[]) => {})
vi.mock('../../resource-access', () => ({
  setInstanceAccess: (...a: unknown[]) => setInstanceAccess(...a),
  getInstanceAccess: vi.fn(async () => []),
}))

const getCachedUserGroupIds = vi.fn(async () => [] as string[])
vi.mock('../../cache', () => ({
  getCachedUserGroupIds: (...a: unknown[]) => getCachedUserGroupIds(...(a as [])),
}))

const resolveUserProfileId = vi.fn(async () => null as string | null)
vi.mock('../../resource-access/grantee-resolution', () => ({
  resolveUserProfileId: (...a: unknown[]) => resolveUserProfileId(...(a as [])),
}))

import {
  SNIPPET_SHARE_GRANTEE_TYPES,
  type SnippetShareInput,
  setSnippetSharing,
} from '../snippet-mutations'
import { resolveCanEdit } from '../snippet-permissions'

function makeDb(snippet: unknown, sink: { deleted: number; sharingTypeSet: unknown[] }) {
  const tx = {
    update: () => ({
      set: (payload: Record<string, unknown>) => ({
        where: async () => {
          if ('sharingType' in payload) sink.sharingTypeSet.push(payload.sharingType)
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        sink.deleted += 1
      },
    }),
  }
  return {
    query: { Snippet: { findFirst: vi.fn(async () => snippet) } },
    transaction: async (cb: (t: typeof tx) => Promise<void>) => cb(tx),
  } as unknown as Database
}

describe('resolveCanEdit', () => {
  const share = (over: Partial<ResourceAccessInfo>): ResourceAccessInfo =>
    ({
      id: 'ra_1',
      entityDefinitionId: 'snippet',
      entityInstanceId: 's1',
      granteeType: ResourceGranteeType.group,
      granteeId: 'g1',
      permission: ResourcePermission.edit,
      lens: null,
      createdAt: new Date(),
      ...over,
    }) as ResourceAccessInfo

  beforeEach(() => {
    getCachedUserGroupIds.mockResolvedValue([])
    resolveUserProfileId.mockResolvedValue(null)
  })

  it('grants edit through the user’s bound permission profile (19a #12)', async () => {
    resolveUserProfileId.mockResolvedValue('prof_field')
    const can = await resolveCanEdit('org1', 'u2', 'u1', [
      share({ granteeType: ResourceGranteeType.profile, granteeId: 'prof_field' }),
    ])
    expect(can).toBe(true)
    expect(resolveUserProfileId).toHaveBeenCalledWith('org1', 'u2')
  })

  it('denies a profile grant the user does not hold', async () => {
    resolveUserProfileId.mockResolvedValue('prof_member')
    const can = await resolveCanEdit('org1', 'u2', 'u1', [
      share({ granteeType: ResourceGranteeType.profile, granteeId: 'prof_field' }),
    ])
    expect(can).toBe(false)
  })

  it('ignores a profile grant that is only VIEW', async () => {
    resolveUserProfileId.mockResolvedValue('prof_field')
    const can = await resolveCanEdit('org1', 'u2', 'u1', [
      share({
        granteeType: ResourceGranteeType.profile,
        granteeId: 'prof_field',
        permission: ResourcePermission.view,
      }),
    ])
    expect(can).toBe(false)
  })

  it('does not resolve a profile at all when no profile share exists', async () => {
    getCachedUserGroupIds.mockResolvedValue(['g1'])
    const can = await resolveCanEdit('org1', 'u2', 'u1', [share({})])
    expect(can).toBe(true)
    expect(resolveUserProfileId).not.toHaveBeenCalled()
  })
})

describe('setSnippetSharing', () => {
  it('rejects when the snippet is missing or not owned by the user', async () => {
    const db = makeDb(undefined, { deleted: 0, sharingTypeSet: [] })
    const result = await setSnippetSharing(db, 'org1', 'u1', 's1', SnippetSharingType.PRIVATE, [])
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.statusCode).toBe(404)
    expect(setInstanceAccess).not.toHaveBeenCalled()
  })

  it('replaces group, user and profile grants for GROUPS sharing', async () => {
    setInstanceAccess.mockClear()
    const sink = { deleted: 0, sharingTypeSet: [] as unknown[] }
    const db = makeDb({ id: 's1', createdById: 'u1' }, sink)
    const result = await setSnippetSharing(db, 'org1', 'u1', 's1', SnippetSharingType.GROUPS, [
      { granteeType: 'group', granteeId: 'g1', permission: 'EDIT' },
      { granteeType: 'user', granteeId: 'u2', permission: 'VIEW' },
      { granteeType: 'profile', granteeId: 'p1', permission: 'EDIT' },
    ])
    expect(result.isOk()).toBe(true)
    expect(sink.sharingTypeSet).toEqual([SnippetSharingType.GROUPS])
    expect(setInstanceAccess).toHaveBeenCalledTimes(SNIPPET_SHARE_GRANTEE_TYPES.length)

    const [groupCall, userCall, profileCall] = setInstanceAccess.mock.calls
    expect(groupCall[2]).toBe(ResourceGranteeType.group)
    expect(groupCall[3]).toEqual([{ granteeId: 'g1', permission: ResourcePermission.edit }])
    expect(userCall[2]).toBe(ResourceGranteeType.user)
    expect(userCall[3]).toEqual([{ granteeId: 'u2', permission: ResourcePermission.view }])
    expect(profileCall[2]).toBe(ResourceGranteeType.profile)
    expect(profileCall[3]).toEqual([{ granteeId: 'p1', permission: ResourcePermission.edit }])
    expect(sink.deleted).toBe(0)
  })

  it('clears every supported grantee kind, including the ones with no incoming share', async () => {
    // The replace-per-type semantics mean a kind that is never passed to
    // `setInstanceAccess` keeps its stored rows forever (19a site 28).
    setInstanceAccess.mockClear()
    const sink = { deleted: 0, sharingTypeSet: [] as unknown[] }
    const db = makeDb({ id: 's1', createdById: 'u1' }, sink)
    const result = await setSnippetSharing(db, 'org1', 'u1', 's1', SnippetSharingType.GROUPS, [
      { granteeType: 'user', granteeId: 'u2', permission: 'VIEW' },
    ])
    expect(result.isOk()).toBe(true)
    expect(setInstanceAccess.mock.calls.map((c) => c[2])).toEqual([...SNIPPET_SHARE_GRANTEE_TYPES])
    for (const call of setInstanceAccess.mock.calls) {
      if (call[2] !== ResourceGranteeType.user) expect(call[3]).toEqual([])
    }
  })

  it('rejects a grantee kind it cannot store instead of dropping it silently', async () => {
    setInstanceAccess.mockClear()
    const sink = { deleted: 0, sharingTypeSet: [] as unknown[] }
    const db = makeDb({ id: 's1', createdById: 'u1' }, sink)
    const result = await setSnippetSharing(db, 'org1', 'u1', 's1', SnippetSharingType.GROUPS, [
      // `role`/`team` are outside SNIPPET_SHARE_GRANTEE_TYPES — a snippet says
      // "everyone" with SnippetSharingType.ORGANIZATION instead.
      { granteeType: ResourceGranteeType.role, granteeId: 'org_member', permission: 'VIEW' },
    ] as unknown as SnippetShareInput[])
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.statusCode).toBe(400)
    expect(setInstanceAccess).not.toHaveBeenCalled()
  })

  it('clears all grants when switching away from GROUPS sharing', async () => {
    setInstanceAccess.mockClear()
    const sink = { deleted: 0, sharingTypeSet: [] as unknown[] }
    const db = makeDb({ id: 's1', createdById: 'u1' }, sink)
    const result = await setSnippetSharing(
      db,
      'org1',
      'u1',
      's1',
      SnippetSharingType.ORGANIZATION,
      undefined
    )
    expect(result.isOk()).toBe(true)
    expect(setInstanceAccess).not.toHaveBeenCalled()
    expect(sink.deleted).toBe(1)
  })
})
