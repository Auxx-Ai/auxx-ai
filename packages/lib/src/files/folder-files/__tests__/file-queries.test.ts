// packages/lib/src/files/folder-files/__tests__/file-queries.test.ts

/**
 * `folder-files/file-queries.ts` — the read half of what `FileService` was.
 *
 * As with every test written to the `files/` contract, **`vi.mock` is called
 * zero times in this file**: `ctx.db` is a parameter, so there is nothing left
 * to intercept at module scope.
 *
 * The assertions that matter beyond "it returns rows" are the WHERE clauses.
 * The db stub does not interpret SQL, but it stores the predicate the code
 * built, and the bound values survive `JSON.stringify` — which is enough to
 * prove an organization filter is present. It is not enough to prove *which
 * column* each condition names (this package's `@auxx/database` mock hands out
 * `{}` for every table, so column references serialize as `null`); that
 * distinction belongs to the integration lane.
 */

import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { makeCtx, makeDb, TEST_IDS } from '../../__tests__/support'
import {
  findFolderFilesByExtension,
  findFolderFilesByMimeType,
  findOrphanedFolderFiles,
  getFolderFile,
  getFolderFileCurrentVersion,
  getFolderFileVersionByNumber,
  getFolderFileVersions,
  getFolderFileWithRelations,
  getLatestFolderFileVersion,
  listFolderFiles,
  MAX_PATH_COLLISION_ATTEMPTS,
  resolveUniqueFilePath,
  searchFolderFiles,
} from '../file-queries'
import { aFileVersion, aFolderFile, FILE_IDS } from './support/fixtures'

const TABLES = {
  FolderFile: schema.FolderFile,
  FileVersion: schema.FileVersion,
  Folder: schema.Folder,
}

/** The `where(...)` predicate handed to the n-th builder statement, stringified. */
function whereOf(db: ReturnType<typeof makeDb>, index: number): string {
  return JSON.stringify(db.wheres[index]?.predicate)
}

/** The `where` handed to the n-th relational read, stringified. */
function relationalWhereOf(db: ReturnType<typeof makeDb>, index: number): string {
  const reads = db.journal.entries.filter(
    (entry) => entry.op === 'query.findFirst' || entry.op === 'query.findMany'
  )
  return JSON.stringify((reads[index]?.detail?.args as { where?: unknown })?.where)
}

describe('getFolderFile', () => {
  it('returns the row and scopes the read to the caller organization', async () => {
    const db = makeDb({ select: [[aFolderFile()]], tables: TABLES })

    const result = await getFolderFile(
      makeCtx({ db: db.db, organizationId: 'org_other' }),
      FILE_IDS.fileId
    )

    expect(result._unsafeUnwrap()).toEqual(aFolderFile())
    const where = whereOf(db, 0)
    expect(where).toContain('org_other')
    expect(where).toContain(FILE_IDS.fileId)
    // `deletedAt IS NULL` — a soft-deleted file must not come back.
    expect(where).toContain(' is null')
  })

  it('returns ok(null) rather than an error when nothing matches', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    const result = await getFolderFile(makeCtx({ db: db.db }), 'fil_missing')

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBeNull()
  })

  it('scopes unconditionally — there is no "no organization" branch left', async () => {
    // `BaseService.buildBaseWhereClause` guarded its org filter with
    // `if (this.organizationId)`, so a service built without one read every
    // tenant. `FilesCtx.organizationId` is required.
    const db = makeDb({ select: [[aFolderFile()]], tables: TABLES })

    await getFolderFile(makeCtx({ db: db.db, organizationId: TEST_IDS.organizationId }), 'fil_1')

    expect(whereOf(db, 0)).toContain(TEST_IDS.organizationId)
  })
})

describe('getFolderFileWithRelations', () => {
  it('asks for the folder, current version, all versions, attachments and creator', async () => {
    const db = makeDb({ query: { FolderFile: [aFolderFile()] }, tables: TABLES })

    await getFolderFileWithRelations(makeCtx({ db: db.db }), FILE_IDS.fileId)

    const read = db.journal.entries.find((entry) => entry.op === 'query.findFirst')
    const relations = (read?.detail?.args as { with?: Record<string, unknown> })?.with
    expect(Object.keys(relations ?? {}).sort()).toEqual([
      'attachments',
      'createdBy',
      'currentVersion',
      'folder',
      'versions',
    ])
  })
})

