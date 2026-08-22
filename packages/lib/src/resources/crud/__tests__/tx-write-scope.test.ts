// packages/lib/src/resources/crud/__tests__/tx-write-scope.test.ts
//
// Phase A of plans/events/04-in-transaction-write-semantics-plan.md: the
// transaction write scope and its flush.
//
// - sessionLane gains 'buffered'; `absorbed`/`quiet` resolve to 'silent'.
// - T-5, the per-attempt contract: a scope is minted inside the callback,
//   returned by value only on the resolving path, never reused by a retry,
//   and joined (not stacked) when nested.
// - T-4: a buffered effect is pure data; the flush asserts it.
// - T-1 / T-1b: a created record absorbs its own field changes, and a create
//   that DECLARES a created parent is absorbed into that parent's create.
// - O-8: changes on a record that already existed replay as C2.
// - T-6: the flush is best-effort.
//
// @auxx/database is globally mocked in src/test/setup.ts.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  // Arg-typed so `mock.calls[n][i]` is legal for tsc — an untyped `vi.fn()`
  // types its calls as an empty tuple (TS2493), the same note
  // `door-conformance.test.ts` carries.
  const publish = vi.fn<(room: unknown, event: string, data?: unknown) => Promise<void>>(
    async () => {}
  )
  return {
    publish,
    publishLater: vi.fn<(event: { type: string; data: unknown }) => void>(() => {}),
    publishFieldValueUpdates: vi.fn<
      (service: unknown, org: string, entries: unknown[]) => Promise<void>
    >(async () => {}),
    publishRecordsInvalidated: vi.fn(async () => {}),
    enqueueDuplicateScan: vi.fn(async () => 'job_1'),
    getEntityInstance: vi.fn(async () => ok({ id: 'inst_1', displayName: 'Invoice 1' })),
    findCachedResource: vi.fn(async () => ({ fields: [] })),
    createEntityInstance: vi.fn(async () => ({ isOk: () => true, value: { id: 'inst_1' } })),
    // A spy, not a plain arrow: the T-6 entry test needs it to throw once.
    getRealtimeService: vi.fn<() => { publish: typeof publish }>(() => ({ publish })),
  }
})

vi.mock('../../../realtime', () => ({
  getRealtimeService: h.getRealtimeService,
  rooms: { orgRecords: (org: string, def: string) => `records:${org}:${def}` },
  publishFieldValueUpdates: h.publishFieldValueUpdates,
  publishRecordsInvalidated: h.publishRecordsInvalidated,
}))
vi.mock('../../../events/publisher', () => ({
  publisher: { publishLater: h.publishLater, publish: h.publishLater },
}))
vi.mock('../../../dedup/enqueue-scan', () => ({ enqueueDuplicateScan: h.enqueueDuplicateScan }))
vi.mock('../../../cache', () => ({ findCachedResource: h.findCachedResource }))
vi.mock('../../../entity-instances', () => ({
  getEntityInstance: h.getEntityInstance,
  createEntityInstance: h.createEntityInstance,
  updateEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  deleteEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
}))

import type { RecordId } from '@auxx/types/resource'
import { flushTxWriteScope } from '../tx-write-flush'
import {
  assertTxWriteScopePure,
  createTxWriteScope,
  getAmbientTxWriteScope,
  isTxWriteCreated,
  MAX_TX_WRITE_RECORDS,
  recordTxWriteArchive,
  recordTxWriteChange,
  recordTxWriteCreate,
  runInTxWrite,
  type TxWriteScope,
} from '../tx-write-scope'
import { createEntity } from '../unified-handler-mutations'
import { interactiveSession, seedSession, sessionLane, type WriteSession } from '../write-origin'
import { getAmbientWriteSession } from '../write-session-als'

const ORG = 'org_1'
const USER = 'user_1'
/** The def-uuid keyspace `handler.create` mints RecordIds in. */
const INVOICE_DEF = 'def_invoice'
const LINE_DEF = 'def_line_item'

