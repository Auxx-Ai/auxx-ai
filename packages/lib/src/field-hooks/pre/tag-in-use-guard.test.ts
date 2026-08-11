// packages/lib/src/field-hooks/pre/tag-in-use-guard.test.ts
// The guard that stops a tag delete from orphaning the rows that reference it.
//
// ⚠️ PARTIAL mock of `@auxx/database`, via `createSchemaMock` — a full
// replacement dies at COLLECTION the moment this file's import graph reaches a
// module that reads some other table at import time, and the failure looks
// nothing like its cause.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../errors'
import type { EntityPreDeleteEvent } from '../types'

const h = vi.hoisted(() => ({ where: vi.fn() }))

vi.mock('@auxx/database', async () => ({
  database: {
    select: () => ({ from: () => ({ where: h.where }) }),
  },
  schema: (await import('../../test/database-mock')).createSchemaMock({
    FieldValue: {
      relatedEntityId: 'FieldValue.relatedEntityId',
      organizationId: 'FieldValue.organizationId',
    },
  }),
}))

import { rejectDeleteIfTagInUse } from './tag-in-use-guard'

function event(): EntityPreDeleteEvent {
  return {
    recordId: 'tagdef123:sx81fbbgbi80ba8f80vyj3kq' as EntityPreDeleteEvent['recordId'],
    entityDefinitionId: 'tagdef123',
    entityType: null,
    entitySlug: 'tags',
    values: {},
    organizationId: 'org_1',
    userId: 'usr_1',
    bypass: new Set(),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('rejectDeleteIfTagInUse', () => {
  it('allows the delete when nothing references the tag', async () => {
    h.where.mockResolvedValue([{ references: 0 }])
    await expect(rejectDeleteIfTagInUse(event())).resolves.toBeUndefined()
  })

  it('⚠️ refuses while references exist — this is the orphan bug', async () => {
    // The observed incident: one delete left 532 rows whose `relatedEntityId`
    // pointed at a tag row that no longer existed, and the mail list kept
    // rendering a tag that was gone. `relatedEntityId` has no FK, so nothing
    // else stops it.
    h.where.mockResolvedValue([{ references: 532 }])
    await expect(rejectDeleteIfTagInUse(event())).rejects.toThrow(ConflictError)
  })

  it('names the count and points at archive, because the caller has to choose', async () => {
    h.where.mockResolvedValue([{ references: 532 }])
    await expect(rejectDeleteIfTagInUse(event())).rejects.toThrow(/532 records/)
    await expect(rejectDeleteIfTagInUse(event())).rejects.toThrow(/Archive it instead/)
  })

  it('singularises one reference', async () => {
    h.where.mockResolvedValue([{ references: 1 }])
    await expect(rejectDeleteIfTagInUse(event())).rejects.toThrow(/still on 1 record\./)
  })

  it('⚠️ is a 409, not a 403 — the caller IS allowed, the state is what blocks', async () => {
    // Its siblings (`rejectDeleteIfSystemTag`, `rejectDeleteIfTemplateTag`) throw
    // 403 because those tags may NEVER be deleted. This one is clearable: untag
    // the records, or archive, and the same caller succeeds.
    h.where.mockResolvedValue([{ references: 3 }])
    await expect(rejectDeleteIfTagInUse(event())).rejects.toMatchObject({ statusCode: 409 })
  })

  it('treats a missing count row as "no references" rather than throwing', async () => {
    h.where.mockResolvedValue([])
    await expect(rejectDeleteIfTagInUse(event())).resolves.toBeUndefined()
  })
})
