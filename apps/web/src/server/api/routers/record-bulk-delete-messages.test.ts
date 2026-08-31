// apps/web/src/server/api/routers/record-bulk-delete-messages.test.ts

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * **Why a guard rejection has to leave `record.bulkDelete` as a 4xx.**
 *
 * The money pre-delete guards (plans/money/tasks/21-money-parent-delete-safety.md)
 * refuse with an `AuxxError` whose message is the whole point — "This purchase
 * order has 1 vendor bill billed against it… delete or unlink the bills first,
 * or archive the order instead." `bulkDeleteEntities` catches that per record and
 * flattens it to `{ recordId, message, statusCode }`, so by the time this router
 * sees an all-failed batch the original error is gone.
 *
 * Raising that as an `INTERNAL_SERVER_ERROR` — which is what it used to do —
 * loses the message entirely: `errorFormatter` in `trpc.ts` replaces the message
 * of EVERY 500 with the literal "Internal server error", because unexpected
 * errors carry internals like raw SQL. So the user tripped a guard written to
 * tell them exactly what to do next and read "Internal server error".
 *
 * The `statusCode` the lib now carries is the only thing separating the two: a
 * 4xx means a hook said no on purpose and its message is written for a person;
 * anything else stays a masked 500.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const DEF = 'edf_purchaseorder00000000000'
const ROW_A = 'ins_a000000000000000000000'
const ROW_B = 'ins_b000000000000000000000'

const GUARD_MESSAGE =
  'This purchase order has 1 vendor bill billed against it. Deleting the order would leave ' +
  'the three-way match with no order leg — delete or unlink the bills first, or archive the ' +
  'order instead.'

const { handler, cache } = vi.hoisted(() => ({
  handler: {
    getByIds: vi.fn(async () => ({}) as Record<string, { _access?: string }>),
    delete: vi.fn(async () => undefined),
    bulkDelete: vi.fn(
      async () =>
        ({ count: 0, errors: [] }) as {
          count: number
          errors: Array<{ recordId: string; message: string; statusCode?: number }>
        }
    ),
    merge: vi.fn(async () => ({ ok: true })),
  },
  cache: {
    getCachedResources: vi.fn(async () => [] as unknown[]),
    getCachedResource: vi.fn(async () => undefined as unknown),
  },
}))

vi.mock('@auxx/lib/resources', () => ({
  RESOURCE_TABLE_REGISTRY: [],
  UnifiedCrudHandler: class {
    getByIds = handler.getByIds
    delete = handler.delete
    bulkDelete = handler.bulkDelete
    merge = handler.merge
  },
}))

vi.mock('@auxx/lib/cache', () => ({
  getCachedResources: cache.getCachedResources,
  getCachedResource: cache.getCachedResource,
}))
vi.mock('@auxx/lib/identity', () => ({ getRecordIdentityViews: vi.fn(async () => []) }))
vi.mock('@auxx/lib/field-values', () => ({ getDescendantIds: vi.fn(async () => []) }))
vi.mock('@auxx/lib/conditions', async () => {
  const { z } = await import('zod')
  return { conditionGroupSchema: z.any() }
})
vi.mock('@auxx/lib/permissions', async () => {
  const registry = await import('@auxx/lib/permissions/capabilities/registry')
  const instanceAccess = await import('@auxx/lib/permissions/capabilities/instance-access')
  return {
    PermissionKey: registry.PermissionKey,
    isInstanceAccessKey: instanceAccess.isInstanceAccessKey,
  }
})

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    capabilityProcedure: t.procedure,
    protectedProcedure: t.procedure,
    isAuxxError: (e: unknown): boolean =>
      typeof e === 'object' && e !== null && 'statusCode' in e && 'name' in e,
  }
})

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { recordRouter } = await import('./record')

const RESOURCES = [
  { id: DEF, entityDefinitionId: DEF, apiSlug: 'purchase-orders', entityType: 'purchase_order' },
]

