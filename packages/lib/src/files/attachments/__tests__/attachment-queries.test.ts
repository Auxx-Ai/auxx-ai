// packages/lib/src/files/attachments/__tests__/attachment-queries.test.ts

/**
 * `attachments/attachment-queries.ts` — the read half of what
 * `AttachmentService` was.
 *
 * As with every test written to the `files/` contract, **`vi.mock` is called
 * zero times in this file**: `ctx.db` is a parameter, so there is nothing left
 * to intercept at module scope.
 *
 * Two properties matter beyond "it returns rows":
 *
 * 1. **Organization scope is in the statement.** The db stub does not interpret
 *    SQL, but it stores the predicate the code built and the bound values
 *    survive `JSON.stringify`, which is enough to prove the filter is present.
 *    It is *not* enough to prove which column each condition names — this
 *    package's `@auxx/database` mock hands out `{}` for every table — and that
 *    distinction belongs to the integration lane.
 * 2. **`fetchAttachmentsForEntities` stays one statement.** It is the mail and
 *    comment list read path; a regression to one query per entity would be
 *    invisible in a unit test that only checked the returned map, so the
 *    statement count is asserted directly off the journal.
 */

import { schema } from '@auxx/database'
import type { AttachmentEntity } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { BadRequestError, NotFoundError } from '../../../errors'
import { makeCtx, makeDb, TEST_IDS } from '../../__tests__/support'
import {
  fetchAttachmentsForEntities,
  getAttachment,
  getEntityAttachments,
  requireAttachment,
  resolveAttachmentVersion,
} from '../attachment-queries'

const TABLES = {
  Attachment: schema.Attachment,
  FileVersion: schema.FileVersion,
  FolderFile: schema.FolderFile,
  MediaAsset: schema.MediaAsset,
  MediaAssetVersion: schema.MediaAssetVersion,
}

const AT = new Date('2026-01-01T00:00:00.000Z')

function anAttachment(overrides: Partial<AttachmentEntity> = {}): AttachmentEntity {
  return {
    id: 'att_1',
    organizationId: TEST_IDS.organizationId,
    entityType: 'MESSAGE',
    entityId: 'msg_1',
    role: 'ATTACHMENT',
    title: 'invoice.pdf',
    caption: null,
    sort: 1,
    fileId: null,
    fileVersionId: null,
    assetId: TEST_IDS.assetId,
    assetVersionId: null,
    contentId: null,
    createdById: TEST_IDS.userId,
    createdAt: AT,
    ...overrides,
  }
}

/** The `where` predicate handed to the n-th builder chain, stringified. */
function whereOf(db: ReturnType<typeof makeDb>, index: number): string {
  return JSON.stringify(db.wheres[index]?.predicate)
}

describe('getAttachment', () => {
  it('returns the row and scopes the read to the caller organization', async () => {
    const db = makeDb({ select: [[anAttachment()]], tables: TABLES })

    const result = await getAttachment(makeCtx({ db: db.db, organizationId: 'org_other' }), 'att_1')

    expect(result._unsafeUnwrap()).toEqual(anAttachment())
    const where = whereOf(db, 0)
    expect(where).toContain('org_other')
    expect(where).toContain('att_1')
  })

  it('returns ok(null) rather than an error when nothing matches', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    const result = await getAttachment(makeCtx({ db: db.db }), 'att_missing')

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBeNull()
  })

  it('scopes unconditionally — there is no "no organization" branch left', async () => {
    // The legacy body reached `requireOrganization()`, which threw; the extracted
    // read takes a required `ctx.organizationId`, so the filter is always in the
    // statement and no construction site can widen it.
    const db = makeDb({ select: [[anAttachment()]], tables: TABLES })

    await getAttachment(makeCtx({ db: db.db }), 'att_1')

    expect(whereOf(db, 0)).toContain(TEST_IDS.organizationId)
  })
})

describe('getEntityAttachments', () => {
  it('scopes on organization, entity type and entity id together', async () => {
    const db = makeDb({ select: [[anAttachment()]], tables: TABLES })

    const result = await getEntityAttachments(makeCtx({ db: db.db }), 'MESSAGE', 'msg_1')

    expect(result._unsafeUnwrap()).toHaveLength(1)
    const where = whereOf(db, 0)
    expect(where).toContain(TEST_IDS.organizationId)
    expect(where).toContain('MESSAGE')
    expect(where).toContain('msg_1')
  })

  it('returns an empty array rather than an error for a host with nothing on it', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    const result = await getEntityAttachments(makeCtx({ db: db.db }), 'COMMENT', 'cmt_1')

    expect(result._unsafeUnwrap()).toEqual([])
  })
})

