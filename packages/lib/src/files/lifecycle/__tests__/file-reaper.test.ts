// packages/lib/src/files/lifecycle/__tests__/file-reaper.test.ts

/**
 * `lifecycle/file-reaper.ts` — the three scheduled sweeps. **Zero `vi.mock` calls.**
 *
 * The predecessor of this file (`__tests__/orphaned-cleanup.test.ts`) needed
 * four: `@auxx/database`, `@auxx/logger`, `../cleanup-service` and
 * `../../storage/storage-manager`. The reapers take their `db` and their storage
 * seam as parameters now, so every one of those is a plain object literal from
 * `files/__tests__/support`.
 *
 * What these assert, in order of why they exist:
 *
 * 1. **The soft-delete sweep deletes.** It never used to: the old job selected
 *    `deletedAt < now - 30d` rows and handed the ids to a helper that re-filtered
 *    on `deletedAt IS NULL`, an empty intersection, while still reporting every
 *    scanned row as `status: 'deleted'`.
 * 2. **Object before row.** The row is the only record of the storage key, so a
 *    storage failure must abort that file rather than orphan its object.
 * 3. **`organizationId` reaches the SQL.** #1851 found three of four thumbnail
 *    sweeps destructuring a filter they never applied.
 * 4. **No invented bucket.** #1816/#1817/#1818: S3 answers 204 for a delete
 *    aimed at a bucket the key was never in.
 * 5. **`dryRun` touches nothing.** Both old jobs passed
 *    `deleteFromStorage: true` unconditionally.
 */

import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEST_INSTANT,
  makeClock,
  makeDb,
  makeJournal,
  TEST_IDS,
} from '../../__tests__/support'
import type { FileReaperDeps } from '../file-reaper'
import {
  bucketOf,
  reapExpiredFolderFiles,
  reapMarkedStorageLocations,
  reapSoftDeletedFolderFiles,
} from '../file-reaper'

const TABLES = {
  Attachment: schema.Attachment,
  FileVersion: schema.FileVersion,
  FolderFile: schema.FolderFile,
  StorageLocation: schema.StorageLocation,
}

const OTHER_ORG = 'org_other'

/**
 * Every literal bound into a Drizzle clause, flattened.
 *
 * The db stub stores the `SQL` object a statement was given without
 * interpreting it, so this is how a test reads the *values* back out. Column
 * identities are not recoverable — this package's `@auxx/database` mock hands
 * out `{}` for every table — but the bound values, which is what an
 * organization filter and a cutoff date are, are real. A hand-rolled walk rather
 * than `JSON.stringify`, because a Drizzle `Param` carries an encoder that
 * cycles.
 */
function boundValues(clause: unknown): string[] {
  const found: string[] = []
  const seen = new Set<unknown>()

  const walk = (node: unknown) => {
    if (node === null || node === undefined) return
    if (node instanceof Date) {
      found.push(node.toISOString())
      return
    }
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      found.push(String(node))
      return
    }
    if (typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    for (const value of Object.values(node as Record<string, unknown>)) walk(value)
  }

  walk(clause)
  return found
}

interface StorageCalls {
  locations: Array<{ organizationId?: string; locationId: string }>
  objects: Array<{ organizationId?: string; provider: string; key: string; bucket?: string }>
}

/**
 * A recording {@link FileReaperDeps} sharing the db stub's journal, so
 * "object before row" is one `journal.ops()` comparison rather than two
 * unrelated call lists.
 */
function makeReaperDeps(
  journal = makeJournal(),
  options: { failOn?: string } = {}
): { deps: FileReaperDeps; calls: StorageCalls; journal: ReturnType<typeof makeJournal> } {
  const calls: StorageCalls = { locations: [], objects: [] }

  const deps: FileReaperDeps = {
    now: makeClock().now,
    storage: {
      async deleteLocation(params) {
        journal.record('storage', 'deleteLocation', { locationId: params.locationId })
        calls.locations.push(params)
        if (options.failOn === params.locationId) throw new Error('S3 down')
      },
      async deleteObject(params) {
        journal.record('storage', 'deleteObject', { key: params.key, bucket: params.bucket })
        calls.objects.push(params)
        if (options.failOn === params.key) throw new Error('S3 down')
      },
    },
  }

  return { deps, calls, journal }
}

function aFolderFileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file_1',
    name: 'invoice.pdf',
    organizationId: TEST_IDS.organizationId,
    size: 1024,
    versionSize: 2048,
    storageLocationId: 'loc_1',
    ...overrides,
  }
}

function aMarkedLocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'loc_public',
    provider: 'S3',
    externalId: 'org123/avatars/a.png',
    organizationId: TEST_IDS.organizationId,
    size: 512,
    metadata: { bucket: 'test-public-bucket', key: 'org123/avatars/a.png' },
    ...overrides,
  }
}

