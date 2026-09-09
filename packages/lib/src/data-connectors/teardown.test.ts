// packages/lib/src/data-connectors/teardown.test.ts
//
// The teardown chain replaces an inline loop that could not finish (23,265
// records inside one HTTP request) and that discarded every per-record failure
// while still reporting success. These tests pin the properties that make the
// replacement safe: the status is the claim, the chain continues only while
// there is work, refusals are recorded rather than swallowed, and — the part
// that matters most — every behavior actually TERMINATES.
//
// 🛑 The stub below models the scan as a SET, not as a queue of batches. The
// previous stub popped from `batches`, which hard-coded "the set shrinks each
// slice" as an axiom of the test rig — exactly the assumption that was false in
// production. Under it, `archive` looked fine while it in fact looped forever:
// archiving does not null the provenance columns, so the same rows came back
// every slice. A test rig may not assume the invariant the code is supposed to
// establish, so this one derives each batch from the surviving rows and applies
// only the filters the production code actually asked for.

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Row {
  id: string
  defId: string
  archived: boolean
}

const h = vi.hoisted(() => ({
  enqueueConnectorTeardown: vi.fn(async (_d: unknown, _o?: { dedupe?: boolean }) => {}),
  finalizeConnectorTeardown: vi.fn(async () => ({ success: true })),
  publishConnectorSync: vi.fn(async () => {}),
  bulkDelete: vi.fn(),
  bulkArchive: vi.fn(),
  /** The live scan set, keyed by instance id. */
  rows: new Map<string, Row>(),
  /** Filters the production code asked for on the CURRENT scan. */
  scan: { excludeArchived: false, skipIds: [] as string[] },
  update: vi.fn(),
  connector: { id: 'conn_1', status: 'deleting' } as
    | { id: string; status: string; error?: string | null }
    | undefined,
}))

// `isNull` / `notInArray` are how `nextMintedRecords` expresses the two optional
// scan filters. Recording them is what lets the fake DB below apply exactly the
// predicates the real query would, instead of guessing.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return {
    ...actual,
    isNull: (column: Parameters<typeof actual.isNull>[0]) => {
      h.scan.excludeArchived = true
      return actual.isNull(column)
    },
    notInArray: (
      column: Parameters<typeof actual.notInArray>[0],
      values: Parameters<typeof actual.notInArray>[1]
    ) => {
      h.scan.skipIds = values as string[]
      return actual.notInArray(column, values)
    },
  }
})

vi.mock('./data-connector-queue', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enqueueConnectorTeardown: h.enqueueConnectorTeardown,
}))
vi.mock('./mutations', () => ({
  finalizeConnectorTeardown: h.finalizeConnectorTeardown,
}))
vi.mock('./realtime', () => ({ publishConnectorSync: h.publishConnectorSync }))
vi.mock('../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    bulkDelete = h.bulkDelete
    bulkArchive = h.bulkArchive
  },
}))

import { runConnectorTeardownSlice, TEARDOWN_SKIP_CAP } from './teardown'

/**
 * Drizzle stand-in whose `limit()` derives the batch from the surviving rows,
 * applying the archived / skip filters the code asked for on this scan.
 */
function db() {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'where', 'groupBy']) chain[method] = () => chain
  chain.limit = async (limit: number) => {
    let rows = [...h.rows.values()]
    if (h.scan.excludeArchived) rows = rows.filter((row) => !row.archived)
    if (h.scan.skipIds.length > 0) rows = rows.filter((row) => !h.scan.skipIds.includes(row.id))
    return rows.slice(0, limit).map((row) => ({ id: row.id, defId: row.defId }))
  }

  return {
    query: { DataConnector: { findFirst: async () => h.connector } },
    selectDistinct: () => {
      // A fresh scan: forget what the previous one asked for.
      h.scan = { excludeArchived: false, skipIds: [] }
      return chain
    },
    update: () => ({
      set: (patch: unknown) => {
        const where = (...args: unknown[]) => {
          h.update(patch)
          return Object.assign(Promise.resolve([{ organizationId: 'org_1' }]), {
            returning: async () => [{ organizationId: 'org_1' }],
          })
        }
        return { where }
      },
    }),
  } as never
}