function scopeWithInvoice(): TxWriteScope {
  const scope = createTxWriteScope(ORG, USER)
  recordTxWriteCreate(scope, {
    recordId: `${INVOICE_DEF}:inv_1` as RecordId,
    entityDefinitionId: INVOICE_DEF,
    entityType: 'invoice',
    entitySlug: 'invoices',
    values: { invoice_total: 4000 },
  })
  return scope
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getEntityInstance.mockResolvedValue(ok({ id: 'inv_1', displayName: 'Invoice 1' }) as never)
})

describe('sessionLane — the buffered lane', () => {
  it('reports buffered whatever the origin is', () => {
    const scope = createTxWriteScope(ORG, USER)
    expect(sessionLane({ ...interactiveSession(USER), mode: { kind: 'buffered', scope } })).toBe(
      'buffered'
    )
    expect(sessionLane({ ...seedSession('reshape'), mode: { kind: 'buffered', scope } })).toBe(
      'buffered'
    )
  })

  it('absorbed and quiet resolve to the silent lane — documentation with a type', () => {
    expect(
      sessionLane({ ...interactiveSession(USER), mode: { kind: 'absorbed', by: 'setBulkValues' } })
    ).toBe('silent')
    expect(
      sessionLane({ ...interactiveSession(USER), mode: { kind: 'quiet', reason: 'derivation' } })
    ).toBe('silent')
  })

  it('leaves the origin-derived lanes untouched when no mode is set', () => {
    expect(sessionLane(interactiveSession(USER))).toBe('inline')
    expect(sessionLane(seedSession('reshape'))).toBe('silent')
  })
})

describe('T-5 — the per-attempt contract', () => {
  it('mints a fresh, empty scope per invocation', async () => {
    const a = await runInTxWrite({ organizationId: ORG, actorUserId: USER }, async (s) => s)
    const b = await runInTxWrite({ organizationId: ORG, actorUserId: USER }, async (s) => s)
    expect(a.scope.attemptId).not.toBe(b.scope.attemptId)
    expect(b.scope.created).toHaveLength(0)
  })

  it('exposes the scope ambiently for the duration of the callback only', async () => {
    expect(getAmbientTxWriteScope()).toBeUndefined()
    const { scope } = await runInTxWrite({ organizationId: ORG, actorUserId: USER }, async () => {
      expect(getAmbientTxWriteScope()).toBeDefined()
      return null
    })
    expect(scope).toBeDefined()
    expect(getAmbientTxWriteScope()).toBeUndefined()
  })

  it('a throw out of the callback produces NO scope — a rollback takes its buffer with it', async () => {
    let leaked: TxWriteScope | undefined
    await expect(
      runInTxWrite({ organizationId: ORG, actorUserId: USER }, async (scope) => {
        leaked = scope
        recordTxWriteCreate(scope, {
          recordId: `${INVOICE_DEF}:inv_rolled_back` as RecordId,
          entityDefinitionId: INVOICE_DEF,
          entityType: 'invoice',
          entitySlug: 'invoices',
          values: {},
        })
        throw new Error('40001')
      })
    ).rejects.toThrow('40001')
    // The rolled-back attempt's buffer exists only inside the callback frame:
    // nothing that survives the rejection can reach it.
    expect(leaked?.created).toHaveLength(1)
  })

  it('a retry cannot reuse the failed attempt’s buffer', async () => {
    // The exact shape `withSerializableRetry` runs: the scope is minted inside
    // the (retried) callback, so attempt 2 starts empty.
    const scopes: TxWriteScope[] = []
    let attempt = 0
    const run = async () => {
      for (let i = 1; i <= 3; i++) {
        try {
          return await runInTxWrite({ organizationId: ORG, actorUserId: USER }, async (scope) => {
            scopes.push(scope)
            attempt += 1
            recordTxWriteCreate(scope, {
              recordId: `${INVOICE_DEF}:inv_attempt_${attempt}` as RecordId,
              entityDefinitionId: INVOICE_DEF,
              entityType: 'invoice',
              entitySlug: 'invoices',
              values: {},
            })
            if (attempt === 1) throw new Error('40001')
            return 'ok'
          })
        } catch {
          if (i === 3) throw new Error('exhausted')
        }
      }
      throw new Error('unreachable')
    }

    const settled = await run()
    expect(settled.result).toBe('ok')
    expect(scopes).toHaveLength(2)
    expect(scopes[0]).not.toBe(scopes[1])
    // The surviving scope carries attempt 2's create and ONLY attempt 2's.
    expect(settled.scope.created.map((c) => c.recordId)).toEqual([`${INVOICE_DEF}:inv_attempt_2`])
  })

  it('nesting joins rather than stacks — one buffer per outermost transaction', async () => {
    const { scope } = await runInTxWrite(
      { organizationId: ORG, actorUserId: USER },
      async (outer) => {
        const inner = await runInTxWrite({ organizationId: ORG, actorUserId: USER }, async (s) => s)
        expect(inner.scope).toBe(outer)
        return null
      }
    )
    expect(scope.created).toHaveLength(0)
  })
})