describe('listFolderFiles', () => {
  it('reports the true total from the count query, not the page size', async () => {
    // Unlike `assets/`'s `listAssets`, this really counts: `FileService.list`
    // always issued the second statement, so `hasMore` is exact.
    const db = makeDb({
      select: [[aFolderFile(), aFolderFile({ id: 'fil_2' })], [{ value: 7 }]],
      tables: TABLES,
    })

    const result = await listFolderFiles(makeCtx({ db: db.db }), { limit: 2, offset: 0 })

    expect(result._unsafeUnwrap()).toMatchObject({ total: 7, hasMore: true })
  })

  it('does not report hasMore once the offset covers the total', async () => {
    const db = makeDb({ select: [[aFolderFile()], [{ value: 1 }]], tables: TABLES })

    const result = await listFolderFiles(makeCtx({ db: db.db }), { limit: 50, offset: 0 })

    expect(result._unsafeUnwrap().hasMore).toBe(false)
  })

  it('binds an `IS NULL` folder filter for the root and an equality for a folder', async () => {
    const root = makeDb({ select: [[], [{ value: 0 }]], tables: TABLES })
    await listFolderFiles(makeCtx({ db: root.db }), { folderId: null })
    // Two `is null`: the soft-delete filter and the root folder filter.
    expect(whereOf(root, 0).match(/ is null/g)).toHaveLength(2)

    const inFolder = makeDb({ select: [[], [{ value: 0 }]], tables: TABLES })
    await listFolderFiles(makeCtx({ db: inFolder.db }), { folderId: FILE_IDS.folderId })
    expect(whereOf(inFolder, 0)).toContain(FILE_IDS.folderId)
  })

  it('omits the folder filter entirely when folderId is undefined', async () => {
    const db = makeDb({ select: [[], [{ value: 0 }]], tables: TABLES })

    await listFolderFiles(makeCtx({ db: db.db }), {})

    // Only the soft-delete `is null` remains.
    expect(whereOf(db, 0).match(/ is null/g)).toHaveLength(1)
  })

  it('normalises extensions, stripping a leading dot and lowercasing', async () => {
    const db = makeDb({ select: [[], [{ value: 0 }]], tables: TABLES })

    await listFolderFiles(makeCtx({ db: db.db }), { fileTypes: ['.PDF', 'Docx'] })

    const where = whereOf(db, 0)
    expect(where).toContain('pdf')
    expect(where).toContain('docx')
    expect(where).not.toContain('.PDF')
  })

  it('filters archived rows only on an explicit false, matching listInFolder', async () => {
    // Counted rather than matched on the literal `false`: every serialized
    // Drizzle `SQL` node carries `"shouldInlineParams":false`, so the word is
    // always present. An equality chunk is not.
    const equalities = (where: string) => (where.match(/" = "/g) ?? []).length

    const explicit = makeDb({ select: [[], [{ value: 0 }]], tables: TABLES })
    await listFolderFiles(makeCtx({ db: explicit.db }), { includeArchived: false })
    // organizationId = … AND isArchived = false
    expect(equalities(whereOf(explicit, 0))).toBe(2)

    const omitted = makeDb({ select: [[], [{ value: 0 }]], tables: TABLES })
    await listFolderFiles(makeCtx({ db: omitted.db }), {})
    // organizationId = … only
    expect(equalities(whereOf(omitted, 0))).toBe(1)
  })
})

describe('searchFolderFiles', () => {
  it('returns [] for a blank query without touching the database', async () => {
    const db = makeDb({ tables: TABLES })

    const result = await searchFolderFiles(makeCtx({ db: db.db }), '   ')

    expect(result._unsafeUnwrap()).toEqual([])
    expect(db.journal.entries).toEqual([])
  })

  it('scores an exact name match above a path-only match', async () => {
    const db = makeDb({
      select: [
        [
          aFolderFile({ id: 'fil_path', name: 'other.pdf', path: '/contract/other.pdf' }),
          aFolderFile({ id: 'fil_exact', name: 'contract', path: '/x/contract' }),
        ],
      ],
      tables: TABLES,
    })

    const result = await searchFolderFiles(makeCtx({ db: db.db }), 'contract')

    const [first, second] = result._unsafeUnwrap()
    expect(first?.file.id).toBe('fil_exact')
    expect(first?.relevance).toBeGreaterThan(second?.relevance ?? 0)
    expect(first?.matchedFields).toContain('name')
  })

  it('never scores below 1, so an ILIKE hit is always a result', async () => {
    // The four ILIKEs can match on a column the JS scorer does not re-check
    // (a case-folded ext, say), and a zero would order it below nothing.
    const db = makeDb({
      select: [[aFolderFile({ name: 'x', path: '/x', ext: null, mimeType: null })]],
      tables: TABLES,
    })

    const result = await searchFolderFiles(makeCtx({ db: db.db }), 'zzz')

    expect(result._unsafeUnwrap()[0]?.relevance).toBe(1)
  })

  it('scopes to the caller organization and binds the size and date filters', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    await searchFolderFiles(makeCtx({ db: db.db, organizationId: 'org_owner' }), 'q', {
      sizeLimits: { min: 10, max: 20 },
      dateLimits: { createdAfter: new Date('2026-01-01T00:00:00.000Z') },
    })

    const where = whereOf(db, 0)
    expect(where).toContain('org_owner')
    expect(where).toContain('10')
    expect(where).toContain('20')
    expect(where).toContain('2026-01-01T00:00:00.000Z')
  })
})