const job = (behavior: 'archive' | 'delete' = 'delete', skipInstanceIds?: string[]) => ({
  connectorId: 'conn_1',
  organizationId: 'org_1',
  userId: 'user_1',
  behavior,
  ...(skipInstanceIds ? { skipInstanceIds } : {}),
})

function seed(...ids: string[]) {
  h.rows.clear()
  for (const id of ids) h.rows.set(id, { id, defId: 'def_1', archived: false })
}

/** A real hard delete: the row leaves the scan set (FK `onDelete: set null`). */
function realDelete(recordIds: string[]) {
  for (const recordId of recordIds) h.rows.delete(recordId.split(':')[1] as string)
  return { count: recordIds.length, errors: [] }
}

/** A real archive: stamps the row, which stays bound and stays in the set. */
function realArchive(recordIds: string[]) {
  let count = 0
  for (const recordId of recordIds) {
    const row = h.rows.get(recordId.split(':')[1] as string)
    // Mirrors `archiveEntityInstances`: only rows not already archived count.
    if (row && !row.archived) {
      row.archived = true
      count++
    }
  }
  return { count }
}

/**
 * Drive the whole chain the way the worker does — each slice's enqueued payload
 * becomes the next slice's input — and report how it ended.
 */
async function runChain(behavior: 'archive' | 'delete', maxSlices = 40) {
  let payload = job(behavior)
  let slices = 0
  while (slices < maxSlices) {
    slices++
    h.enqueueConnectorTeardown.mockClear()
    const outcome = await runConnectorTeardownSlice(db(), payload)
    if (outcome.finished) return { slices, finished: true, ranOut: false }
    const next = h.enqueueConnectorTeardown.mock.calls[0]?.[0]
    if (!next) return { slices, finished: false, ranOut: false }
    payload = next as ReturnType<typeof job>
  }
  return { slices, finished: false, ranOut: true }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.rows.clear()
  h.scan = { excludeArchived: false, skipIds: [] }
  h.connector = { id: 'conn_1', status: 'deleting' }
  h.bulkDelete.mockImplementation(async (ids: string[]) => realDelete(ids))
  h.bulkArchive.mockImplementation(async (ids: string[]) => realArchive(ids))
})

describe('runConnectorTeardownSlice — the status is the claim', () => {
  it('stops when the connector is already gone', async () => {
    h.connector = undefined

    const outcome = await runConnectorTeardownSlice(db(), job())

    expect(outcome).toEqual({ processed: 0, failed: 0, finished: true })
    expect(h.enqueueConnectorTeardown).not.toHaveBeenCalled()
    expect(h.finalizeConnectorTeardown).not.toHaveBeenCalled()
  })

  it('stops when the connector is no longer marked deleting', async () => {
    // Someone resumed it, or a sibling slice already finished. Continuing would
    // delete records out from under a connector that is live again.
    h.connector = { id: 'conn_1', status: 'live' }
    seed('inst_1')

    const outcome = await runConnectorTeardownSlice(db(), job())

    expect(outcome.finished).toBe(false)
    expect(h.bulkDelete).not.toHaveBeenCalled()
    expect(h.enqueueConnectorTeardown).not.toHaveBeenCalled()
  })
})

