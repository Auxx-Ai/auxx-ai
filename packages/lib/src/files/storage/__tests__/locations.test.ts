// packages/lib/src/files/storage/__tests__/locations.test.ts

/**
 * The Phase-2 **write pilot** test.
 *
 * Two properties are the real deliverable here, and Phase 6 needs exactly them
 * at scale:
 *
 * 1. `createStorageLocation` performs **no** storage, queue or cache call. The
 *    ports share one {@link makeJournal} with the db stub, so "only database
 *    statements happened" is a single assertion over one monotonic sequence
 *    rather than three separate call lists nobody can interleave.
 * 2. `createStorageLocation` never opens a transaction of its own. The journal
 *    records `begin`/`commit`, so "exactly one pair, and the test opened it" is
 *    assertable directly — which is what `BaseService.getTx()` made impossible,
 *    since it decided at runtime and silently issued a `SAVEPOINT` every time.
 *
 * And, as with every test written to the `files/` contract: **`vi.mock` is
 * called zero times in this file.** (`src/test/setup.ts` still mocks
 * `@auxx/database` package-wide — pre-existing, and separately tracked.)
 */

import type { Database, Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  anOrg,
  aStorageLocation,
  makeCachePort,
  makeCtx,
  makeDb,
  makeJournal,
  makeQueuePort,
  makeStoragePort,
  TEST_BUCKETS,
  TEST_IDS,
} from '../../__tests__/support'
import {
  type CreateStorageLocationInput,
  createStorageLocation,
  deleteStorageLocation,
} from '../locations'

const KEY = 'org_test/media-asset/ast_test/photo.png'

/**
 * Borrow the db stub as a `Transaction`.
 *
 * `makeDb` hands out one recording surface and types it `Database`, because
 * that is what `FilesCtx.db` wants. Tests that are not asserting on a real
 * `BEGIN`/`COMMIT` pair still need something in the `tx` slot, and the cast is
 * confined to this one line so it can never be mistaken for the production
 * shortcut the signature exists to forbid. The transaction tests below take the
 * genuine `Transaction` from `db.transaction(...)` instead.
 */
const asTx = (db: Database): Transaction => db as unknown as Transaction

/** A valid input, so each test states only the field it is about. */
function anInput(overrides: Partial<CreateStorageLocationInput> = {}): CreateStorageLocationInput {
  return {
    provider: 'S3',
    externalId: KEY,
    bucket: TEST_BUCKETS.public,
    externalUrl: `https://cdn.test/${KEY}`,
    externalRev: 'etag-test',
    size: 1024,
    mimeType: 'image/png',
    ...overrides,
  }
}

/** `makeDb` with the table registered, so journal entries carry the real name. */
function aDb(options: Parameters<typeof makeDb>[0] = {}) {
  return makeDb({
    tables: { StorageLocation: schema.StorageLocation },
    insert: [[aStorageLocation()]],
    ...options,
  })
}