describe('fetchAttachmentsForEntities', () => {
  it('issues exactly one statement no matter how many entities are asked for', async () => {
    // The regression this guards: routing the batch through the single-entity
    // helper turns one query into N. Two hundred message ids is a realistic mail
    // page, and the count below must stay 1.
    const entityIds = Array.from({ length: 200 }, (_, i) => `msg_${i}`)
    const db = makeDb({ select: [[]], tables: TABLES })

    await fetchAttachmentsForEntities(makeCtx({ db: db.db }), 'MESSAGE', entityIds)

    expect(db.journal.ops('db')).toEqual(['select'])
  })

  it('touches the database not at all for an empty id list', async () => {
    const db = makeDb({ tables: TABLES })

    const result = await fetchAttachmentsForEntities(makeCtx({ db: db.db }), 'MESSAGE', [])

    expect(result._unsafeUnwrap().size).toBe(0)
    expect(db.journal.ops('db')).toEqual([])
  })

  it('joins both libraries in one statement rather than resolving them per row', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    await fetchAttachmentsForEntities(makeCtx({ db: db.db }), 'MESSAGE', ['msg_1'])

    // Both `leftJoin`s ride the single chain; a second `select` would mean the
    // asset or file lookup had been pulled out into its own round trip.
    expect(db.journal.entries.filter((e) => e.op === 'select')).toHaveLength(1)
    const projection = db.journal.entries[0]?.detail?.projection as Record<string, unknown>
    expect(Object.keys(projection).sort()).toEqual([
      'assetId',
      'assetMimeType',
      'assetName',
      'assetSize',
      'createdAt',
      'entityId',
      'fileId',
      'fileMimeType',
      'fileName',
      'fileSize',
      'id',
      'role',
      'sort',
      'title',
    ])
  })

  it('scopes the batch to the caller organization', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    await fetchAttachmentsForEntities(
      makeCtx({ db: db.db, organizationId: 'org_other' }),
      'MESSAGE',
      ['msg_1', 'msg_2']
    )

    const where = whereOf(db, 0)
    expect(where).toContain('org_other')
    expect(where).toContain('msg_1')
    expect(where).toContain('msg_2')
  })

  it('groups by host and flattens the asset side onto fileId', async () => {
    const db = makeDb({
      select: [
        [
          {
            id: 'att_1',
            entityId: 'msg_1',
            role: 'ATTACHMENT',
            title: 'invoice.pdf',
            sort: 1,
            createdAt: AT,
            assetId: 'ast_1',
            fileId: null,
            assetName: 'invoice.pdf',
            assetMimeType: 'application/pdf',
            assetSize: 2048,
            fileName: null,
            fileMimeType: null,
            fileSize: null,
          },
          {
            id: 'att_2',
            entityId: 'msg_1',
            role: 'INLINE',
            title: null,
            sort: 2,
            createdAt: AT,
            assetId: null,
            fileId: 'ff_1',
            assetName: null,
            assetMimeType: null,
            assetSize: null,
            fileName: 'logo.png',
            fileMimeType: 'image/png',
            fileSize: 512,
          },
          {
            id: 'att_3',
            entityId: 'msg_2',
            role: 'ATTACHMENT',
            title: null,
            sort: 1,
            createdAt: AT,
            assetId: null,
            fileId: 'ff_2',
            assetName: null,
            assetMimeType: null,
            assetSize: null,
            fileName: null,
            fileMimeType: null,
            fileSize: null,
          },
        ],
      ],
      tables: TABLES,
    })

    const grouped = (
      await fetchAttachmentsForEntities(makeCtx({ db: db.db }), 'MESSAGE', [
        'msg_1',
        'msg_2',
        'msg_3',
      ])
    )._unsafeUnwrap()

    expect([...grouped.keys()].sort()).toEqual(['msg_1', 'msg_2'])
    expect(grouped.get('msg_1')).toEqual([
      {
        id: 'att_1',
        role: 'ATTACHMENT',
        title: 'invoice.pdf',
        sort: 1,
        createdAt: AT,
        type: 'asset',
        fileId: 'ast_1',
        name: 'invoice.pdf',
        mimeType: 'application/pdf',
        size: 2048,
      },
      {
        id: 'att_2',
        role: 'INLINE',
        title: null,
        sort: 2,
        createdAt: AT,
        type: 'file',
        fileId: 'ff_1',
        name: 'logo.png',
        mimeType: 'image/png',
        size: 512,
      },
    ])
    // A host with no rows is absent from the map, not present-and-empty.
    expect(grouped.has('msg_3')).toBe(false)
    // A dangling join falls back to the placeholder name rather than throwing.
    expect(grouped.get('msg_2')?.[0]?.name).toBe('Untitled')
  })
})

