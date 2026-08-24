// packages/lib/src/files/upload/__tests__/persist.test.ts

/**
 * `persistUpload`: which rows a finished upload turns into, and what the
 * per-entity hooks add.
 *
 * This is the half of the processor hierarchy that a four-declarative-field
 * parity test could never reach. `executeProcess` was overridden at four levels
 * and three of the concrete overrides opened their own
 * `mediaAssetService.getTx(...)` — a `SAVEPOINT` inside the route's already-open
 * transaction — so "what does a knowledge-base logo upload write, and in what
 * order?" was answerable only by reading four classes. It is one `switch` now,
 * and these are its cases.
 *
 * The db double is deliberately dumb (`__tests__/support/db.ts`): it does not
 * read a `where`, so what is asserted here is which tables were written, with
 * what values, in what order. Column-level identity needs the integration lane.
 *
 * `vi.mock` count in this file: **zero**.
 */

import type { Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  anAsset,
  aStorageLocation,
  makeClock,
  makeDb,
  TEST_BUCKETS,
  TEST_IDS,
} from '../../__tests__/support'
import type { FilesCtx } from '../../ctx'
import { ENTITY_TYPES, type EntityType } from '../../types/entities'
import { UPLOAD_HANDLERS } from '../handlers'
import { persistUpload } from '../persist'
import type { PresignedUploadSession } from '../session-types'

const LOCATION_ID = 'loc_persist'
const ASSET_ID = 'ast_persist'
const VERSION_ID = 'ver_persist'
const ATTACHMENT_ID = 'att_persist'

const TABLES = {
  MediaAsset: schema.MediaAsset,
  MediaAssetVersion: schema.MediaAssetVersion,
  Attachment: schema.Attachment,
  FolderFile: schema.FolderFile,
  FileVersion: schema.FileVersion,
  KnowledgeBase: schema.KnowledgeBase,
  ChatWidget: schema.ChatWidget,
  User: schema.User,
}

function aSession(overrides: Partial<PresignedUploadSession> = {}): PresignedUploadSession {
  const clock = makeClock()
  return {
    version: 2,
    id: 'sess_persist',
    organizationId: TEST_IDS.organizationId,
    userId: TEST_IDS.userId,
    entityType: ENTITY_TYPES.MESSAGE as EntityType,
    entityId: 'msg_1',
    fileName: 'invoice.pdf',
    mimeType: 'application/pdf',
    expectedSize: 2048,
    provider: 'S3',
    storageKey: `${TEST_IDS.organizationId}/message/msg_1/invoice.pdf`,
    isMultipart: false,
    uploadMethod: 'PUT',
    status: 'uploading',
    createdAt: clock.now(),
    expiresAt: new Date(clock.now().getTime() + 600_000),
    ttlSec: 600,
    metadata: {},
    policy: {
      keyPrefix: `${TEST_IDS.organizationId}/`,
      contentLengthRange: [0, 25 * 1024 * 1024],
      maxTtl: 600,
      allowedMimeTypes: ['*/*'],
    },
    uploadPlan: { strategy: 'single' },
    bucket: TEST_BUCKETS.private,
    visibility: 'PRIVATE',
    ...overrides,
  }
}

/** Rows for the `MediaAsset` + version path, in the order the writes ask for them. */
function assetRows(existingAssets: unknown[] = []) {
  return {
    insert: [
      [anAsset({ id: ASSET_ID })],
      [{ id: VERSION_ID, assetId: ASSET_ID, versionNumber: 1 }],
      [{ id: ATTACHMENT_ID }],
    ],
    query: {
      MediaAsset: [anAsset({ id: ASSET_ID })],
      MediaAssetVersion: [],
      StorageLocation: [aStorageLocation({ id: LOCATION_ID })],
    },
    // `versioned-asset`'s lookup, then `createAttachment`'s `nextSort` probe.
    select: [existingAssets, []],
  }
}

/**
 * Run `persistUpload` inside the double's transaction, exactly as
 * `completeUpload` does — never handing it a pool.
 */
async function run(
  db: ReturnType<typeof makeDb>,
  entityType: EntityType,
  session: PresignedUploadSession,
  externalUrl = ''
) {
  const clock = makeClock()
  const ctx: FilesCtx = { db: db.db, organizationId: TEST_IDS.organizationId }
  const handler = UPLOAD_HANDLERS[entityType as keyof typeof UPLOAD_HANDLERS]

  return db.db.transaction(async (tx: Transaction) =>
    persistUpload(tx, ctx, { now: clock.now }, handler, session, {
      id: LOCATION_ID,
      externalUrl,
    })
  )
}