describe('reapSoftDeletedFolderFiles', () => {
  it('actually deletes the rows it scanned', async () => {
    const journal = makeJournal()
    const db = makeDb({ select: [[aFolderFileRow()]], tables: TABLES, journal })
    const { deps, calls } = makeReaperDeps(journal)

    const result = await reapSoftDeletedFolderFiles(db.db, deps)

    expect(result._unsafeUnwrap()).toMatchObject({ scanned: 1, deleted: 1, failed: 0 })
    expect(calls.locations).toEqual([
      { organizationId: TEST_IDS.organizationId, locationId: 'loc_1' },
    ])
    expect(db.deletes).toEqual([{ table: 'FolderFile' }])
  })

  it('removes the storage object before the row', async () => {
    const journal = makeJournal()
    const db = makeDb({ select: [[aFolderFileRow()]], tables: TABLES, journal })
    const { deps } = makeReaperDeps(journal)

    await reapSoftDeletedFolderFiles(db.db, deps)

    expect(journal.ops()).toEqual(['select', 'deleteLocation', 'delete'])
  })

  it('leaves the row alone when storage fails, so the next run can retry', async () => {
    const journal = makeJournal()
    const db = makeDb({ select: [[aFolderFileRow()]], tables: TABLES, journal })
    const { deps } = makeReaperDeps(journal, { failOn: 'loc_1' })

    const result = await reapSoftDeletedFolderFiles(db.db, deps)

    expect(result._unsafeUnwrap()).toMatchObject({ scanned: 1, deleted: 0, failed: 1 })
    expect(result._unsafeUnwrap().rows[0]).toMatchObject({ status: 'error', error: 'S3 down' })
    expect(db.deletes).toEqual([])
  })

  it('scopes the DELETE to the row organization as well as its id', async () => {
    const db = makeDb({
      select: [[aFolderFileRow({ organizationId: OTHER_ORG })]],
      tables: TABLES,
    })
    const { deps } = makeReaperDeps()

    await reapSoftDeletedFolderFiles(db.db, deps)

    // The last `where` recorded is the DELETE's; the first is the scan's.
    const del = db.wheres.at(-1)
    expect(del?.table).toBe('FolderFile')
    expect(boundValues(del?.predicate)).toContain(OTHER_ORG)
  })

  it('reports what it would do without touching anything on a dry run', async () => {
    const journal = makeJournal()
    const db = makeDb({ select: [[aFolderFileRow()]], tables: TABLES, journal })
    const { deps, calls } = makeReaperDeps(journal)

    const result = await reapSoftDeletedFolderFiles(db.db, deps, { dryRun: true })

    expect(result._unsafeUnwrap()).toMatchObject({ scanned: 1, deleted: 1, storageFreed: 2048 })
    expect(calls.locations).toEqual([])
    expect(db.deletes).toEqual([])
  })
})

describe('reapExpiredFolderFiles', () => {
  it('measures its cutoff from the injected clock, not the wall clock', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })
    const { deps } = makeReaperDeps()

    await reapExpiredFolderFiles(db.db, deps, { maxAgeHours: 24 })

    const expected = new Date(new Date(DEFAULT_TEST_INSTANT).getTime() - 24 * 60 * 60 * 1000)
    expect(boundValues(db.wheres[0]?.predicate)).toContain(expected.toISOString())
  })

  it('puts the organization filter in the SQL when one is given', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })
    const { deps } = makeReaperDeps()

    await reapExpiredFolderFiles(db.db, deps, { organizationId: OTHER_ORG })

    expect(boundValues(db.wheres[0]?.predicate)).toContain(OTHER_ORG)
  })

  it('does not scope to any organization when none is given', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })
    const { deps } = makeReaperDeps()

    await reapExpiredFolderFiles(db.db, deps)

    expect(boundValues(db.wheres[0]?.predicate)).not.toContain(TEST_IDS.organizationId)
  })
})

describe('reapMarkedStorageLocations', () => {
  it('deletes from the bucket recorded on the row, not a provider default', async () => {
    const db = makeDb({ select: [[aMarkedLocation()]], tables: TABLES })
    const { deps, calls } = makeReaperDeps()

    const result = await reapMarkedStorageLocations(db.db, deps)

    expect(result._unsafeUnwrap()).toMatchObject({ scanned: 1, deleted: 1 })
    expect(calls.objects[0]).toMatchObject({
      provider: 'S3',
      key: 'org123/avatars/a.png',
      bucket: 'test-public-bucket',
    })
  })

  it('leaves the bucket undefined for a row that has none rather than inventing one', async () => {
    const db = makeDb({ select: [[aMarkedLocation({ metadata: {} })]], tables: TABLES })
    const { deps, calls } = makeReaperDeps()

    await reapMarkedStorageLocations(db.db, deps)

    expect(calls.objects[0]?.bucket).toBeUndefined()
  })

  it('keeps the row when the object could not be removed', async () => {
    const db = makeDb({ select: [[aMarkedLocation()]], tables: TABLES })
    const { deps } = makeReaperDeps(makeJournal(), { failOn: 'org123/avatars/a.png' })

    const result = await reapMarkedStorageLocations(db.db, deps)

    expect(result._unsafeUnwrap()).toMatchObject({ deleted: 0, failed: 1 })
    expect(db.deletes).toEqual([])
  })

  it('scopes the DELETE to the row organization', async () => {
    const db = makeDb({
      select: [[aMarkedLocation({ organizationId: OTHER_ORG })]],
      tables: TABLES,
    })
    const { deps } = makeReaperDeps()

    await reapMarkedStorageLocations(db.db, deps)

    const del = db.wheres.at(-1)
    expect(del?.table).toBe('StorageLocation')
    expect(boundValues(del?.predicate)).toContain(OTHER_ORG)
  })
})

describe('bucketOf', () => {
  it.each([
    [{ bucket: 'b' }, 'b'],
    [{ bucket: '' }, undefined],
    [{}, undefined],
    [null, undefined],
    [undefined, undefined],
    [{ bucket: 42 }, undefined],
  ])('reads %j as %j', (metadata, expected) => {
    expect(bucketOf(metadata)).toBe(expected)
  })
})