describe('T-4 — a buffered effect is pure data', () => {
  it('accepts a plain scope', () => {
    expect(() => assertTxWriteScopePure(scopeWithInvoice())).not.toThrow()
  })

  it('throws on a poisoned scope carrying a closure', () => {
    const scope = scopeWithInvoice() as TxWriteScope & { poison?: unknown }
    scope.poison = () => 'a captured transaction handle lives here'
    expect(() => assertTxWriteScopePure(scope)).toThrow(/non-cloneable/)
  })

  it('the flush refuses a poisoned scope before publishing anything', async () => {
    const scope = scopeWithInvoice()
    scope.created[0]!.values.db = { transaction: () => {} }
    await expect(flushTxWriteScope(scope)).rejects.toThrow(/non-cloneable/)
    expect(h.publishLater).not.toHaveBeenCalled()
  })
})

describe('the flush — T-1, T-1b and the C2 replay', () => {
  it('emits exactly one record:created for a composed invoice and absorbs its own field writes', async () => {
    const scope = scopeWithInvoice()
    // The ~6 composed field writes, addressed in the SLUG keyspace money uses.
    for (const key of ['invoice_subtotal', 'invoice_tax_total', 'invoice_total']) {
      recordTxWriteChange(scope, {
        recordId: 'invoice:inv_1' as RecordId,
        outputKey: key,
        change: { o: null, n: 1 },
        entry: { key: `invoice:inv_1:${key}` as never, value: 1 as never },
      })
    }

    await flushTxWriteScope(scope)

    expect(h.publishLater).toHaveBeenCalledTimes(1)
    expect(h.publishLater.mock.calls[0]![0]).toMatchObject({
      type: 'entity:created',
      data: { recordId: `${INVOICE_DEF}:inv_1`, eventData: { invoice_total: 4000 } },
    })
    expect(h.publish).toHaveBeenCalledTimes(1)
    expect(h.publish.mock.calls[0]![1]).toBe('record:created')
    // T-1: no fieldValues:updated for values written before first visibility.
    expect(h.publishFieldValueUpdates).not.toHaveBeenCalled()
  })

  it('T-1b: a create declaring a created parent opens no door of its own', async () => {
    const scope = scopeWithInvoice()
    for (let i = 0; i < 40; i++) {
      recordTxWriteCreate(scope, {
        recordId: `${LINE_DEF}:line_${i}` as RecordId,
        entityDefinitionId: LINE_DEF,
        entityType: 'line_item',
        entitySlug: 'line-items',
        values: {},
        // Built in the SLUG keyspace, as `copyLineOntoInvoice` does — the
        // absorption match is on the instance id, so the keyspaces still meet.
        absorbInto: 'invoice:inv_1' as RecordId,
      })
    }

    await flushTxWriteScope(scope)

    expect(h.publishLater).toHaveBeenCalledTimes(1)
    expect(h.publish).toHaveBeenCalledTimes(1)
  })

  it('T-1b is inert when the declared parent is NOT being created — the child announces itself', async () => {
    const scope = createTxWriteScope(ORG, USER)
    recordTxWriteCreate(scope, {
      recordId: `${LINE_DEF}:line_1` as RecordId,
      entityDefinitionId: LINE_DEF,
      entityType: 'line_item',
      entitySlug: 'line-items',
      values: {},
      absorbInto: 'invoice:pre_existing' as RecordId,
    })

    await flushTxWriteScope(scope)

    expect(h.publishLater).toHaveBeenCalledTimes(1)
    expect(h.publish).toHaveBeenCalledTimes(1)
  })

  it('O-8: changes on a record that already existed replay as fieldValues:updated', async () => {
    const scope = scopeWithInvoice()
    recordTxWriteChange(scope, {
      recordId: 'line_item:pre_existing' as RecordId,
      outputKey: 'line_item_visit_id',
      change: { o: 'visit_1', n: null },
      entry: { key: 'line_item:pre_existing:visit' as never, value: null as never },
    })

    await flushTxWriteScope(scope)

    expect(h.publishFieldValueUpdates).toHaveBeenCalledTimes(1)
    expect(h.publishFieldValueUpdates.mock.calls[0]![2]).toHaveLength(1)
  })

  it('replays archives last, with the payload the inline lane carried', async () => {
    const scope = createTxWriteScope(ORG, USER)
    recordTxWriteArchive(scope, {
      recordId: `${LINE_DEF}:line_1` as RecordId,
      entityDefinitionId: LINE_DEF,
      entityType: 'line_item',
      entitySlug: 'line-items',
      realtimeEvent: 'record:archived',
      eventData: { hardDelete: false },
    })

    await flushTxWriteScope(scope)

    expect(h.publishLater).toHaveBeenCalledTimes(1)
    expect(h.publishLater.mock.calls[0]![0]).toMatchObject({ type: 'entity:deleted' })
    expect(h.publish.mock.calls[0]![1]).toBe('record:archived')
  })

  it('T-6: a publish failure never surfaces as a command failure', async () => {
    h.publish.mockRejectedValueOnce(new Error('pusher down'))
    await expect(flushTxWriteScope(scopeWithInvoice())).resolves.toBeUndefined()
  })

  it('T-6: a record the flush cannot re-read still gets its bus event', async () => {
    h.getEntityInstance.mockResolvedValueOnce(err({ message: 'gone' }) as never)
    await flushTxWriteScope(scopeWithInvoice())
    expect(h.publishLater).toHaveBeenCalledTimes(1)
    expect(h.publish).not.toHaveBeenCalled()
  })

  it('degrades to a coarse records:invalidated once the cap is hit', async () => {
    const scope = createTxWriteScope(ORG, USER)
    for (let i = 0; i <= MAX_TX_WRITE_RECORDS; i++) {
      recordTxWriteCreate(scope, {
        recordId: `${LINE_DEF}:line_${i}` as RecordId,
        entityDefinitionId: LINE_DEF,
        entityType: 'line_item',
        entitySlug: 'line-items',
        values: {},
      })
    }
    expect(scope.truncated).toBe(true)
    expect(scope.created).toHaveLength(MAX_TX_WRITE_RECORDS)

    await flushTxWriteScope(scope)

    expect(h.publishRecordsInvalidated).toHaveBeenCalledTimes(1)
    expect(h.publishLater).not.toHaveBeenCalled()
  })
})

