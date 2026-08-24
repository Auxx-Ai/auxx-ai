// packages/lib/src/files/attachments/__tests__/download.test.ts

/**
 * `attachments/download.ts` — the pointer half of the download trio.
 *
 * As with every test written to the `files/` contract, **`vi.mock` is called
 * zero times in this file.** The pinned branch's `StorageManager` — the one
 * collaborator this module cannot move onto `StoragePort` — arrives as
 * `deps.locations`, so it is a parameter like everything else rather than
 * something to intercept at module scope.
 *
 * The properties worth asserting beyond "it returns a ref":
 *
 * 1. **The three branches do not leak into each other.** A pinned attachment
 *    must never reach a library read; an unpinned one must never reach the
 *    location port. A regression either way is invisible in the returned value.
 * 2. **The unpinned branches delegate, so each library keeps its own policy.**
 *    A public asset returns a durable URL with no expiry; a file is always
 *    presigned, because `FolderFile` has no `isPrivate` column.
 * 3. **`getAttachmentDownloadInfo` resolves the attachment once**, where the
 *    facade it replaces resolved it twice.
 */

import { schema } from '@auxx/database'
import type { AttachmentEntity } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import {
  anAsset,
  aStorageLocation,
  type Journal,
  makeCtx,
  makeDb,
  makeJournal,
  makeStoragePort,
  TEST_BUCKETS,
  TEST_IDS,
} from '../../__tests__/support'
import type { DownloadRef } from '../../adapters/base-adapter'
import {
  type AttachmentDownloadDeps,
  getAttachmentDownloadInfo,
  getAttachmentDownloadRef,
  resolveAttachmentDownloadRef,
} from '../download'
import type { LocationDownloadParams, LocationDownloadPort } from '../ports'

const TABLES = {
  Attachment: schema.Attachment,
  FileVersion: schema.FileVersion,
  FolderFile: schema.FolderFile,
  MediaAsset: schema.MediaAsset,
  MediaAssetVersion: schema.MediaAssetVersion,
}

const AT = new Date('2026-01-01T00:00:00.000Z')
const PINNED_REF: DownloadRef = { type: 'url', url: 'https://s3.test/pinned', expiresAt: AT }

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
  } as AttachmentEntity
}

/** The projection `requireResolvedVersion`'s pinned branches select. */
function aPinnedTarget(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_IDS.versionId,
    mimeType: 'application/pdf',
    size: 2048,
    storageLocationId: TEST_IDS.storageLocationId,
    ...overrides,
  }
}

/** The projection the unpinned branches select — no `id`, by design. */
function anUnpinnedTarget(overrides: Record<string, unknown> = {}) {
  return {
    mimeType: 'image/png',
    size: 512,
    storageLocationId: TEST_IDS.storageLocationId,
    ...overrides,
  }
}

/** A `MediaAssetVersion` row shaped the way the relational query returns it. */
function anAssetVersion(storageLocation = aStorageLocation()) {
  return {
    id: TEST_IDS.versionId,
    assetId: TEST_IDS.assetId,
    versionNumber: 1,
    size: 1024,
    mimeType: 'image/png',
    createdAt: AT,
    storageLocationId: storageLocation?.id ?? null,
    deletedAt: null,
    derivedFromVersionId: null,
    preset: null,
    metadata: {},
    status: 'READY' as const,
    storageLocation,
  }
}

function aFolderFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ff_1',
    organizationId: TEST_IDS.organizationId,
    name: 'report.pdf',
    mimeType: 'application/pdf',
    size: 4096,
    isArchived: false,
    deletedAt: null,
    currentVersionId: 'fver_1',
    ...overrides,
  }
}

function aFileVersion(storageLocation = aStorageLocation({ externalId: 'keys/report.pdf' })) {
  return {
    id: 'fver_1',
    fileId: 'ff_1',
    versionNumber: 2,
    storageLocationId: storageLocation?.id ?? null,
    storageLocation,
  }
}

/** A recording {@link LocationDownloadPort} — the pinned branch's `StorageManager`. */
function makeLocationPort(options: { journal?: Journal; result?: DownloadRef } = {}) {
  const calls: LocationDownloadParams[] = []
  const port: LocationDownloadPort = {
    getDownloadRef: async (params) => {
      options.journal?.record('storage', 'locations.getDownloadRef')
      calls.push(params)
      return options.result ?? PINNED_REF
    },
  }
  return { port, calls }
}

function makeDownloadDeps(overrides: Partial<AttachmentDownloadDeps> = {}): AttachmentDownloadDeps {
  return {
    storage: makeStoragePort().port,
    now: () => AT,
    locations: makeLocationPort().port,
    ...overrides,
  }
}