describe('runConnectorTeardownSlice — the chain', () => {
  it('removes a batch and enqueues the next slice', async () => {
    h.rows.set('inst_1', { id: 'inst_1', defId: 'def_1', archived: false })
    h.rows.set('inst_2', { id: 'inst_2', defId: 'def_2', archived: false })

    const outcome = await runConnectorTeardownSlice(db(), job())

    expect(h.bulkDelete).toHaveBeenCalledWith(['def_1:inst_1', 'def_2:inst_2'])
    expect(outcome).toEqual({ processed: 2, failed: 0, finished: false })
    expect(h.enqueueConnectorTeardown).toHaveBeenCalled()
    // Nothing is finalized while records remain.
    expect(h.finalizeConnectorTeardown).not.toHaveBeenCalled()
  })

  it('enqueues the successor WITHOUT a dedup id', async () => {
    // 🛑 The regression this pins, seen live: the continuation reused the
    // opening enqueue's fixed `jobId`. This handler is still active and still
    // holds that id, so BullMQ returned the existing job and added nothing —
    // the chain ran exactly ONE slice and parked the connector in `deleting`
    // with 19,600 of 21,654 records still there.
    seed('inst_1')

    await runConnectorTeardownSlice(db(), job())

    expect(h.enqueueConnectorTeardown).toHaveBeenCalledTimes(1)
    const [, opts] = h.enqueueConnectorTeardown.mock.calls[0] ?? []
    expect(opts?.dedupe).toBeFalsy()
  })

  it('finalizes and stops when no minted records are left', async () => {
    const outcome = await runConnectorTeardownSlice(db(), job())

    expect(outcome.finished).toBe(true)
    expect(h.finalizeConnectorTeardown).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      'user_1',
      'conn_1',
      'delete'
    )
    expect(h.enqueueConnectorTeardown).not.toHaveBeenCalled()
  })

  it('archives instead of deleting when the behaviour says so', async () => {
    seed('inst_1')

    const outcome = await runConnectorTeardownSlice(db(), job('archive'))

    expect(h.bulkArchive).toHaveBeenCalledWith(['def_1:inst_1'])
    expect(h.bulkDelete).not.toHaveBeenCalled()
    expect(outcome.processed).toBe(1)
  })
})

describe('runConnectorTeardownSlice — every behaviour terminates', () => {
  it('delete drains the set and finalizes', async () => {
    seed('inst_1', 'inst_2', 'inst_3')

    const result = await runChain('delete')

    expect(result.finished).toBe(true)
    expect(h.rows.size).toBe(0)
    expect(h.finalizeConnectorTeardown).toHaveBeenCalled()
  })

  it('archive drains the set and finalizes', async () => {
    // 🛑 THE REGRESSION. Archiving does not null the provenance columns, so
    // without an `archivedAt IS NULL` predicate on the scan the same rows come
    // back every slice: slice 2 archived nothing, reported no error (a
    // re-archive is not a failure), sailed past the old `failed > 0 &&
    // processed === 0` stop, and enqueued another slice. Forever — the
    // connector was never removed and the queue never went quiet.
    seed('inst_1', 'inst_2', 'inst_3')

    const result = await runChain('archive')

    expect(result.ranOut).toBe(false)
    expect(result.finished).toBe(true)
    expect([...h.rows.values()].every((row) => row.archived)).toBe(true)
    expect(h.finalizeConnectorTeardown).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      'user_1',
      'conn_1',
      'archive'
    )
  })

  it('asks for the archived filter on archive and NOT on delete', async () => {
    // A delete must still hard-delete a record that is already archived.
    seed('inst_1')
    await runConnectorTeardownSlice(db(), job('archive'))
    expect(h.scan.excludeArchived).toBe(true)

    seed('inst_1')
    await runConnectorTeardownSlice(db(), job('delete'))
    expect(h.scan.excludeArchived).toBe(false)
  })

  it('stops when a slice moves nothing, even with no error to show for it', async () => {
    // The backstop for the archive loop and anything else that stalls: a slice
    // that neither moved a record nor learned a new refusal would hand the next
    // slice the identical batch. The old guard keyed on `failed > 0` and so
    // never fired for a silent no-op.
    seed('inst_1')
    h.bulkDelete.mockResolvedValue({ count: 0, errors: [] })

    const outcome = await runConnectorTeardownSlice(db(), job())

    expect(outcome.finished).toBe(false)
    expect(h.enqueueConnectorTeardown).not.toHaveBeenCalled()
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'delete_failed' }))
  })
})