describe('isTxWriteCreated — the dual-keyspace guard', () => {
  it('matches on the instance id, so a slug-form id finds a def-uuid-form create', () => {
    const scope = scopeWithInvoice()
    expect(isTxWriteCreated(scope, 'invoice:inv_1' as RecordId)).toBe(true)
    expect(isTxWriteCreated(scope, `${INVOICE_DEF}:inv_1` as RecordId)).toBe(true)
    expect(isTxWriteCreated(scope, 'invoice:inv_2' as RecordId)).toBe(false)
  })
})

describe('recordTxWriteChange — merge semantics', () => {
  it('keeps the FIRST o and the LAST n, like the sync manifest fold', () => {
    const scope = createTxWriteScope(ORG, USER)
    const recordId = 'invoice:inv_9' as RecordId
    recordTxWriteChange(scope, { recordId, outputKey: 'invoice_total', change: { o: 1, n: 2 } })
    recordTxWriteChange(scope, { recordId, outputKey: 'invoice_total', change: { o: 2, n: 3 } })
    expect(scope.changes[recordId]).toEqual({ invoice_total: { o: 1, n: 3 } })
  })

  it('keeps one realtime entry per field key — the last write wins', () => {
    const scope = createTxWriteScope(ORG, USER)
    const recordId = 'invoice:inv_9' as RecordId
    const key = 'invoice:inv_9:total' as never
    recordTxWriteChange(scope, {
      recordId,
      outputKey: 'invoice_total',
      change: { n: 2 },
      entry: { key, value: 2 as never },
    })
    recordTxWriteChange(scope, {
      recordId,
      outputKey: 'invoice_total',
      change: { n: 3 },
      entry: { key, value: 3 as never },
    })
    expect(scope.realtime[recordId]).toEqual([{ key, value: 3 }])
  })
})

