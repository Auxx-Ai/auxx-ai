// packages/lib/src/files/remote-image/__tests__/fetch-record-image.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError } from '../../../errors'

const fetchAndStoreRemoteImage = vi.fn()
vi.mock('../../fetch-remote-image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../fetch-remote-image')>()),
  fetchAndStoreRemoteImage: (...a: unknown[]) => fetchAndStoreRemoteImage(...a),
}))

const checkFixedWindowLimit = vi.fn()
vi.mock('../../../utils/rate-limiter/fixed-window', () => ({
  checkFixedWindowLimit: (...a: unknown[]) => checkFixedWindowLimit(...a),
}))

vi.mock('../../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: vi.fn(async () => 'sys-user') },
}))

const setValuesForEntity = vi.fn()
const serviceArgs: unknown[][] = []
vi.mock('../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    constructor(...args: unknown[]) {
      serviceArgs.push(args)
    }
    setValuesForEntity = setValuesForEntity
  },
}))

import { fetchRecordImage } from '../fetch-record-image'

const URL = 'https://cdn.example.com/p/1.jpg?v=2'
const INPUT = {
  organizationId: 'org1',
  entityDefinitionId: 'def_product',
  instanceId: 'inst1',
  fieldId: 'field-image-uuid',
  url: URL,
  connectorId: 'dc1',
}

function makeDb(opts: { instance?: { archivedAt: Date | null } | null; rows?: unknown[] } = {}) {
  const instance = opts.instance === undefined ? { archivedAt: null } : opts.instance
  return {
    query: { EntityInstance: { findFirst: vi.fn(async () => instance) } },
    select: vi.fn(() => ({ from: () => ({ where: async () => opts.rows ?? [] }) })),
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  serviceArgs.length = 0
  checkFixedWindowLimit.mockResolvedValue({ allowed: true, count: 1 })
  fetchAndStoreRemoteImage.mockResolvedValue({
    assetId: 'a1',
    ref: 'asset:a1',
    mimeType: 'image/jpeg',
    size: 10,
  })
  setValuesForEntity.mockResolvedValue([])
})

describe('fetchRecordImage', () => {
  it('skips without fetching when the stored sourceUrl equals the URL', async () => {
    const db = makeDb({ rows: [{ valueJson: { v: { ref: 'asset:old', sourceUrl: URL } } }] })

    const result = await fetchRecordImage(db, INPUT)

    expect(result._unsafeUnwrap()).toEqual({ outcome: 'skipped', why: 'unchanged' })
    expect(fetchAndStoreRemoteImage).not.toHaveBeenCalled()
    expect(setValuesForEntity).not.toHaveBeenCalled()
  })

  it('a new URL fetches once and writes [{ ref, sourceUrl }] under a quiet session', async () => {
    const db = makeDb({
      rows: [{ valueJson: { v: { ref: 'asset:old', sourceUrl: 'https://x/0.jpg' } } }],
    })

    const result = await fetchRecordImage(db, INPUT)

    expect(result._unsafeUnwrap()).toEqual({ outcome: 'written', assetId: 'a1' })
    expect(fetchAndStoreRemoteImage).toHaveBeenCalledTimes(1)
    expect(fetchAndStoreRemoteImage.mock.calls[0]?.[0]).toMatchObject({
      url: URL,
      organizationId: 'org1',
      userId: 'sys-user',
      pathPrefix: 'connector-images',
      purpose: 'connector-image',
      name: '1.jpg',
    })
    expect(setValuesForEntity).toHaveBeenCalledWith({
      recordId: 'def_product:inst1',
      values: [{ fieldId: 'field-image-uuid', value: [{ ref: 'asset:a1', sourceUrl: URL }] }],
    })
    const options = serviceArgs[0]?.[4] as { session: { mode: { kind: string } } }
    expect(options.session.mode.kind).toBe('quiet')
  })

  it('a 404 (or any AuxxError) gives up without throwing and writes nothing', async () => {
    fetchAndStoreRemoteImage.mockRejectedValue(new BadRequestError('Fetch failed: HTTP 404'))

    const result = await fetchRecordImage(makeDb(), INPUT)

    expect(result._unsafeUnwrap()).toEqual({ outcome: 'failed', reason: 'Fetch failed: HTTP 404' })
    expect(setValuesForEntity).not.toHaveBeenCalled()
  })

  it('a timeout is returned as an error so the job retries', async () => {
    fetchAndStoreRemoteImage.mockRejectedValue(
      new Error('The operation was aborted due to timeout')
    )

    const result = await fetchRecordImage(makeDb(), INPUT)

    expect(result.isErr()).toBe(true)
    expect(setValuesForEntity).not.toHaveBeenCalled()
  })

  it.each([
    [null, 'record-gone'],
    [{ archivedAt: new Date() }, 'archived'],
  ])('a missing or archived record is skipped (%#)', async (instance, why) => {
    const result = await fetchRecordImage(makeDb({ instance }), INPUT)

    expect(result._unsafeUnwrap()).toEqual({ outcome: 'skipped', why })
    expect(fetchAndStoreRemoteImage).not.toHaveBeenCalled()
  })

  it('over the per-org budget defers instead of fetching', async () => {
    checkFixedWindowLimit.mockResolvedValue({ allowed: false, count: 501, remainingMs: 1234 })

    const result = await fetchRecordImage(makeDb(), INPUT)

    expect(result._unsafeUnwrap()).toEqual({ outcome: 'deferred', retryInMs: 1234 })
    expect(fetchAndStoreRemoteImage).not.toHaveBeenCalled()
  })
})
