// packages/lib/src/resources/picker/mail-lens-tables.test.ts
//
// Step 0.1, the SECOND entry point: `thread` and `message` are registered system
// resource tables, so every `TableId`-driven read in `RecordPickerService` could
// reach mail content through the generic record path — where no mail lens
// exists. These tests pin each of those paths shut.
//
// The union assertion is the important one. Restricting `query_records` /
// `search_entities` (the other half of 0.1, in `ai/kopilot/capabilities/entities/`)
// does nothing for the global record search, which fans out over
// `Object.keys(RESOURCE_TABLE_MAP)` and never names a def at all.

import { describe, expect, it, vi } from 'vitest'

const getCachedResources = vi.hoisted(() => vi.fn(async () => []))

vi.mock('../../cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../cache')>()
  return { ...actual, getCachedResources }
})

import { isMailLensTableId, MAIL_LENS_TABLE_IDS } from './mail-lens-tables'
import { RecordPickerService } from './record-picker-service'

/**
 * A `db` that records which relational tables the picker actually touched, and
 * answers every one of them with an empty page. The system-table legs of the
 * union all land in `db.query[<dbTable>].findMany`, so the set of keys touched
 * IS the set of tables the fan-out reached.
 */
function recordingDb() {
  const touched: string[] = []
  const db = {
    query: new Proxy({} as Record<string, unknown>, {
      get: (_target, key: string) => {
        touched.push(key)
        return { findMany: async () => [], findFirst: async () => undefined }
      },
    }),
    execute: async () => ({ rows: [] }),
    select: () => {
      throw new Error('join-scoped legs are not under test here')
    },
  } as never
  return { db, touched }
}

describe('mail-lens table ids', () => {
  it('names thread and message, and nothing else', () => {
    expect([...MAIL_LENS_TABLE_IDS].sort()).toEqual(['message', 'thread'])
    expect(isMailLensTableId('thread')).toBe(true)
    expect(isMailLensTableId('message')).toBe(true)
    expect(isMailLensTableId('participant')).toBe(false)
  })
})

describe('RecordPickerService refuses the generic record path for mail content', () => {
  it('getResources("thread") is refused before the picker cache is consulted', async () => {
    const { db } = recordingDb()
    const service = new RecordPickerService('org_1', 'user_1', db)
    await expect(service.getResources({ entityDefinitionId: 'thread', limit: 10 })).rejects.toThrow(
      /mail search tools/
    )
  })

  it('getResources("message") is refused too', async () => {
    const { db } = recordingDb()
    const service = new RecordPickerService('org_1', 'user_1', db)
    await expect(
      service.getResources({ entityDefinitionId: 'message', limit: 10 })
    ).rejects.toThrow(/mail search tools/)
  })

  it('getResourceById("thread") is refused — holding an id is not a lens', async () => {
    const { db } = recordingDb()
    const service = new RecordPickerService('org_1', 'user_1', db)
    await expect(
      service.getResourceById({ entityDefinitionId: 'thread', id: 'thr_1' })
    ).rejects.toThrow(/mail search tools/)
  })

  it('getResourcesByIds DROPS thread ids instead of failing the whole batch', async () => {
    const { db, touched } = recordingDb()
    const service = new RecordPickerService('org_1', 'user_1', db)
    // A batch is hydration for ids the caller already holds; one unreachable id
    // must not take the other ninety-nine down with it.
    const result = await service.getResourcesByIds(['thread:thr_1', 'message:msg_1'] as never)
    expect(result).toEqual({})
    expect(touched).not.toContain('Thread')
    expect(touched).not.toContain('Message')
  })

  it('the global union fans out over every system table EXCEPT thread and message', async () => {
    const { db, touched } = recordingDb()
    const service = new RecordPickerService('org_1', 'user_1', db)
    await service.search({ query: 'acme', limit: 25 })

    expect(touched).not.toContain('Thread')
    expect(touched).not.toContain('Message')
    // …while the rest of the union is untouched by the restriction.
    expect(touched).toContain('Participant')
    expect(touched).toContain('Dataset')
  })
})
