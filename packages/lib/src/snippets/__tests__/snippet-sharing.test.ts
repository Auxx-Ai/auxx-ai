// packages/lib/src/snippets/__tests__/snippet-sharing.test.ts

import type { Database } from '@auxx/database'
import { ResourceGranteeType, ResourcePermission, SnippetSharingType } from '@auxx/database/enums'
import { describe, expect, it, vi } from 'vitest'

const setInstanceAccess = vi.fn(async () => {})
vi.mock('../../resource-access', () => ({
  setInstanceAccess: (...a: unknown[]) => setInstanceAccess(...a),
  getInstanceAccess: vi.fn(async () => []),
}))

import { setSnippetSharing } from '../snippet-mutations'

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

describe('setSnippetSharing', () => {
  it('rejects when the snippet is missing or not owned by the user', async () => {
    const db = makeDb(undefined, { deleted: 0, sharingTypeSet: [] })
    const result = await setSnippetSharing(db, 'org1', 'u1', 's1', SnippetSharingType.PRIVATE, [])
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.statusCode).toBe(404)
    expect(setInstanceAccess).not.toHaveBeenCalled()
  })

  it('replaces group and user grants for GROUPS sharing', async () => {
    setInstanceAccess.mockClear()
    const sink = { deleted: 0, sharingTypeSet: [] as unknown[] }
    const db = makeDb({ id: 's1', createdById: 'u1' }, sink)
    const result = await setSnippetSharing(db, 'org1', 'u1', 's1', SnippetSharingType.GROUPS, [
      { granteeType: 'group', granteeId: 'g1', permission: 'EDIT' },
      { granteeType: 'user', granteeId: 'u2', permission: 'VIEW' },
    ])
    expect(result.isOk()).toBe(true)
    expect(sink.sharingTypeSet).toEqual([SnippetSharingType.GROUPS])
    expect(setInstanceAccess).toHaveBeenCalledTimes(2)

    const [groupCall, userCall] = setInstanceAccess.mock.calls
    expect(groupCall[2]).toBe(ResourceGranteeType.group)
    expect(groupCall[3]).toEqual([{ granteeId: 'g1', permission: ResourcePermission.edit }])
    expect(userCall[2]).toBe(ResourceGranteeType.user)
    expect(userCall[3]).toEqual([{ granteeId: 'u2', permission: ResourcePermission.view }])
    expect(sink.deleted).toBe(0)
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