describe('createStorageLocation', () => {
  it('scopes the row to ctx.organizationId, never to anything on the input', async () => {
    const db = aDb()
    const otherOrg = anOrg({ id: 'org_actually_acting_for' })
    const ctx = makeCtx({ db: db.db, organizationId: otherOrg.id })

    // The input type has no `organizationId` at all; smuggling one in as an
    // excess property must not reach the INSERT.
    const smuggled = { ...anInput(), organizationId: 'org_attacker' } as CreateStorageLocationInput

    const result = await createStorageLocation(asTx(db.db), ctx, smuggled)

    expect(result.isOk()).toBe(true)
    expect(db.inserts).toHaveLength(1)
    const values = db.inserts[0]?.values as Record<string, unknown>
    expect(db.inserts[0]?.table).toBe('StorageLocation')
    expect(values.organizationId).toBe('org_actually_acting_for')
  })

  it('lands the bucket in the persisted metadata', async () => {
    const db = aDb()
    const ctx = makeCtx({ db: db.db })

    await createStorageLocation(asTx(db.db), ctx, anInput({ bucket: TEST_BUCKETS.public }))

    const values = db.inserts[0]?.values as { metadata: Record<string, unknown> }
    // The whole reason for the pilot: a row without this is undeletable by key,
    // because `deleteByKey` falls back to `S3_PRIVATE_BUCKET` and S3 answers
    // 204 for a key that is not in the bucket you named. Bugs #1816/#1817/#1818.
    expect(values.metadata.bucket).toBe(TEST_BUCKETS.public)
    expect(values.metadata.key).toBe(KEY)
  })

  it('lets the caller-supplied bucket win over one inherited from metadata', async () => {
    const db = aDb()
    const ctx = makeCtx({ db: db.db })

    await createStorageLocation(
      asTx(db.db),
      ctx,
      anInput({
        bucket: TEST_BUCKETS.public,
        metadata: { bucket: TEST_BUCKETS.private, source: 'upstream-payload' },
      })
    )

    const values = db.inserts[0]?.values as { metadata: Record<string, unknown> }
    expect(values.metadata.bucket).toBe(TEST_BUCKETS.public)
    expect(values.metadata.source).toBe('upstream-payload')
  })

  it('rejects a missing bucket instead of writing an undeletable row', async () => {
    const db = aDb()
    const ctx = makeCtx({ db: db.db })

    const result = await createStorageLocation(asTx(db.db), ctx, anInput({ bucket: '' }))

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().statusCode).toBe(400)
    expect(result._unsafeUnwrapErr().message).toContain('without a bucket')
    // Rejected before the statement, not after it.
    expect(db.inserts).toHaveLength(0)
    expect(db.journal.ops('db')).toEqual([])
  })

  it('rejects a provider that has no adapter', async () => {
    const db = aDb()
    const ctx = makeCtx({ db: db.db })

    const result = await createStorageLocation(asTx(db.db), ctx, anInput({ provider: 'DROPBOX' }))

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().statusCode).toBe(400)
    expect(db.inserts).toHaveLength(0)
  })

  it('performs no storage, queue or cache call — only database statements', async () => {
    const journal = makeJournal()
    const db = aDb({ journal })
    // The ports are wired to the same journal even though the function takes no
    // `FilesDeps`: that is the assertion. If a later edit reaches for a port,
    // a foreign channel appears in this sequence and this test fails.
    const storage = makeStoragePort({ journal })
    const queue = makeQueuePort({ journal })
    const cache = makeCachePort({ journal })
    const ctx = makeCtx({ db: db.db })

    const result = await createStorageLocation(asTx(db.db), ctx, anInput())

    expect(result.isOk()).toBe(true)
    expect(journal.entries.every((e) => e.channel === 'db')).toBe(true)
    expect(journal.ops()).toEqual(['insert'])
    expect(storage.calls).toEqual([])
    expect(queue.calls).toEqual([])
    expect(cache.busts).toEqual([])
  })

  it('never opens a transaction of its own — the caller owns the boundary', async () => {
    const journal = makeJournal()
    const db = aDb({ journal })
    const storage = makeStoragePort({ journal })
    const queue = makeQueuePort({ journal })
    const cache = makeCachePort({ journal })
    const ctx = makeCtx({ db: db.db })

    // The test opens the one and only transaction, exactly as a route would.
    // Note `{ ...ctx, db: tx }`: a stale ctx holding the pool must never leak in.
    await (db.db as Database).transaction(async (tx) => {
      const result = await createStorageLocation(tx, { ...ctx, db: tx }, anInput())
      expect(result.isOk()).toBe(true)
    })

    // One BEGIN…COMMIT pair, opened by the test. `BaseService.getTx()` would
    // have added a SAVEPOINT here, because `NodePgTransaction.transaction()`
    // exists in drizzle-orm 0.44 and its "am I already in a transaction?"
    // detection branch is therefore unreachable.
    expect(db.transactions).toBe(1)
    expect(journal.ops('db')).toEqual(['begin', 'insert', 'commit'])

    // And nothing but SQL between the two — the Phase 6 assertion, in one line.
    expect(journal.between('begin', 'commit').every((e) => e.channel === 'db')).toBe(true)
    expect(storage.calls).toEqual([])
    expect(queue.calls).toEqual([])
    expect(cache.busts).toEqual([])
  })

  it('rolls the caller transaction back by throwing, never by returning err()', async () => {
    const journal = makeJournal()
    const db = aDb({ journal })
    const ctx = makeCtx({ db: db.db })

    // The footgun this file's header documents: `db.transaction` rolls back on
    // THROW. An `err()` is an ordinary resolved value, so a body that returns
    // one commits the rows it just told the caller had failed. A caller that
    // wants rollback has to convert — and here it does.
    await expect(
      (db.db as Database).transaction(async (tx) => {
        const result = await createStorageLocation(tx, { ...ctx, db: tx }, anInput({ bucket: '' }))
        if (result.isErr()) throw result.error
      })
    ).rejects.toThrow('without a bucket')

    expect(journal.ops('db')).toEqual(['begin', 'rollback'])
    expect(db.inserts).toHaveLength(0)
  })

  it('returns the persisted row on success', async () => {
    const persisted = aStorageLocation({ id: 'loc_written' })
    const db = aDb({ insert: [[persisted]] })
    const ctx = makeCtx({ db: db.db })

    const result = await createStorageLocation(asTx(db.db), ctx, anInput())

    expect(result._unsafeUnwrap().id).toBe('loc_written')
    expect(result._unsafeUnwrap().organizationId).toBe(TEST_IDS.organizationId)
  })
})