describe('persistUpload — the strategy decides the rows', () => {
  it("'folder-file' writes a FolderFile and no MediaAsset", async () => {
    const db = makeDb({
      tables: TABLES,
      insert: [[{ id: 'fil_1', name: 'invoice.pdf' }], [{ id: 'fver_1' }]],
      // `resolveUniqueFilePath`'s collision probe, then `requireFolderFile`.
      select: [[], [{ id: 'fil_1', name: 'invoice.pdf' }]],
      query: { FileVersion: [], StorageLocation: [aStorageLocation({ id: LOCATION_ID })] },
    })

    const result = await run(
      db,
      ENTITY_TYPES.FILE,
      aSession({ entityType: ENTITY_TYPES.FILE as EntityType, entityId: undefined })
    )

    expect(result).toMatchObject({ storageLocationId: LOCATION_ID, fileId: 'fil_1' })
    expect(result.assetId).toBeUndefined()
    expect(db.inserts.map((row) => row.table)).toEqual(['FolderFile', 'FileVersion'])
    // The extension is derived, not asked for — `FileProcessor.createFile` did
    // the same and it is what the file library filters on.
    expect(db.inserts[0]?.values).toMatchObject({ ext: 'pdf' })
  })

  it("'asset' writes a MediaAsset and a version, and no Attachment", async () => {
    const rows = assetRows()
    const db = makeDb({ tables: TABLES, ...rows, insert: rows.insert.slice(0, 2) })

    const result = await run(
      db,
      ENTITY_TYPES.DATASET,
      aSession({
        entityType: ENTITY_TYPES.DATASET as EntityType,
        // No `datasetId`, so the DATASET `onPersist` refuses before writing a
        // Document — this case is about the asset shape alone.
        entityId: undefined,
      })
    ).catch((error) => error)

    // The refusal is the assertion: `onPersist` runs, and it runs on `tx`.
    expect((result as Error).message).toMatch(/Dataset ID is required/)
    expect(db.inserts.map((row) => row.table)).toEqual(['MediaAsset', 'MediaAssetVersion'])
  })

  it("'asset+attachment' links the asset to the entity", async () => {
    const db = makeDb({ tables: TABLES, ...assetRows() })

    const result = await run(db, ENTITY_TYPES.MESSAGE, aSession())

    expect(result).toMatchObject({
      storageLocationId: LOCATION_ID,
      assetId: ASSET_ID,
      attachmentId: ATTACHMENT_ID,
    })
    expect(db.inserts.map((row) => row.table)).toEqual([
      'MediaAsset',
      'MediaAssetVersion',
      'Attachment',
    ])
    expect(db.inserts[2]?.values).toMatchObject({
      entityType: ENTITY_TYPES.MESSAGE,
      entityId: 'msg_1',
      role: 'ATTACHMENT',
      title: 'invoice.pdf',
      assetId: ASSET_ID,
    })
  })

  it("'versioned-asset' adds a version to the entity's existing asset", async () => {
    const db = makeDb({
      tables: TABLES,
      // No asset INSERT: the existing one is versioned in place.
      insert: [[{ id: VERSION_ID, assetId: ASSET_ID, versionNumber: 2 }]],
      select: [[anAsset({ id: ASSET_ID, kind: 'USER_AVATAR' })]],
      query: {
        // `updateAssetContent` runs `requireAsset` at its top and again inside
        // `insertVersion`.
        MediaAsset: [
          anAsset({ id: ASSET_ID, kind: 'USER_AVATAR' }),
          anAsset({ id: ASSET_ID, kind: 'USER_AVATAR' }),
        ],
        MediaAssetVersion: [{ versionNumber: 1 }],
        StorageLocation: [aStorageLocation({ id: LOCATION_ID })],
      },
      update: [
        // `insertVersion`'s `currentVersionId` move …
        [{ id: ASSET_ID }],
        // … then `updateAssetContent`'s own RETURNING.
        [anAsset({ id: ASSET_ID, kind: 'USER_AVATAR' })],
      ],
    })

    const result = await run(
      db,
      ENTITY_TYPES.USER_PROFILE,
      aSession({
        entityType: ENTITY_TYPES.USER_PROFILE as EntityType,
        entityId: TEST_IDS.userId,
        visibility: 'PUBLIC',
        bucket: TEST_BUCKETS.public,
      }),
      'https://cdn.test/me.jpg'
    )

    expect(result.assetId).toBe(ASSET_ID)
    expect(db.inserts.map((row) => row.table)).toEqual(['MediaAssetVersion'])
    // The `User` pointer is written on the same `tx` as the version.
    expect(db.updates.map((row) => row.table)).toContain('User')
    expect(db.updates.find((row) => row.table === 'User')?.values).toEqual({
      avatarAssetId: ASSET_ID,
      image: 'https://cdn.test/me.jpg',
    })
  })

  it("'versioned-asset' creates the asset when the entity has none yet", async () => {
    const db = makeDb({
      tables: TABLES,
      insert: [[anAsset({ id: ASSET_ID })], [{ id: VERSION_ID, versionNumber: 1 }]],
      // The lookup misses.
      select: [[]],
      query: {
        MediaAsset: [anAsset({ id: ASSET_ID })],
        MediaAssetVersion: [],
        StorageLocation: [aStorageLocation({ id: LOCATION_ID })],
      },
    })

    const result = await run(
      db,
      ENTITY_TYPES.USER_PROFILE,
      aSession({
        entityType: ENTITY_TYPES.USER_PROFILE as EntityType,
        entityId: TEST_IDS.userId,
        visibility: 'PUBLIC',
        bucket: TEST_BUCKETS.public,
      })
    )

    expect(result.assetId).toBe(ASSET_ID)
    expect(db.inserts.map((row) => row.table)).toEqual(['MediaAsset', 'MediaAssetVersion'])
    // No external URL could be built, so `User.image` is cleared rather than
    // set to `''` — which would render as a broken image.
    expect(db.updates.find((row) => row.table === 'User')?.values).toMatchObject({ image: null })
  })
})

