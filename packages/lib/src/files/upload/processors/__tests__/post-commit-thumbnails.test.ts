// packages/lib/src/files/upload/processors/__tests__/post-commit-thumbnails.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `UserProfileProcessor.executeProcess` and `KnowledgeBaseProcessor.executeProcess`
 * enqueued thumbnails under a comment claiming it happened "AFTER transaction
 * commits". It did not — `executeProcess` runs inside the route's still-open
 * `db.transaction`, and only a savepoint has been released by that point
 * (`docs/files-upload-architecture-guide.md` §10.3, plan §1.3).
 *
 * `ensureThumbnailPresets` used to build a `ThumbnailService` on the GLOBAL `db`, a
 * different connection, so it cannot see the uncommitted rows: the first upload
 * throws `Asset not found` (swallowed), and a RE-upload finds the asset with its
 * PRE-transaction `currentVersionId` and returns `ready` against the OLD
 * thumbnail — so `avatar-64/128/256` keep serving the previous image.
 *
 * The processors must therefore enqueue nothing; the route does it post-commit.
 */

const { ensureThumbnailPresets } = vi.hoisted(() => ({ ensureThumbnailPresets: vi.fn() }))

vi.mock('../../../thumbnails', () => ({ ensureThumbnailPresets }))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    with: vi.fn().mockReturnThis(),
  }),
}))

vi.mock('@auxx/database', async () => ({
  database: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    query: {},
  },
  schema: (await import('../../../../test/database-mock')).createSchemaMock({
    User: { id: 'id' },
    KnowledgeBase: { id: 'id', organizationId: 'organizationId' },
    MediaAsset: { id: 'id' },
    MediaAssetVersion: { id: 'id' },
  }),
}))

const { KnowledgeBaseProcessor, UserProfileProcessor } = await import('../entity-processors')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const ASSET_ID = 'ast_cuid000000000000000000000'
const STORAGE_LOCATION_ID = 'stl_cuid000000000000000000000'

function uploadSession(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    id: 'sess_nanoid_000000000000',
    organizationId: ORG_ID,
    userId: USER_ID,
    entityType: 'USER_PROFILE',
    entityId: USER_ID,
    fileName: 'avatar.png',
    mimeType: 'image/png',
    expectedSize: 1024,
    provider: 'S3',
    storageKey: 'org/avatar.png',
    isMultipart: false,
    uploadMethod: 'PUT',
    status: 'uploading',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 600_000),
    ttlSec: 600,
    metadata: {},
    policy: {},
    uploadPlan: { strategy: 'single' },
    bucket: 'auxx-public',
    visibility: 'PUBLIC',
    ...overrides,
  } as any
}

/**
 * Stub the DB collaborators so `executeProcess` is exercised for exactly what it
 * does after its savepoint is released.
 */
function stubDbCollaborators(processor: any) {
  // Chainable enough for `KnowledgeBaseProcessor`'s in-transaction logo update.
  const tx: any = {}
  tx.update = vi.fn(() => tx)
  tx.set = vi.fn(() => tx)
  tx.where = vi.fn(async () => [])

  processor.mediaAssetService = { getTx: async (fn: (tx: any) => Promise<any>) => fn(tx) }
  processor.findExistingAsset = vi.fn(async () => null)
  processor.createAsset = vi.fn(async () => ({
    assetId: ASSET_ID,
    externalUrl: 'https://cdn.example/avatar.png',
  }))
  processor.createNewVersion = vi.fn(async () => ({
    assetId: ASSET_ID,
    externalUrl: 'https://cdn.example/avatar.png',
  }))
  processor.updateUserAvatar = vi.fn(async () => {})
  processor.createAttachment = vi.fn(async () => {})
  return processor
}

beforeEach(() => vi.clearAllMocks())

describe('entity processors do not enqueue thumbnails inside the open transaction', () => {
  it('UserProfileProcessor.executeProcess enqueues no avatar presets', async () => {
    const processor = stubDbCollaborators(new UserProfileProcessor(ORG_ID))

    const result = await processor.executeProcess(uploadSession(), STORAGE_LOCATION_ID)

    expect(result).toEqual({ assetId: ASSET_ID, storageLocationId: STORAGE_LOCATION_ID })
    expect(ensureThumbnailPresets).not.toHaveBeenCalled()
  })

  it('UserProfileProcessor exposes no private thumbnail helper any more', () => {
    expect((new UserProfileProcessor(ORG_ID) as any).generateAvatarThumbnails).toBeUndefined()
  })

  it('KnowledgeBaseProcessor.executeProcess enqueues no KB logo presets', async () => {
    const processor = stubDbCollaborators(new KnowledgeBaseProcessor(ORG_ID))

    const result = await processor.executeProcess(
      uploadSession({ entityType: 'KNOWLEDGE_BASE', entityId: 'kb_cuid00000000000000000000' }),
      STORAGE_LOCATION_ID
    )

    expect(result).toEqual({ assetId: ASSET_ID, storageLocationId: STORAGE_LOCATION_ID })
    expect(ensureThumbnailPresets).not.toHaveBeenCalled()
  })
})
