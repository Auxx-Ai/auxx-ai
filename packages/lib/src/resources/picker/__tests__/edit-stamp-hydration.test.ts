// packages/lib/src/resources/picker/__tests__/edit-stamp-hydration.test.ts
//
// 74-D1 §1.2.1: the `edit` stamp rides `record.getByIds` beside `_access`, from
// ONE batched read per response. `null` — not absent — is the answer for a row
// with no open edit, because absent is what a non-stamping lane leaves and every
// reader treats that as locked.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const stamps = vi.hoisted(() => ({
  read: vi.fn(async () => new Map<string, { openedAt: string; byUserId: string }>()),
}))

vi.mock('../../../identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../identity')>()
  return { ...actual, getRecordIdentitiesForRecords: vi.fn(async () => new Map()) }
})

// A FULL factory, not `importOriginal` + spread — see the note in
// `article-admit.test.ts` about the cache barrel re-entering mid-factory.
vi.mock('../../../cache', () => ({
  getCachedKnowledgeBases: vi.fn(async () => []),
  getCachedEntityDefId: vi.fn(async () => undefined),
  getCachedResource: vi.fn(async () => null),
  getCachedResources: vi.fn(async () => []),
  getOrgCache: vi.fn(() => ({ get: vi.fn(async () => ({})) })),
}))

vi.mock('../../../entity-instances/edit-snapshot', () => ({ readEditStamps: stamps.read }))

import type { RecordId } from '@auxx/types/resource'
import { RecordPickerService } from '../record-picker-service'
import type { RecordPickerItem } from '../types'

const ORG = 'org_abgwpa1l81reht2zmwrcih'
const USER = 'usr_member00000000000000'
const OPEN = 'art_open0000000000000000'
const QUIET = 'art_quiet000000000000000'

function rows(ids: string[]): RecordPickerItem[] {
  return ids.map((id) => ({
    id,
    recordId: `article:${id}` as RecordId,
    displayName: id,
    data: { id },
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  })) as RecordPickerItem[]
}

async function hydrate(ids: string[]) {
  const service = new RecordPickerService(ORG, USER, {} as never, undefined)
  ;(service as unknown as { fetchResourcesFromDb: unknown }).fetchResourcesFromDb = vi.fn(
    async () => ({ items: rows(ids), nextCursor: null, hasMore: false })
  )
  return service.getResourcesByIds(ids.map((id) => `article:${id}` as RecordId))
}

beforeEach(() => {
  vi.clearAllMocks()
  stamps.read.mockResolvedValue(new Map())
})

describe('the edit stamp on getByIds', () => {
  it('stamps an open edit and `null` for a row without one, in one read', async () => {
    stamps.read.mockResolvedValue(
      new Map([[OPEN, { openedAt: '2026-09-19T10:00:00.000Z', byUserId: USER }]])
    )

    const result = await hydrate([OPEN, QUIET])

    expect(result[`article:${OPEN}` as RecordId]?.edit).toEqual({
      openedAt: '2026-09-19T10:00:00.000Z',
      byUserId: USER,
    })
    expect(result[`article:${QUIET}` as RecordId]?.edit).toBeNull()
    expect(stamps.read).toHaveBeenCalledTimes(1)
    expect((stamps.read.mock.calls[0] as unknown[])?.[2]).toEqual([OPEN, QUIET])
  })

  it('stamps `null` on every row when nothing is being edited', async () => {
    const result = await hydrate([OPEN, QUIET])
    expect(Object.values(result).map((item) => item.edit)).toEqual([null, null])
  })
})