describe('runConnectorTeardownSlice — refusals do not strand the teardown', () => {
  it('parks the distinct refusal reasons on the connector and keeps going', async () => {
    // The inline teardown this replaces discarded `BulkDeleteResult` entirely
    // and still returned `{ success: true }`, so a settled-period refusal from
    // `guardPartDelete` vanished without trace.
    seed('inst_1', 'inst_2')
    h.bulkDelete.mockImplementation(async () => {
      h.rows.delete('inst_1')
      return {
        count: 1,
        errors: [
          { recordId: 'def_1:inst_2', message: 'This part has 3 stock movements', statusCode: 400 },
        ],
      }
    })

    const outcome = await runConnectorTeardownSlice(db(), job())

    expect(outcome).toEqual({ processed: 1, failed: 1, finished: false })
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('This part has 3 stock movements'),
      })
    )
    expect(h.enqueueConnectorTeardown).toHaveBeenCalled()
  })

  it('carries a refusal forward so the next slice stops re-reading it', async () => {
    seed('inst_1', 'inst_2')
    h.bulkDelete.mockImplementation(async () => {
      h.rows.delete('inst_1')
      return { count: 1, errors: [{ recordId: 'def_1:inst_2', message: 'no', statusCode: 400 }] }
    })

    await runConnectorTeardownSlice(db(), job())

    const next = h.enqueueConnectorTeardown.mock.calls[0]?.[0] as { skipInstanceIds?: string[] }
    expect(next.skipInstanceIds).toEqual(['inst_2'])
  })

  it('finishes the removable records, then parks terminally on the refused ones', async () => {
    // 🛑 The dead end this closes. 198 shipped orders whose fulfillment entries
    // are still standing refuse forever, and the chain used to stop dead on the
    // first all-refused slice, leaving the connector `deleting` — a status the
    // detail view disables every action on. The teardown now drains everything
    // it can and ends in a state the operator can act on.
    seed('inst_1', 'inst_2', 'inst_3')
    h.bulkDelete.mockImplementation(async (ids: string[]) => {
      const errors = []
      let count = 0
      for (const recordId of ids) {
        const id = recordId.split(':')[1] as string
        if (id === 'inst_3') {
          errors.push({ recordId, message: 'ledger entry still standing', statusCode: 400 })
          continue
        }
        h.rows.delete(id)
        count++
      }
      return { count, errors }
    })

    const result = await runChain('delete')

    expect(result.ranOut).toBe(false)
    expect(result.finished).toBe(false)
    // Everything removable really was removed.
    expect([...h.rows.keys()]).toEqual(['inst_3'])
    // And the connector is terminal, not stuck mid-teardown.
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'delete_failed',
        error: expect.stringContaining('1 record(s) still present'),
      })
    )
    expect(h.finalizeConnectorTeardown).not.toHaveBeenCalled()
  })

  it('retries an UNEXPECTED failure instead of writing the record off', async () => {
    // `statusCode: undefined` is a deadlock, a timeout, a blip — not a verdict.
    // Skipping it would quietly abandon a record the next slice could remove.
    seed('inst_1', 'inst_2')
    h.bulkDelete.mockImplementation(async () => {
      h.rows.delete('inst_1')
      return { count: 1, errors: [{ recordId: 'def_1:inst_2', message: 'deadlock detected' }] }
    })

    await runConnectorTeardownSlice(db(), job())

    const next = h.enqueueConnectorTeardown.mock.calls[0]?.[0] as { skipInstanceIds?: string[] }
    expect(next.skipInstanceIds).toEqual([])
  })

  it('gives up rather than growing the skip list without bound', async () => {
    seed('inst_1')
    const overCap = Array.from({ length: TEARDOWN_SKIP_CAP + 1 }, (_, i) => `old_${i}`)
    h.bulkDelete.mockResolvedValue({
      count: 0,
      errors: [{ recordId: 'def_1:inst_1', message: 'refused', statusCode: 409 }],
    })

    const outcome = await runConnectorTeardownSlice(db(), job('delete', overCap))

    expect(outcome.finished).toBe(false)
    expect(h.enqueueConnectorTeardown).not.toHaveBeenCalled()
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'delete_failed' }))
  })

  it('collapses repeated reasons — the user needs the reason, not 400 copies', async () => {
    seed('inst_1')
    h.bulkDelete.mockImplementation(async () => {
      h.rows.delete('inst_1')
      return {
        count: 1,
        errors: Array.from({ length: 40 }, (_, i) => ({
          recordId: `def_1:inst_${i}`,
          message: 'settled period',
          statusCode: 400,
        })),
      }
    })

    await runConnectorTeardownSlice(db(), job())

    const patch = h.update.mock.calls[0]?.[0] as { error: string }
    expect(patch.error).toBe('40 record(s) could not be removed. settled period')
  })
})