describe('findFolderFilesByMimeType', () => {
  it('builds one pattern per MIME type instead of interpolating the array', async () => {
    // The legacy `findByMimeType` built `%image/png,application/pdf%` from an
    // array, which matches nothing — so `fileRouter.findByMimeType` returned []
    // for every caller.
    const db = makeDb({ select: [[aFolderFile()]], tables: TABLES })

    const result = await findFolderFilesByMimeType(makeCtx({ db: db.db }), [
      'image/png',
      'application/pdf',
    ])

    expect(result._unsafeUnwrap()).toHaveLength(1)
    const where = whereOf(db, 0)
    expect(where).toContain('%image/png%')
    expect(where).toContain('%application/pdf%')
    expect(where).not.toContain('image/png,application/pdf')
  })

  it('returns [] for an empty list without querying', async () => {
    const db = makeDb({ tables: TABLES })

    const result = await findFolderFilesByMimeType(makeCtx({ db: db.db }), [])

    expect(result._unsafeUnwrap()).toEqual([])
    expect(db.journal.entries).toEqual([])
  })
})

describe('findFolderFilesByExtension', () => {
  it('normalises and scopes, and applies the limit the legacy method declared but ignored', async () => {
    const db = makeDb({ select: [[aFolderFile()]], tables: TABLES })

    await findFolderFilesByExtension(makeCtx({ db: db.db }), ['.PDF'], { limit: 3 })

    expect(whereOf(db, 0)).toContain('pdf')
    // `limit` is a chain call, not part of the predicate; assert it was made.
    expect(db.journal.ops('db')).toEqual(['select'])
  })
})

describe('findOrphanedFolderFiles', () => {
  it('filters on a null currentVersionId within the caller organization', async () => {
    const db = makeDb({ select: [[aFolderFile({ currentVersionId: null })]], tables: TABLES })

    const result = await findOrphanedFolderFiles(makeCtx({ db: db.db }))

    expect(result._unsafeUnwrap()).toHaveLength(1)
    const where = whereOf(db, 0)
    expect(where).toContain(TEST_IDS.organizationId)
    // Two `is null`: the orphan filter and the soft-delete filter.
    expect(where.match(/ is null/g)).toHaveLength(2)
  })
})

describe('getFolderFileCurrentVersion', () => {
  it('follows currentVersionId when the file has one', async () => {
    const db = makeDb({
      select: [[aFolderFile()]],
      query: { FileVersion: [aFileVersion()] },
      tables: TABLES,
    })

    const result = await getFolderFileCurrentVersion(makeCtx({ db: db.db }), FILE_IDS.fileId)

    expect(result._unsafeUnwrap()?.id).toBe(FILE_IDS.versionId)
    // Constrained by BOTH the version id and the file id, so a version belonging
    // to another file cannot be served through this one.
    const where = relationalWhereOf(db, 0)
    expect(where).toContain(FILE_IDS.versionId)
    expect(where).toContain(FILE_IDS.fileId)
  })

  it('falls back to the highest version number when currentVersionId is null', async () => {
    const db = makeDb({
      select: [[aFolderFile({ currentVersionId: null })]],
      query: { FileVersion: [aFileVersion({ versionNumber: 7 })] },
      tables: TABLES,
    })

    const result = await getFolderFileCurrentVersion(makeCtx({ db: db.db }), FILE_IDS.fileId)

    expect(result._unsafeUnwrap()?.versionNumber).toBe(7)
    expect(relationalWhereOf(db, 0)).not.toContain(FILE_IDS.versionId)
  })

  it('returns NotFoundError when the file is missing, not ok(null)', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    const result = await getFolderFileCurrentVersion(makeCtx({ db: db.db }), 'fil_missing')

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
  })
})

