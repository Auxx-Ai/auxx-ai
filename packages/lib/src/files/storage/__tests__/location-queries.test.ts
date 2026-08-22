// packages/lib/src/files/storage/__tests__/location-queries.test.ts

/**
 * The `StorageLocation` reads.
 *
 * As with every test written to the `files/ctx.ts` contract: **`vi.mock` is
 * called zero times in this file.** (`src/test/setup.ts` still mocks
 * `@auxx/database` package-wide — pre-existing, and separately tracked.)
 *
 * ## How the organization scope is asserted, and what that proof is worth
 *
 * `makeDb` is a recording stub, not a Drizzle emulator: it never looks at a
 * `where`, so handing it a foreign row and watching it come back proves
 * nothing — it would come back with the filter deleted too. So the scope tests
 * below compare the `SQL` object the function *built* against one the test
 * builds with the same `and`/`eq`/`isNull`.
 *
 * That comparison is real for the bound values, the operators, and their order.
 * It is **blind to column identity**: this package's `@auxx/database` mock hands
 * out `{}` for every table, so `schema.StorageLocation.organizationId` is
 * `undefined` and every column renders as the same empty chunk. What the
 * assertions therefore establish is "three conditions, ANDed, binding exactly
 * these values, with `IS NULL` last" — enough to catch a dropped org filter or a
 * dropped soft-delete filter, not enough to catch a filter on the wrong column.
 * That last one belongs to the integration lane, and so does the `ORDER BY
 * createdAt DESC` on `findStorageLocationByExternalId` — the stub records no
 * `orderBy`, and a `LIMIT 1` whose ordering is only asserted by reading the
 * source is not asserted at all. Stated here rather than covered by a test that
 * looks like it checks something and does not.
 */

import { schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  aStorageLocation,
  makeCachePort,
  makeCtx,
  makeDb,
  makeJournal,
  makeQueuePort,
  makeStoragePort,
  TEST_IDS,
} from '../../__tests__/support'
import { findStorageLocationByExternalId, getStorageLocation } from '../location-queries'

const KEY = 'org_test/media-asset/ast_test/photo.png'

/** `makeDb` with the table registered, so recorded entries carry the real name. */
function aDb(options: Parameters<typeof makeDb>[0] = {}) {
  return makeDb({
    tables: { StorageLocation: schema.StorageLocation },
    ...options,
  })
}