describe('persistUpload — asset kind and expiry', () => {
  it.each([
    ['a draft attachment', { entityId: 'temp-message-1', metadata: {} }, 'TEMP_UPLOAD', true],
    [
      'an inline image on a draft',
      { entityId: 'temp-message-1', metadata: { attachmentType: 'inline' } },
      // The processors created it INLINE_IMAGE and immediately UPDATEd it back
      // to TEMP_UPLOAD; the send path's `convertTempAssetToPermanent` only acts
      // on TEMP_UPLOAD, so the committed row has to stay TEMP_UPLOAD.
      'TEMP_UPLOAD',
      true,
    ],
    [
      'an inline image on a real message',
      { entityId: 'msg_1', metadata: { attachmentType: 'inline' } },
      'INLINE_IMAGE',
      false,
    ],
    ['a plain attachment', { entityId: 'msg_1', metadata: {} }, 'EMAIL_ATTACHMENT', false],
  ])('MESSAGE: %s becomes %s', async (_label, overrides, kind, expires) => {
    const db = makeDb({ tables: TABLES, ...assetRows() })

    await run(db, ENTITY_TYPES.MESSAGE, aSession(overrides as Partial<PresignedUploadSession>))

    const asset = db.inserts.find((row) => row.table === 'MediaAsset')?.values as {
      kind: string
      expiresAt?: Date
    }
    expect(asset.kind).toBe(kind)
    // Stamped at INSERT rather than by the follow-up UPDATE the processors ran.
    expect(asset.expiresAt instanceof Date).toBe(expires)
  })

  it('ARTICLE: a cover becomes a THUMBNAIL and is not private', async () => {
    const db = makeDb({ tables: TABLES, ...assetRows() })

    await run(
      db,
      ENTITY_TYPES.ARTICLE,
      aSession({
        entityType: ENTITY_TYPES.ARTICLE as EntityType,
        entityId: 'art_1',
        metadata: { role: 'COVER' },
        visibility: 'PUBLIC',
        bucket: TEST_BUCKETS.public,
      })
    )

    expect(db.inserts.find((row) => row.table === 'MediaAsset')?.values).toMatchObject({
      kind: 'THUMBNAIL',
      isPrivate: false,
    })
    // The role rides through to the attachment, so the article knows which
    // attachment is its cover.
    expect(db.inserts.find((row) => row.table === 'Attachment')?.values).toMatchObject({
      role: 'COVER',
    })
  })
})

describe('persistUpload — the logo handlers', () => {
  it.each([
    [ENTITY_TYPES.KNOWLEDGE_BASE, 'KnowledgeBase'],
    [ENTITY_TYPES.CHAT_WIDGET, 'ChatWidget'],
  ] as const)('%s writes the light logo by default', async (entityType, table) => {
    const db = makeDb({ tables: TABLES, ...assetRows() })

    await run(
      db,
      entityType,
      aSession({
        entityType: entityType as EntityType,
        entityId: 'ent_1',
        visibility: 'PUBLIC',
        bucket: TEST_BUCKETS.public,
      }),
      'https://cdn.test/logo.png'
    )

    expect(db.updates.find((row) => row.table === table)?.values).toEqual({
      logoLight: 'https://cdn.test/logo.png',
    })
  })

  it('writes the dark logo when the session says so', async () => {
    const db = makeDb({ tables: TABLES, ...assetRows() })

    await run(
      db,
      ENTITY_TYPES.KNOWLEDGE_BASE,
      aSession({
        entityType: ENTITY_TYPES.KNOWLEDGE_BASE as EntityType,
        entityId: 'kb_1',
        metadata: { variant: 'dark' },
        visibility: 'PUBLIC',
        bucket: TEST_BUCKETS.public,
      }),
      'https://cdn.test/logo-dark.png'
    )

    expect(db.updates.find((row) => row.table === 'KnowledgeBase')?.values).toEqual({
      logoDark: 'https://cdn.test/logo-dark.png',
    })
  })

  it('leaves an existing logo alone when no external URL could be built', async () => {
    const db = makeDb({ tables: TABLES, ...assetRows() })

    await run(
      db,
      ENTITY_TYPES.KNOWLEDGE_BASE,
      aSession({
        entityType: ENTITY_TYPES.KNOWLEDGE_BASE as EntityType,
        entityId: 'kb_1',
        visibility: 'PUBLIC',
        bucket: TEST_BUCKETS.public,
      }),
      // `buildPublicUrl` warns and answers `''` when the CDN URL cannot be
      // formed; writing that would blank the KB's current logo.
      ''
    )

    expect(db.updates.map((row) => row.table)).not.toContain('KnowledgeBase')
  })
})