describe('ownership — the join must not drain a buffer it does not own', () => {
  it('reports owned on the outermost scope and NOT owned on a join', async () => {
    const outer = await runInTxWrite({ organizationId: ORG, actorUserId: USER }, async () => {
      const inner = await runInTxWrite({ organizationId: ORG, actorUserId: USER }, async () => null)
      expect(inner.owned).toBe(false)
      return inner.owned
    })
    expect(outer.owned).toBe(true)
  })

  it('a joined caller honouring `owned` flushes once, not once per join', async () => {
    // The shape `batch-invoicing.ts` would take if a batch wrapped the billing
    // commands in one scope: each command joins, only the outermost drains.
    const flushIfOwned = async (r: { scope: TxWriteScope; owned: boolean }) => {
      if (r.owned) await flushTxWriteScope(r.scope)
    }

    const outer = await runInTxWrite({ organizationId: ORG, actorUserId: USER }, async (scope) => {
      for (const n of [1, 2, 3]) {
        const joined = await runInTxWrite({ organizationId: ORG, actorUserId: USER }, async (s) => {
          recordTxWriteCreate(s, {
            recordId: `${INVOICE_DEF}:inv_${n}` as RecordId,
            entityDefinitionId: INVOICE_DEF,
            entityType: 'invoice',
            entitySlug: 'invoices',
            values: {},
          })
          return null
        })
        expect(joined.scope).toBe(scope)
        await flushIfOwned(joined)
      }
      // Nothing has been announced yet — the joins all deferred to the owner.
      expect(h.publish).not.toHaveBeenCalled()
      return null
    })

    await flushIfOwned(outer)

    const creates = h.publish.mock.calls.filter((call) => call[1] === 'record:created')
    expect(creates).toHaveLength(3)
    // `record.recordId` comes from the buffer; `record.id` is the re-read
    // instance, which this suite's mock pins to a single row.
    expect(
      creates.map((call) => (call[2] as { record: { recordId: string } }).record.recordId)
    ).toEqual([`${INVOICE_DEF}:inv_1`, `${INVOICE_DEF}:inv_2`, `${INVOICE_DEF}:inv_3`])
  })
})