describe('getStorageLocation', () => {
  it('returns the row the query matched', async () => {
    const db = aDb({ select: [[aStorageLocation({ id: 'loc_wanted' })]] })
    const ctx = makeCtx({ db: db.db })

    const result = await getStorageLocation(ctx, 'loc_wanted')

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()?.id).toBe('loc_wanted')
  })

  it('returns ok(null) rather than err when nothing matched', async () => {
    // "Does not exist", "soft-deleted" and "belongs to another org" all arrive
    // here as an empty result set, and all three must look identical to the
    // caller — otherwise the error text is a cross-tenant existence oracle.
    const db = aDb({ select: [[]] })
    const ctx = makeCtx({ db: db.db })

    const result = await getStorageLocation(ctx, 'loc_missing')

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBeNull()
  })

  it('filters on the id, the acting organization and live rows', async () => {
    const db = aDb({ select: [[]] })
    const ctx = makeCtx({ db: db.db, organizationId: 'org_actually_acting_for' })

    await getStorageLocation(ctx, 'loc_any')

    // `storageLocationService.get` bound the id and nothing else, so it would
    // return another tenant's row on an id collision or a guess. The middle
    // condition is the whole difference.
    expect(db.wheres).toHaveLength(1)
    expect(db.wheres[0]?.table).toBe('StorageLocation')
    expect(db.wheres[0]?.predicate).toEqual(
      and(
        eq(schema.StorageLocation.id, 'loc_any'),
        eq(schema.StorageLocation.organizationId, 'org_actually_acting_for'),
        isNull(schema.StorageLocation.deletedAt)
      )
    )
  })

  it('does not match a row scoped to another organization', async () => {
    const db = aDb({ select: [[]] })
    const ctx = makeCtx({ db: db.db, organizationId: 'org_mine' })

    await getStorageLocation(ctx, 'loc_any')

    // The negative half of the assertion above: the predicate a *different*
    // tenant would have produced must not be the one that was issued.
    expect(db.wheres[0]?.predicate).not.toEqual(
      and(
        eq(schema.StorageLocation.id, 'loc_any'),
        eq(schema.StorageLocation.organizationId, 'org_theirs'),
        isNull(schema.StorageLocation.deletedAt)
      )
    )
  })

  it('performs no storage, queue or cache call — only database statements', async () => {
    const journal = makeJournal()
    const db = aDb({ select: [[aStorageLocation()]], journal })
    const storage = makeStoragePort({ journal })
    const queue = makeQueuePort({ journal })
    const cache = makeCachePort({ journal })
    const ctx = makeCtx({ db: db.db })

    await getStorageLocation(ctx, TEST_IDS.storageLocationId)

    expect(journal.entries.every((e) => e.channel === 'db')).toBe(true)
    expect(journal.ops()).toEqual(['select'])
    expect(storage.calls).toEqual([])
    expect(queue.calls).toEqual([])
    expect(cache.busts).toEqual([])
  })

  it("never opens a transaction of its own, and runs inside the caller's one", async () => {
    const db = aDb({
      select: [[aStorageLocation()], [aStorageLocation({ id: 'loc_uncommitted' })]],
    })
    const ctx = makeCtx({ db: db.db })

    await getStorageLocation(ctx, TEST_IDS.storageLocationId)
    expect(db.transactions).toBe(0)

    // The point of `FilesCtx.db` being `Database | Transaction`: one read body
    // works on the pool and inside someone else's unit of work, where it sees
    // rows that transaction has written but not committed.
    const seen = await db.db.transaction((tx) => getStorageLocation({ ...ctx, db: tx }, 'loc_any'))

    expect(seen._unsafeUnwrap()?.id).toBe('loc_uncommitted')
    expect(db.journal.ops('db')).toEqual(['select', 'begin', 'select', 'commit'])
  })
})

describe('findStorageLocationByExternalId', () => {
  it('returns the single newest row, not the list the old service returned', async () => {
    // `StorageLocationService.findByExternalId` handed back every match ordered
    // `createdAt DESC`; its one caller read `[0]` and dropped the rest.
    const db = aDb({ select: [[aStorageLocation({ id: 'loc_newest' })]] })
    const ctx = makeCtx({ db: db.db })

    const result = await findStorageLocationByExternalId(ctx, 'S3', KEY)

    expect(result._unsafeUnwrap()?.id).toBe('loc_newest')
  })

  it('returns ok(null) when the key has never been stored', async () => {
    const db = aDb({ select: [[]] })
    const ctx = makeCtx({ db: db.db })

    const result = await findStorageLocationByExternalId(ctx, 'S3', KEY)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBeNull()
  })

  it('filters on provider, external id, the acting organization and live rows', async () => {
    const db = aDb({ select: [[]] })
    const ctx = makeCtx({ db: db.db, organizationId: 'org_acting' })

    await findStorageLocationByExternalId(ctx, 'S3', KEY)

    // The provider is a required parameter because an `externalId` is only
    // unique *within* one — an S3 key and a Dropbox path can collide.
    expect(db.wheres[0]?.predicate).toEqual(
      and(
        eq(schema.StorageLocation.provider, 'S3'),
        eq(schema.StorageLocation.externalId, KEY),
        eq(schema.StorageLocation.organizationId, 'org_acting'),
        isNull(schema.StorageLocation.deletedAt)
      )
    )
  })

  it('performs no storage, queue or cache call — only database statements', async () => {
    const journal = makeJournal()
    const db = aDb({ select: [[]], journal })
    const storage = makeStoragePort({ journal })
    const queue = makeQueuePort({ journal })
    const cache = makeCachePort({ journal })
    const ctx = makeCtx({ db: db.db })

    await findStorageLocationByExternalId(ctx, 'S3', KEY)

    expect(journal.ops()).toEqual(['select'])
    expect(storage.calls).toEqual([])
    expect(queue.calls).toEqual([])
    expect(cache.busts).toEqual([])
  })
})
