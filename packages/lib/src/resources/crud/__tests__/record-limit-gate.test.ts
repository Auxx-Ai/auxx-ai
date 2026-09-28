// packages/lib/src/resources/crud/__tests__/record-limit-gate.test.ts
//
// The records-limit gate on UnifiedCrudHandler: only a handler built with
// `enforceRecordLimit` (a user door) is refused; any other handler is not.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UsageLimitError } from '../../../errors'

const h = vi.hoisted(() => ({
  assertRecordRoom: vi.fn(),
  noteMeteredRecordsCreated: vi.fn(async () => {}),
  createEntity: vi.fn(async () => ({ instance: { id: 'inst_1' }, recordId: 'def:inst_1' })),
  bulkCreateEntities: vi.fn(async (_ctx: unknown, _def: string, items: unknown[]) => ({
    created: items.map((_, i) => ({ id: `inst_${i}` })),
    errors: [],
  })),
}))

vi.mock('../../../usage/records-limit', () => ({ assertRecordRoom: h.assertRecordRoom }))
vi.mock('../../../usage/records-count', () => ({
  noteMeteredRecordsCreated: h.noteMeteredRecordsCreated,
}))
vi.mock('../unified-handler-mutations', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createEntity: h.createEntity,
  bulkCreateEntities: h.bulkCreateEntities,
}))

import type { ManifestCollector } from '../../../record-rules/sync-manifest-collector'
import { UnifiedCrudHandler } from '../unified-handler'
import type { WriteSession } from '../write-origin'

function handler(options: ConstructorParameters<typeof UnifiedCrudHandler>[4] = {}) {
  const crud = new UnifiedCrudHandler('org_1', 'user_1', {} as never, undefined, options)
  vi.spyOn(crud, 'warmCache').mockResolvedValue(undefined)
  return crud
}

const limitError = () => new UsageLimitError({ metric: 'records', current: 1000, limit: 1000 })

beforeEach(() => {
  vi.clearAllMocks()
  h.assertRecordRoom.mockResolvedValue({ metered: true })
})

describe('user door (enforceRecordLimit)', () => {
  it('creates under hard and bumps the cached count', async () => {
    await handler({ enforceRecordLimit: true }).create('contact', {})
    expect(h.assertRecordRoom).toHaveBeenCalledWith({}, 'org_1', {
      entityDefinitionId: 'contact',
      quantity: 1,
    })
    expect(h.createEntity).toHaveBeenCalledTimes(1)
    expect(h.noteMeteredRecordsCreated).toHaveBeenCalledWith('org_1', 1)
  })

  it('is refused at hard before anything is written', async () => {
    h.assertRecordRoom.mockRejectedValue(limitError())
    await expect(
      handler({ enforceRecordLimit: true }).create('contact', {})
    ).rejects.toBeInstanceOf(UsageLimitError)
    expect(h.createEntity).not.toHaveBeenCalled()
    expect(h.noteMeteredRecordsCreated).not.toHaveBeenCalled()
  })

  it('gates a bulk create on the whole batch', async () => {
    await handler({ enforceRecordLimit: true }).bulkCreate('contact', [{}, {}, {}])
    expect(h.assertRecordRoom).toHaveBeenCalledWith({}, 'org_1', {
      entityDefinitionId: 'contact',
      quantity: 3,
    })
    expect(h.noteMeteredRecordsCreated).toHaveBeenCalledWith('org_1', 3)
  })

  it('does not bump the count for an unmetered def', async () => {
    h.assertRecordRoom.mockResolvedValue({ metered: false })
    await handler({ enforceRecordLimit: true }).create('line_item', {})
    expect(h.noteMeteredRecordsCreated).not.toHaveBeenCalled()
  })

  it('carries the gate through withDatabase', async () => {
    h.assertRecordRoom.mockRejectedValue(limitError())
    const bound = handler({ enforceRecordLimit: true }).withDatabase({ tx: true } as never)
    vi.spyOn(bound, 'warmCache').mockResolvedValue(undefined)
    await expect(bound.create('contact', {})).rejects.toBeInstanceOf(UsageLimitError)
  })
})

describe('handlers without enforceRecordLimit are never gated', () => {
  it('a connector-sync session without the flag creates past hard', async () => {
    h.assertRecordRoom.mockRejectedValue(limitError())
    const session: WriteSession = {
      origin: {
        kind: 'sync',
        source: 'connector',
        ref: 'run_1',
        collector: {} as ManifestCollector,
      },
      depth: 0,
    }
    await handler({ session }).create('order', {})
    await handler({ session }).bulkCreate('order', [{}, {}])
    expect(h.assertRecordRoom).not.toHaveBeenCalled()
    expect(h.createEntity).toHaveBeenCalledTimes(1)
    expect(h.bulkCreateEntities).toHaveBeenCalledTimes(1)
  })

  it('a default (interactive) handler without the flag creates past hard', async () => {
    h.assertRecordRoom.mockRejectedValue(limitError())
    await handler().create('invoice', {})
    expect(h.assertRecordRoom).not.toHaveBeenCalled()
  })
})
