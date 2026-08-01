// packages/lib/src/resources/picker/system-table-instance-access.test.ts
//
// The per-row gate for SYSTEM-TABLE instance-access resources (`kb`, `dataset`)
// on the hydration path — `RecordPickerService.getResourcesByIds`.
//
// Why this file exists: `recordScope` answers `{ arm: 'all' }` for anything in
// `RESOURCE_TABLE_MAP`, because a system table has no `ResourceAccess` rows to
// correlate against in SQL. For an ordinary system table (`user`, `article`)
// that is the truth. For `kb` and `dataset` it is NOT — their policy is real, it
// just lives in the composed capability blob — so `admitSystemRows` filters the
// fetched rows through `canViewInstance` and stamps `_access` from the rung.
// Without it, admitting `kb` at `record.getByIds` would hand every member the
// org's entire knowledge-base list.
//
// The table fetch itself is stubbed rather than faked through Drizzle: under
// this package's Vitest config `schema`'s columns are `undefined`, so
// `fetchResourcesDirect`'s `orderBy`/`requireColumn` cannot run
// (`project_drizzle_columns_undefined_in_vitest`). What is under test is the
// gate and its wiring, not the SELECT.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../identity')>()
  return { ...actual, getRecordIdentitiesForRecords: vi.fn(async () => new Map()) }
})

import type { RecordId } from '@auxx/types/resource'
import { RecordPickerService } from './record-picker-service'
import type { RecordPickerItem } from './types'

const ORG = 'org_cuid000000000000000000000'
const USER = 'usr_cuid000000000000000000000'

/** Three KBs in the org — only one of which this member holds anything on. */
const VISIBLE_KB = 'kb_visible0000000000000000'
const HIDDEN_KB = 'kb_hidden00000000000000000'
const OTHER_HIDDEN_KB = 'kb_hidden20000000000000000'

/** What the KnowledgeBase table returns for the batch, before any gating. */
function tableRows(ids: string[], tableId = 'kb'): RecordPickerItem[] {
  return ids.map((id) => ({
    id,
    recordId: `${tableId}:${id}` as RecordId,
    displayName: `KB ${id}`,
    data: { id },
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  })) as RecordPickerItem[]
}

/**
 * A `CapabilityView` stub exposing only the three instance predicates the gate
 * reads. `rungs` maps instanceId → the highest rung the member holds; an id
 * that is absent is not viewable at all.
 */
function view(rungs: Record<string, 'read' | 'edit' | 'admin'>) {
  const at = (id: string) => rungs[id]
  return {
    canViewInstance: (_key: string, id: string) => at(id) !== undefined,
    canEditInstance: (_key: string, id: string) => at(id) === 'edit' || at(id) === 'admin',
    canAdminInstance: (_key: string, id: string) => at(id) === 'admin',
    canViewEntity: () => true,
    hasRecordGrantsOn: () => false,
  } as never
}

/**
 * Run a by-ids batch with the table fetch stubbed to `rows`, and report both the
 * admitted result and what the stub was asked for.
 */
async function hydrate(
  recordIds: string[],
  rows: RecordPickerItem[],
  capabilities: unknown
): Promise<Record<string, RecordPickerItem>> {
  const service = new RecordPickerService(ORG, USER, {} as never, capabilities as never)
  ;(service as unknown as { fetchResourcesFromDb: unknown }).fetchResourcesFromDb = vi.fn(
    async () => ({ items: rows, nextCursor: null, hasMore: false })
  )
  return await service.getResourcesByIds(recordIds as RecordId[])
}

describe('kb hydration — the per-row gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('drops the KBs the member cannot view and keeps the one they can', async () => {
    const result = await hydrate(
      [`kb:${VISIBLE_KB}`, `kb:${HIDDEN_KB}`, `kb:${OTHER_HIDDEN_KB}`],
      tableRows([VISIBLE_KB, HIDDEN_KB, OTHER_HIDDEN_KB]),
      view({ [VISIBLE_KB]: 'edit' })
    )

    expect(Object.keys(result)).toEqual([`kb:${VISIBLE_KB}`])
  })

  it('is a NON-enumeration: an unviewable KB leaves no key behind at all', async () => {
    // Not `{ 'kb:hidden': null }` — the caller must not learn the id exists.
    const result = await hydrate(
      [`kb:${HIDDEN_KB}`],
      tableRows([HIDDEN_KB]),
      view({ [VISIBLE_KB]: 'read' })
    )

    expect(result).toEqual({})
  })

  it('stamps `_access` with the rung, so row affordances resolve client-side', async () => {
    // The vocabulary match is the point: instance access uses CONFIG_SCALE_RUNGS,
    // which is the same ladder `canEditRecordAt` / `useRecordAccess` judge.
    const rungs = { [VISIBLE_KB]: 'read', [HIDDEN_KB]: 'edit', [OTHER_HIDDEN_KB]: 'admin' } as const
    const result = await hydrate(
      [`kb:${VISIBLE_KB}`, `kb:${HIDDEN_KB}`, `kb:${OTHER_HIDDEN_KB}`],
      tableRows([VISIBLE_KB, HIDDEN_KB, OTHER_HIDDEN_KB]),
      view(rungs)
    )

    expect(result[`kb:${VISIBLE_KB}`]?._access).toBe('read')
    expect(result[`kb:${HIDDEN_KB}`]?._access).toBe('edit')
    expect(result[`kb:${OTHER_HIDDEN_KB}`]?._access).toBe('admin')
  })

  it('an internal caller (no capabilities) is not gated', async () => {
    // `capabilities: undefined` means "no member to judge" — the same convention
    // `recordScope` and `fetchEntityInstancesByIds` already follow.
    const service = new RecordPickerService(ORG, undefined, {} as never)
    ;(service as unknown as { fetchResourcesFromDb: unknown }).fetchResourcesFromDb = vi.fn(
      async () => ({ items: tableRows([VISIBLE_KB, HIDDEN_KB]), nextCursor: null, hasMore: false })
    )

    const result = await service.getResourcesByIds([
      `kb:${VISIBLE_KB}`,
      `kb:${HIDDEN_KB}`,
    ] as RecordId[])

    expect(Object.keys(result).sort()).toEqual([`kb:${HIDDEN_KB}`, `kb:${VISIBLE_KB}`])
  })

  it('an ordinary system table is untouched — it genuinely has no per-row policy', async () => {
    // `article` is a system table but NOT instance-access, so the gate must not
    // start dropping its rows just because it is not an `EntityInstance`.
    const ARTICLE = 'art_cuid0000000000000000000'
    const result = await hydrate(
      [`article:${ARTICLE}`],
      tableRows([ARTICLE], 'article'),
      view({}) // nothing viewable in the instance keyspace
    )

    expect(Object.keys(result)).toEqual([`article:${ARTICLE}`])
    expect(result[`article:${ARTICLE}`]?._access).toBeUndefined()
  })
})