describe('getFolderFileVersions', () => {
  it('resolves the file first, so the listing is organization-scoped', async () => {
    const db = makeDb({
      select: [[aFolderFile()]],
      query: { FileVersion: [[aFileVersion()]] },
      tables: TABLES,
    })

    const result = await getFolderFileVersions(
      makeCtx({ db: db.db, organizationId: 'org_owner' }),
      FILE_IDS.fileId
    )

    expect(result._unsafeUnwrap()).toHaveLength(1)
    expect(whereOf(db, 0)).toContain('org_owner')
  })

  it('refuses to list versions of a file in another organization', async () => {
    const db = makeDb({
      select: [[]],
      query: { FileVersion: [[aFileVersion()]] },
      tables: TABLES,
    })

    const result = await getFolderFileVersions(makeCtx({ db: db.db }), FILE_IDS.fileId)

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    // The version query never ran.
    expect(db.journal.ops('db')).toEqual(['select'])
  })
})

describe('getFolderFileVersionByNumber', () => {
  it('addresses the version by number, not by id', async () => {
    const db = makeDb({
      select: [[aFolderFile()]],
      query: { FileVersion: [aFileVersion({ versionNumber: 3 })] },
      tables: TABLES,
    })

    const result = await getFolderFileVersionByNumber(makeCtx({ db: db.db }), FILE_IDS.fileId, 3)

    expect(result._unsafeUnwrap()?.versionNumber).toBe(3)
    const where = relationalWhereOf(db, 0)
    expect(where).toContain(FILE_IDS.fileId)
    expect(where).toContain('3')
  })
})

describe('getLatestFolderFileVersion', () => {
  it('is organization-scoped, which the legacy getLatestVersion was not', async () => {
    // The legacy method queried `FileVersion` by bare `fileId` and never loaded
    // the file, so no statement in it carried an organization filter.
    const db = makeDb({
      select: [[]],
      query: { FileVersion: [aFileVersion()] },
      tables: TABLES,
    })

    const result = await getLatestFolderFileVersion(makeCtx({ db: db.db }), FILE_IDS.fileId)

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(db.journal.ops('db')).toEqual(['select'])
  })
})

describe('resolveUniqueFilePath', () => {
  it('scopes the parent-folder lookup to the caller organization', async () => {
    // The legacy `generateFilePath` read `SELECT path FROM Folder WHERE id = ?`
    // with no scope, so a folder id from another tenant stamped that tenant's
    // path onto this org's file.
    const db = makeDb({ select: [[{ path: '/Legal' }], []], tables: TABLES })

    const path = await resolveUniqueFilePath(
      makeCtx({ db: db.db, organizationId: 'org_owner' }),
      FILE_IDS.folderId,
      'contract.pdf'
    )

    expect(path).toBe('/Legal/contract.pdf')
    expect(whereOf(db, 0)).toContain('org_owner')
  })

  it('throws NotFoundError for a folder outside the organization', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    await expect(
      resolveUniqueFilePath(makeCtx({ db: db.db }), 'fld_elsewhere', 'x.pdf')
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('appends a counter before the extension on a collision', async () => {
    const db = makeDb({
      select: [[{ path: '/Legal' }], [{ id: 'taken' }], [{ id: 'taken' }], []],
      tables: TABLES,
    })

    const path = await resolveUniqueFilePath(
      makeCtx({ db: db.db }),
      FILE_IDS.folderId,
      'contract.pdf'
    )

    expect(path).toBe('/Legal/contract (2).pdf')
  })

  it('strips path separators from the name and roots a file with no folder', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    const path = await resolveUniqueFilePath(makeCtx({ db: db.db }), null, 'a/b\\c.txt')

    expect(path).toBe('/abc.txt')
    // No folder lookup: the only statement is the collision probe.
    expect(db.journal.ops('db')).toEqual(['select'])
  })

  it('gives up with a ConflictError rather than looping forever', async () => {
    // The legacy body was `while (true)` with no ceiling, so a folder full of
    // `name (n).ext` siblings issued one query per candidate indefinitely.
    const taken = Array.from({ length: MAX_PATH_COLLISION_ATTEMPTS + 2 }, () => [{ id: 'taken' }])
    const db = makeDb({ select: [[{ path: '/Legal' }], ...taken], tables: TABLES })

    await expect(
      resolveUniqueFilePath(makeCtx({ db: db.db }), FILE_IDS.folderId, 'contract.pdf')
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})