/** A Records-Full member: the def gate short-circuits, so no row stamps are read. */
function fullMember() {
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.records]: Level.Full })),
    {},
    'USER',
    'full',
    (id) => id,
    new Set(),
    (id) => id
  )
}

function caller() {
  return recordRouter.createCaller({
    db: {},
    headers: new Headers(),
    capabilities: fullMember(),
    session: { organizationId: ORG_ID, userId: USER_ID, user: { id: USER_ID } },
  } as never)
}

beforeEach(() => {
  handler.getByIds.mockReset()
  handler.getByIds.mockResolvedValue({})
  handler.bulkDelete.mockReset()
  cache.getCachedResources.mockReset()
  cache.getCachedResources.mockResolvedValue(RESOURCES)
})

describe('record.bulkDelete — an all-failed batch keeps the guard’s reason', () => {
  it('a 4xx guard rejection surfaces VERBATIM under the hook’s own status', async () => {
    handler.bulkDelete.mockResolvedValue({
      count: 0,
      errors: [{ recordId: `${DEF}:${ROW_A}`, message: GUARD_MESSAGE, statusCode: 400 }],
    })
    await expect(caller().bulkDelete({ recordIds: [`${DEF}:${ROW_A}`] })).rejects.toMatchObject({
      cause: { name: 'BadRequestError', statusCode: 400, message: GUARD_MESSAGE },
    })
  })

  it('the status is the hook’s, not a flattened 400 — a 409 stays a 409', async () => {
    handler.bulkDelete.mockResolvedValue({
      count: 0,
      errors: [{ recordId: `${DEF}:${ROW_A}`, message: 'Still referenced.', statusCode: 409 }],
    })
    await expect(caller().bulkDelete({ recordIds: [`${DEF}:${ROW_A}`] })).rejects.toMatchObject({
      cause: { name: 'ConflictError', statusCode: 409 },
    })
  })

  it('N rows tripping the SAME guard read as one sentence, not N copies', async () => {
    handler.bulkDelete.mockResolvedValue({
      count: 0,
      errors: [
        { recordId: `${DEF}:${ROW_A}`, message: GUARD_MESSAGE, statusCode: 400 },
        { recordId: `${DEF}:${ROW_B}`, message: GUARD_MESSAGE, statusCode: 400 },
      ],
    })
    await expect(
      caller().bulkDelete({ recordIds: [`${DEF}:${ROW_A}`, `${DEF}:${ROW_B}`] })
    ).rejects.toMatchObject({ cause: { message: GUARD_MESSAGE } })
  })

  it('an unexpected failure stays a 500 — its message may carry raw SQL', async () => {
    // No `statusCode` ⇒ not a deliberate refusal ⇒ masked by `errorFormatter`.
    handler.bulkDelete.mockResolvedValue({
      count: 0,
      errors: [{ recordId: `${DEF}:${ROW_A}`, message: 'insert into "EntityValue" …' }],
    })
    await expect(caller().bulkDelete({ recordIds: [`${DEF}:${ROW_A}`] })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    })
  })

  it('ONE unexpected failure in a batch drags the whole batch back to 500', async () => {
    handler.bulkDelete.mockResolvedValue({
      count: 0,
      errors: [
        { recordId: `${DEF}:${ROW_A}`, message: GUARD_MESSAGE, statusCode: 400 },
        { recordId: `${DEF}:${ROW_B}`, message: 'connection terminated' },
      ],
    })
    await expect(
      caller().bulkDelete({ recordIds: [`${DEF}:${ROW_A}`, `${DEF}:${ROW_B}`] })
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' })
  })

  it('a PARTIAL failure still resolves — the per-record errors reach the client', async () => {
    // The client renders the reasons in its toast; the batch is not an error.
    const errors = [{ recordId: `${DEF}:${ROW_B}`, message: GUARD_MESSAGE, statusCode: 400 }]
    handler.bulkDelete.mockResolvedValue({ count: 1, errors })
    await expect(
      caller().bulkDelete({ recordIds: [`${DEF}:${ROW_A}`, `${DEF}:${ROW_B}`] })
    ).resolves.toEqual({ count: 1, errors })
  })
})