describe('T-6 — the flush entry, not just its steps', () => {
  it('swallows a failure acquiring the realtime service', async () => {
    const scope = scopeWithInvoice()
    const boom = new Error('realtime unavailable')
    h.getRealtimeService.mockImplementationOnce(() => {
      throw boom
    })

    // The transaction has already committed — this must not become a command
    // failure, and it must not be left to callers who await it outside a try.
    await expect(flushTxWriteScope(scope)).resolves.toBeUndefined()
    expect(h.publish).not.toHaveBeenCalled()
  })
})

describe('convergence through the REAL createEntity — B-17, the point of Phase A', () => {
  /**
   * A minimal `MutationContext`. `setFieldValues` is a spy rather than the real
   * field-value layer, so this covers the CREATE half of the convergence — the
   * field-absorption half (T-1) is covered by the flush tests above, and money's
   * own orchestration is not exercised here.
   */
  function fakeCtx(session: WriteSession) {
    return {
      db: {} as never,
      organizationId: ORG,
      userId: USER,
      session,
      fieldValueService: {} as never,
      resolveEntityDefinition: async (id: string) => ({
        id,
        entityType: id === INVOICE_DEF ? 'invoice' : 'line_item',
        apiSlug: id === INVOICE_DEF ? 'invoices' : 'line-items',
      }),
      getFields: async () => [],
      runPreHooks: async (_op: string, _def: unknown, values: Record<string, unknown>) => values,
      validateUniqueFields: async () => {},
      setFieldValues: vi.fn(async () => {}),
    } as unknown as Parameters<typeof createEntity>[0]
  }

  it('a composed invoice plus 40 absorbed lines announces exactly ONE record:created', async () => {
    let n = 0
    h.createEntityInstance.mockImplementation(async () => ok({ id: `inst_${++n}` }) as never)

    const { scope, owned } = await runInTxWrite(
      { organizationId: ORG, actorUserId: USER },
      async () => {
        const ctx = fakeCtx(getAmbientWriteSession()!)
        const invoice = await createEntity(ctx, INVOICE_DEF, { invoice_total: 4000 })
        for (let i = 0; i < 40; i++) {
          await createEntity(
            ctx,
            LINE_DEF,
            { line_item_name: `line ${i}` },
            {
              absorbInto: invoice.recordId,
            }
          )
        }
        return invoice
      }
    )

    // Nothing escaped mid-composition: 41 creates, zero doors opened.
    expect(h.publish).not.toHaveBeenCalled()
    expect(h.publishLater).not.toHaveBeenCalled()
    expect(scope.created).toHaveLength(41)
    expect(owned).toBe(true)

    await flushTxWriteScope(scope)

    const realtimeCreates = h.publish.mock.calls.filter((call) => call[1] === 'record:created')
    expect(realtimeCreates).toHaveLength(1)
    expect((realtimeCreates[0]?.[2] as { entityDefinitionId: string }).entityDefinitionId).toBe(
      INVOICE_DEF
    )
    const busCreates = h.publishLater.mock.calls.filter((call) =>
      String(call[0]?.type ?? '').endsWith(':created')
    )
    expect(busCreates).toHaveLength(1)
  })

  it('the same 40 lines WITHOUT a buffered scope announce themselves — 41 doors', async () => {
    let n = 0
    h.createEntityInstance.mockImplementation(async () => ok({ id: `inst_${++n}` }) as never)

    const ctx = fakeCtx(interactiveSession(USER))
    const invoice = await createEntity(ctx, INVOICE_DEF, { invoice_total: 4000 })
    for (let i = 0; i < 40; i++) {
      await createEntity(
        ctx,
        LINE_DEF,
        { line_item_name: `line ${i}` },
        {
          absorbInto: invoice.recordId,
        }
      )
    }

    // T-1b is inert outside a scope, deliberately: a stray `absorbInto` must
    // never silence a record on the inline path.
    const realtimeCreates = h.publish.mock.calls.filter((call) => call[1] === 'record:created')
    expect(realtimeCreates).toHaveLength(41)
  })
})