describe('getAttachmentDownloadRef', () => {
  it('serves a pinned attachment from its own StorageLocation, without asking either library', async () => {
    const journal = makeJournal()
    const db = makeDb({
      select: [[anAttachment({ assetVersionId: TEST_IDS.versionId })], [aPinnedTarget()]],
      tables: TABLES,
      journal,
    })
    const storage = makeStoragePort({ journal })
    const locations = makeLocationPort({ journal })

    const result = await getAttachmentDownloadRef(
      makeCtx({ db: db.db }),
      makeDownloadDeps({ storage: storage.port, locations: locations.port }),
      'att_1'
    )

    expect(result._unsafeUnwrap()).toEqual(PINNED_REF)
    expect(locations.calls).toEqual([
      {
        locationId: TEST_IDS.storageLocationId,
        filename: 'invoice.pdf',
        mimeType: 'application/pdf',
        ttlSec: undefined,
        disposition: undefined,
      },
    ])
    // The pinned branch is self-contained: two statements for the attachment and
    // its version, then the port. No MediaAsset read, no presignDownload.
    expect(journal.ops()).toEqual(['select', 'select', 'locations.getDownloadRef'])
    expect(storage.calls).toEqual([])
  })

  it('threads disposition and ttlSec into the pinned branch', async () => {
    const db = makeDb({
      select: [[anAttachment({ fileVersionId: 'fver_1', fileId: 'ff_1' })], [aPinnedTarget()]],
      tables: TABLES,
    })
    const locations = makeLocationPort()

    await getAttachmentDownloadRef(
      makeCtx({ db: db.db }),
      makeDownloadDeps({ locations: locations.port }),
      'att_1',
      { disposition: 'attachment', ttlSec: 900 }
    )

    expect(locations.calls[0]?.disposition).toBe('attachment')
    expect(locations.calls[0]?.ttlSec).toBe(900)
  })

  it('leaves the pinned filename unset when the attachment has no title', async () => {
    const db = makeDb({
      select: [
        [anAttachment({ assetVersionId: TEST_IDS.versionId, title: null })],
        [aPinnedTarget({ mimeType: null })],
      ],
      tables: TABLES,
    })
    const locations = makeLocationPort()

    await getAttachmentDownloadRef(
      makeCtx({ db: db.db }),
      makeDownloadDeps({ locations: locations.port }),
      'att_1'
    )

    // `undefined`, not `''` — the provider infers a name from the key instead.
    expect(locations.calls[0]?.filename).toBeUndefined()
    expect(locations.calls[0]?.mimeType).toBeUndefined()
  })

  it('delegates an unpinned asset to the asset library, keeping its durable public URL', async () => {
    const journal = makeJournal()
    const db = makeDb({
      select: [[anAttachment()], [anUnpinnedTarget()]],
      query: {
        MediaAsset: [anAsset({ isPrivate: false })],
        MediaAssetVersion: [
          anAssetVersion(aStorageLocation({ externalUrl: 'https://cdn.test/og.png' })),
        ],
      },
      tables: TABLES,
      journal,
    })
    const storage = makeStoragePort({ journal })
    const locations = makeLocationPort({ journal })

    const result = await getAttachmentDownloadRef(
      makeCtx({ db: db.db }),
      makeDownloadDeps({ storage: storage.port, locations: locations.port }),
      'att_1'
    )

    // The asset library's public-URL shortcut survives the indirection: an OG
    // crawler caches this for days and a presigned URL would 403.
    expect(result._unsafeUnwrap()).toEqual({ type: 'url', url: 'https://cdn.test/og.png' })
    expect(locations.calls).toEqual([])
    expect(storage.calls).toEqual([])
  })

  it('delegates an unpinned file to the file library, which always presigns', async () => {
    const db = makeDb({
      select: [
        [anAttachment({ assetId: null, fileId: 'ff_1' })],
        [anUnpinnedTarget()],
        [aFolderFile()],
      ],
      query: { FileVersion: [aFileVersion()] },
      tables: TABLES,
    })
    const storage = makeStoragePort()
    const locations = makeLocationPort()

    const result = await getAttachmentDownloadRef(
      makeCtx({ db: db.db }),
      makeDownloadDeps({ storage: storage.port, locations: locations.port }),
      'att_1',
      { disposition: 'attachment' }
    )

    expect(result.isOk()).toBe(true)
    expect(locations.calls).toEqual([])
    // `FolderFile` has no `isPrivate` column, so there is no public shortcut to
    // fall into — and the bucket comes off the row, never from config.
    expect(storage.callsTo('presignDownload')[0]?.params).toMatchObject({
      bucket: TEST_BUCKETS.private,
      key: 'keys/report.pdf',
      disposition: 'attachment',
      filename: 'report.pdf',
    })
  })

  it('returns NotFoundError for an attachment in another organization', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })
    const locations = makeLocationPort()

    const result = await getAttachmentDownloadRef(
      makeCtx({ db: db.db, organizationId: 'org_other' }),
      makeDownloadDeps({ locations: locations.port }),
      'att_1'
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(result._unsafeUnwrapErr().message).toBe('Attachment att_1 not found')
    expect(locations.calls).toEqual([])
  })

  it('returns BadRequestError when the row references neither library', async () => {
    const db = makeDb({
      select: [[anAttachment({ assetId: null, fileId: null })]],
      tables: TABLES,
    })

    const result = await getAttachmentDownloadRef(
      makeCtx({ db: db.db }),
      makeDownloadDeps(),
      'att_1'
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(400)
    expect(result._unsafeUnwrapErr().message).toBe(
      'Attachment has no valid file or asset reference'
    )
  })

  it('returns BadRequestError when the target has no storage location', async () => {
    const db = makeDb({
      select: [
        [anAttachment({ assetVersionId: TEST_IDS.versionId })],
        [aPinnedTarget({ storageLocationId: null })],
      ],
      tables: TABLES,
    })
    const locations = makeLocationPort()

    const result = await getAttachmentDownloadRef(
      makeCtx({ db: db.db }),
      makeDownloadDeps({ locations: locations.port }),
      'att_1'
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(400)
    expect(result._unsafeUnwrapErr().message).toBe('No storage location available for attachment')
    expect(locations.calls).toEqual([])
  })
})