describe('requireAttachment', () => {
  it('throws NotFoundError so a failure inside a caller transaction rolls it back', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    await expect(requireAttachment(makeCtx({ db: db.db }), 'att_missing')).rejects.toBeInstanceOf(
      NotFoundError
    )
  })
})

describe('resolveAttachmentVersion', () => {
  it('reads the pinned asset version directly, without asking the asset', async () => {
    const db = makeDb({
      select: [
        [anAttachment({ assetVersionId: TEST_IDS.versionId })],
        [
          {
            id: TEST_IDS.versionId,
            mimeType: 'application/pdf',
            size: 2048,
            storageLocationId: TEST_IDS.storageLocationId,
          },
        ],
      ],
      tables: TABLES,
    })

    const resolved = (
      await resolveAttachmentVersion(makeCtx({ db: db.db }), 'att_1')
    )._unsafeUnwrap()

    expect(resolved).toEqual({
      attachment: anAttachment({ assetVersionId: TEST_IDS.versionId }),
      side: 'asset',
      isPinned: true,
      versionId: TEST_IDS.versionId,
      storageLocationId: TEST_IDS.storageLocationId,
      mimeType: 'application/pdf',
      size: 2048,
    })
    // Two statements: the attachment, then the version. The pinned branch never
    // touches `MediaAsset`.
    expect(db.journal.ops('db')).toEqual(['select', 'select'])
  })

  it('reports versionId as null on the unpinned branch, because the projection has none', async () => {
    // The unpinned lookups join `FolderFile`/`MediaAsset` to their current
    // version and select only mime/size/location — no `id`. The legacy `any`
    // let callers read `version.id` there and silently get `undefined`.
    const db = makeDb({
      select: [
        [anAttachment({ assetId: 'ast_1' })],
        [{ mimeType: 'image/png', size: 512, storageLocationId: TEST_IDS.storageLocationId }],
      ],
      tables: TABLES,
    })

    const resolved = (
      await resolveAttachmentVersion(makeCtx({ db: db.db }), 'att_1')
    )._unsafeUnwrap()

    expect(resolved.isPinned).toBe(false)
    expect(resolved.versionId).toBeNull()
    expect(resolved.side).toBe('asset')
  })

  it('resolves the file side through FolderFile.currentVersionId', async () => {
    const db = makeDb({
      select: [
        [anAttachment({ assetId: null, fileId: 'ff_1' })],
        [{ mimeType: 'text/csv', size: 99, storageLocationId: TEST_IDS.storageLocationId }],
      ],
      tables: TABLES,
    })

    const resolved = (
      await resolveAttachmentVersion(makeCtx({ db: db.db }), 'att_1')
    )._unsafeUnwrap()

    expect(resolved.side).toBe('file')
    expect(resolved.mimeType).toBe('text/csv')
  })

  it('is a 400, not a 500, when the row references neither library', async () => {
    const db = makeDb({
      select: [[anAttachment({ assetId: null, fileId: null })]],
      tables: TABLES,
    })

    const result = await resolveAttachmentVersion(makeCtx({ db: db.db }), 'att_1')

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  it('is a 400 when the resolved version has no storage location', async () => {
    const db = makeDb({
      select: [[anAttachment()], [{ mimeType: null, size: null, storageLocationId: null }]],
      tables: TABLES,
    })

    const result = await resolveAttachmentVersion(makeCtx({ db: db.db }), 'att_1')

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  it('is a 404, not a 500, when the attachment does not exist', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    const result = await resolveAttachmentVersion(makeCtx({ db: db.db }), 'att_missing')

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })
})