describe('deleteStorageLocation', () => {
  it('scopes the DELETE to ctx.organizationId, not to the id alone', async () => {
    const db = aDb()
    const ctx = makeCtx({ db: db.db, organizationId: 'org_actually_acting_for' })

    const result = await deleteStorageLocation(asTx(db.db), ctx, 'loc_target')

    expect(result.isOk()).toBe(true)
    expect(db.deletes).toEqual([{ table: 'StorageLocation' }])
    // `StorageLocationService.delete` deleted by bare id, so a wrong id reached
    // straight into another tenant's rows. The second condition is the fix.
    expect(db.wheres[0]?.predicate).toEqual(
      and(
        eq(schema.StorageLocation.id, 'loc_target'),
        eq(schema.StorageLocation.organizationId, 'org_actually_acting_for')
      )
    )
  })

  it('hard-deletes rather than stamping deletedAt', async () => {
    const db = aDb()
    const ctx = makeCtx({ db: db.db })

    await deleteStorageLocation(asTx(db.db), ctx, TEST_IDS.storageLocationId)

    // `StorageLocation.deletedAt` is the *sweep* marker `lifecycle/
    // orphaned-cleanup.ts` reads to find rows whose S3 object still needs
    // removing. Soft-deleting here would hand the sweeper a row whose object
    // the caller has already deleted.
    expect(db.journal.ops('db')).toEqual(['delete'])
    expect(db.updates).toEqual([])
  })

  it('resolves ok when the row was already gone', async () => {
    const db = aDb({ delete: [[]] })
    const ctx = makeCtx({ db: db.db })

    const result = await deleteStorageLocation(asTx(db.db), ctx, 'loc_never_existed')

    // "Already gone" and "never yours" are the same non-event to a delete, and
    // neither is worth failing the caller's transaction over.
    expect(result.isOk()).toBe(true)
  })

  it('performs no storage, queue or cache call — only database statements', async () => {
    const journal = makeJournal()
    const db = aDb({ journal })
    const storage = makeStoragePort({ journal })
    const queue = makeQueuePort({ journal })
    const cache = makeCachePort({ journal })
    const ctx = makeCtx({ db: db.db })

    await deleteStorageLocation(asTx(db.db), ctx, TEST_IDS.storageLocationId)

    // The S3 object is the caller's problem: this function takes no `FilesDeps`,
    // so there is nothing here to call, and this is the assertion that says so.
    expect(journal.entries.every((e) => e.channel === 'db')).toBe(true)
    expect(storage.calls).toEqual([])
    expect(queue.calls).toEqual([])
    expect(cache.busts).toEqual([])
  })

  it('never opens a transaction of its own — the caller owns the boundary', async () => {
    const journal = makeJournal()
    const db = aDb({ journal })
    const ctx = makeCtx({ db: db.db })

    await (db.db as Database).transaction(async (tx) => {
      const result = await deleteStorageLocation(tx, { ...ctx, db: tx }, 'loc_target')
      expect(result.isOk()).toBe(true)
    })

    expect(db.transactions).toBe(1)
    expect(journal.ops('db')).toEqual(['begin', 'delete', 'commit'])
  })
})

describe('the transaction-only signature', () => {
  /**
   * The convention this whole pilot rests on, checked by `tsc` rather than by
   * Vitest (which does not typecheck).
   *
   * `FilesCtx.db` is `Database | Transaction`, so a `ctx`-only signature would
   * accept a connection pool and the write would silently stop being part of
   * the caller's unit of work. A bare `Transaction` slot must reject a pool —
   * if `Database` ever becomes assignable to it, this constant's type flips to
   * `false` and the assignment below stops compiling.
   */
  it('rejects a Database in the tx slot at compile time', () => {
    type TxSlot = Parameters<typeof createStorageLocation>[0]
    const poolIsRejected: Database extends TxSlot ? false : true = true

    type DeleteTxSlot = Parameters<typeof deleteStorageLocation>[0]
    const poolIsRejectedByDelete: Database extends DeleteTxSlot ? false : true = true

    expect(poolIsRejected).toBe(true)
    expect(poolIsRejectedByDelete).toBe(true)
  })
})