describe('resolveAttachmentDownloadRef', () => {
  it('reuses the download policy without re-reading the attachment', async () => {
    const journal = makeJournal()
    const db = makeDb({ tables: TABLES, journal })
    const locations = makeLocationPort({ journal })

    const ref = await resolveAttachmentDownloadRef(
      makeCtx({ db: db.db }),
      makeDownloadDeps({ locations: locations.port }),
      {
        attachment: anAttachment({ assetVersionId: TEST_IDS.versionId }),
        side: 'asset',
        isPinned: true,
        versionId: TEST_IDS.versionId,
        storageLocationId: TEST_IDS.storageLocationId,
        mimeType: 'application/pdf',
        size: 2048,
      }
    )

    expect(ref).toEqual(PINNED_REF)
    // This is the seam a batch caller uses: no statement at all for a resolution
    // it already holds.
    expect(journal.ops('db')).toEqual([])
  })

  it('rejects a hand-built resolution that names neither library', async () => {
    await expect(
      resolveAttachmentDownloadRef(makeCtx(), makeDownloadDeps(), {
        attachment: anAttachment({ assetId: null, fileId: null }),
        side: 'asset',
        isPinned: false,
        versionId: null,
        storageLocationId: TEST_IDS.storageLocationId,
        mimeType: null,
        size: null,
      })
    ).rejects.toThrow('Attachment has no valid file or asset reference')
  })
})

describe('getAttachmentDownloadInfo', () => {
  it('returns the ref plus the row metadata, resolving the attachment once', async () => {
    const journal = makeJournal()
    const db = makeDb({
      select: [[anAttachment({ assetVersionId: TEST_IDS.versionId })], [aPinnedTarget()]],
      tables: TABLES,
      journal,
    })
    const locations = makeLocationPort({ journal })

    const result = await getAttachmentDownloadInfo(
      makeCtx({ db: db.db }),
      makeDownloadDeps({ locations: locations.port }),
      'att_1'
    )

    expect(result._unsafeUnwrap()).toEqual({
      kind: 'url',
      url: 'https://s3.test/pinned',
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      expiresAt: AT,
    })
    // Two statements, not four: the facade this replaces resolved the
    // attachment for its metadata and then again for its ref.
    expect(journal.ops('db')).toEqual(['select', 'select'])
  })

  it('falls back to the literal "attachment" when the row has no title', async () => {
    const db = makeDb({
      select: [
        [anAttachment({ assetVersionId: TEST_IDS.versionId, title: null })],
        [aPinnedTarget({ mimeType: null, size: null })],
      ],
      tables: TABLES,
    })

    const result = await getAttachmentDownloadInfo(
      makeCtx({ db: db.db }),
      makeDownloadDeps(),
      'att_1'
    )

    // The legacy expression read `version.name` in the middle, a column none of
    // the four projections ever selected — so this was always the answer.
    expect(result._unsafeUnwrap().filename).toBe('attachment')
    expect(result._unsafeUnwrap().mimeType).toBeUndefined()
    expect(result._unsafeUnwrap().size).toBeUndefined()
  })
})
