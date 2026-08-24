// packages/lib/src/files/upload/__tests__/upload-config.test.ts

/**
 * `buildUploadConfig` and `validateCompletedUpload`, over every entity type,
 * with **`vi.mock` called zero times in this file**.
 *
 * This is the test the four-level `processConfig` chain could not have. Asking
 * "what config does an article cover get?" used to mean constructing a
 * processor — which constructs three services, each binding a database at
 * module scope — and then mocking `@auxx/database`, `drizzle-orm`, `@auxx/redis`,
 * `nanoid`, `@auxx/credentials` and the logger to keep the import graph alive.
 * `unified-upload-integration.test.ts` did exactly that, in 130 lines of hoisted
 * fakes before its first assertion; PR 4d deleted it with its subject.
 *
 * Everything below is data in, data out. The two ambient inputs are the clock,
 * which arrives as a parameter, and `configService`'s bucket names, which
 * resolve `process.env` at call time and are pinned by the `beforeAll` below —
 * not mocked, because the real resolution order is part of what is asserted.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BadRequestError, UnprocessableEntityError } from '../../../errors'
import { makeClock } from '../../__tests__/support'
import type { AssetKind } from '../../core/types'
import { ENTITY_TYPES, type EntityType } from '../../types/entities'
import { buildUploadConfig, DEFAULT_TTL_SEC, MIN_TTL_SEC, validateCompletedUpload } from '../config'
import { getUploadHandler, UPLOAD_HANDLERS } from '../handlers'
import type { PersistStrategy } from '../handlers/types'
import type { UploadInitConfig, UploadPolicy } from '../init-types'
import type { PresignedUploadSession } from '../session-types'

const MB = 1024 * 1024

const BUCKETS = { public: 'test-public-bucket', private: 'test-private-bucket' } as const

const CONFIG_KEYS = ['CDN_URL', 'S3_PUBLIC_BUCKET', 'S3_PRIVATE_BUCKET', 'S3_REGION'] as const
const originals = new Map(CONFIG_KEYS.map((key) => [key, process.env[key]]))

/**
 * Pin the two bucket names and clear `CDN_URL` for the whole file.
 *
 * Every case asserts on the bucket, so an ambient `.env` on a developer machine
 * must not be able to change an outcome.
 */
beforeAll(() => {
  process.env.S3_PUBLIC_BUCKET = BUCKETS.public
  process.env.S3_PRIVATE_BUCKET = BUCKETS.private
  delete process.env.CDN_URL
})

afterAll(() => {
  for (const [key, value] of originals) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const clock = makeClock('2026-03-04T05:06:07.000Z')
const NOW_MS = clock.millis()

const ORG = 'org_upload_cfg'
const USER = 'usr_upload_cfg'

function init(overrides: Partial<UploadInitConfig> & { entityType: EntityType }): UploadInitConfig {
  return {
    organizationId: ORG,
    userId: USER,
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    expectedSize: 1024,
    entityId: 'ent_1',
    ...overrides,
  }
}

/**
 * One row of the matrix.
 *
 * The numbers are restated here rather than read back off the handler on
 * purpose: a test that computes its expectation from the same record it is
 * checking asserts only that the code is self-consistent. These are the values
 * the processor classes carry, written out by hand.
 */
interface ConfigCase {
  entityType: EntityType
  visibility: 'PUBLIC' | 'PRIVATE'
  bucket: string
  /** kebab-case segment `deriveStorageKey` puts in the key. */
  keySegment: string
  maxFileSize: number
  maxTtlSec: number
  persist: PersistStrategy
  assetKind?: AssetKind
  /** A type the handler admits. */
  allowedMime: string
  /** A type it refuses, or `null` when the handler admits everything. */
  refusedMime: string | null
  /**
   * The smallest size planned as multipart, or `null` when the size ceiling sits
   * below the threshold and multipart is therefore unreachable for this entity.
   */
  multipartAt: number | null
}

const CASES: readonly ConfigCase[] = [
  {
    entityType: ENTITY_TYPES.FILE,
    visibility: 'PRIVATE',
    bucket: BUCKETS.private,
    keySegment: 'file',
    maxFileSize: Number.MAX_SAFE_INTEGER,
    maxTtlSec: 60 * 60,
    persist: 'folder-file',
    allowedMime: 'application/x-msdownload',
    refusedMime: null,
    multipartAt: 100 * MB,
  },
  {
    entityType: ENTITY_TYPES.DATASET,
    visibility: 'PRIVATE',
    bucket: BUCKETS.private,
    keySegment: 'dataset',
    maxFileSize: 50 * MB,
    maxTtlSec: 10 * 60,
    persist: 'asset',
    assetKind: 'DOCUMENT',
    allowedMime: 'text/csv',
    refusedMime: 'image/png',
    multipartAt: 50 * MB,
  },
  {
    entityType: ENTITY_TYPES.ARTICLE,
    visibility: 'PRIVATE',
    bucket: BUCKETS.private,
    keySegment: 'article',
    maxFileSize: 10 * MB,
    maxTtlSec: 10 * 60,
    persist: 'asset+attachment',
    assetKind: 'INLINE_IMAGE',
    allowedMime: 'image/png',
    // No `image/*` wildcard on this handler, precisely so SVG is refused.
    refusedMime: 'image/svg+xml',
    multipartAt: null,
  },
  {
    entityType: ENTITY_TYPES.USER_PROFILE,
    visibility: 'PUBLIC',
    bucket: BUCKETS.public,
    keySegment: 'user-profile',
    maxFileSize: 5 * MB,
    maxTtlSec: 10 * 60,
    persist: 'versioned-asset',
    assetKind: 'USER_AVATAR',
    allowedMime: 'image/webp',
    refusedMime: 'application/pdf',
    multipartAt: null,
  },
  {
    entityType: ENTITY_TYPES.WORKFLOW_RUN,
    visibility: 'PRIVATE',
    bucket: BUCKETS.private,
    keySegment: 'workflow-run',
    maxFileSize: 50 * MB,
    maxTtlSec: 10 * 60,
    persist: 'asset+attachment',
    assetKind: 'TEMP_UPLOAD',
    allowedMime: 'application/zip',
    refusedMime: null,
    multipartAt: 25 * MB,
  },
  {
    entityType: ENTITY_TYPES.COMMENT,
    visibility: 'PRIVATE',
    bucket: BUCKETS.private,
    keySegment: 'comment',
    maxFileSize: 25 * MB,
    maxTtlSec: 10 * 60,
    persist: 'asset+attachment',
    assetKind: 'TEMP_UPLOAD',
    allowedMime: 'image/gif',
    refusedMime: 'video/mp4',
    multipartAt: null,
  },
  {
    entityType: ENTITY_TYPES.MESSAGE,
    visibility: 'PRIVATE',
    bucket: BUCKETS.private,
    keySegment: 'message',
    maxFileSize: 25 * MB,
    maxTtlSec: 10 * 60,
    persist: 'asset+attachment',
    assetKind: 'EMAIL_ATTACHMENT',
    allowedMime: 'application/vnd.ms-excel',
    refusedMime: null,
    multipartAt: null,
  },
  {
    entityType: ENTITY_TYPES.KNOWLEDGE_BASE,
    visibility: 'PUBLIC',
    bucket: BUCKETS.public,
    keySegment: 'knowledge-base',
    maxFileSize: 10 * MB,
    maxTtlSec: 10 * 60,
    persist: 'asset+attachment',
    assetKind: 'THUMBNAIL',
    allowedMime: 'image/png',
    refusedMime: 'image/svg+xml',
    multipartAt: null,
  },
  {
    entityType: ENTITY_TYPES.CHAT_WIDGET,
    visibility: 'PUBLIC',
    bucket: BUCKETS.public,
    keySegment: 'chat-widget',
    maxFileSize: 10 * MB,
    maxTtlSec: 10 * 60,
    persist: 'asset+attachment',
    assetKind: 'THUMBNAIL',
    allowedMime: 'image/jpeg',
    refusedMime: 'application/pdf',
    multipartAt: null,
  },
  {
    entityType: ENTITY_TYPES.CUSTOM_FIELD,
    visibility: 'PRIVATE',
    bucket: BUCKETS.private,
    keySegment: 'custom-field',
    maxFileSize: 25 * MB,
    maxTtlSec: 10 * 60,
    persist: 'asset+attachment',
    assetKind: 'TEMP_UPLOAD',
    allowedMime: 'application/pdf',
    // `*​/*` is the outer bound; the per-field narrowing arrives via `refineConfig`.
    refusedMime: null,
    multipartAt: null,
  },
  {
    entityType: ENTITY_TYPES.VISIT_QC_ITEM,
    visibility: 'PRIVATE',
    bucket: BUCKETS.private,
    keySegment: 'visit-qc-item',
    maxFileSize: 25 * MB,
    maxTtlSec: 10 * 60,
    persist: 'asset+attachment',
    assetKind: 'INLINE_IMAGE',
    // Accepted because the capture strip does not convert HEIC off an iPhone.
    allowedMime: 'image/heic',
    refusedMime: 'application/pdf',
    multipartAt: null,
  },
]

describe('UPLOAD_HANDLERS', () => {
  it('covers every EntityType and nothing else', () => {
    expect(Object.keys(UPLOAD_HANDLERS).sort()).toEqual(Object.values(ENTITY_TYPES).sort())
  })

  it('the matrix below covers every EntityType', () => {
    expect(CASES.map((c) => c.entityType).sort()).toEqual(Object.values(ENTITY_TYPES).sort())
  })

  it('names each handler with the key it is registered under', () => {
    for (const [key, handler] of Object.entries(UPLOAD_HANDLERS)) {
      expect(handler.entityType).toBe(key)
    }
  })

  it('refuses an unknown entity type by name', () => {
    expect(() => getUploadHandler('TICKET')).toThrow(BadRequestError)
    expect(() => getUploadHandler('TICKET')).toThrow('No upload handler for entity type: TICKET')
  })
})

describe.each(CASES)('buildUploadConfig: $entityType', (c) => {
  const handler = UPLOAD_HANDLERS[c.entityType as keyof typeof UPLOAD_HANDLERS]

  function build(overrides: Partial<UploadInitConfig> = {}) {
    return buildUploadConfig(
      handler,
      init({ entityType: c.entityType, mimeType: c.allowedMime, ...overrides }),
      clock.now
    )
  }

  it('routes to the declared visibility and its bucket', () => {
    const config = build()
    expect(config.visibility).toBe(c.visibility)
    expect(config.bucket).toBe(c.bucket)
  })

  it('emits the handler policy verbatim', () => {
    expect(build().policy).toEqual<UploadPolicy>({
      keyPrefix: `${ORG}/`,
      contentLengthRange: [0, c.maxFileSize],
      maxTtl: c.maxTtlSec,
      allowedMimeTypes: [...handler.allowedMimeTypes],
    })
  })

  it('derives an org-prefixed, entity-scoped, timestamped key', () => {
    expect(build().storageKey).toBe(`${ORG}/${c.keySegment}/ent_1/${NOW_MS}_report.pdf`)
  })

  it('plans a small upload as single', () => {
    expect(build({ expectedSize: 1024 }).uploadPlan).toEqual({ strategy: 'single' })
  })

  it('accepts a file exactly at the size ceiling', () => {
    expect(() => build({ expectedSize: c.maxFileSize })).not.toThrow()
  })

  it('declares the persistence strategy and asset kind', () => {
    expect(handler.persist).toBe(c.persist)
    // `ARTICLE` and `MESSAGE` resolve their kind from the finished session
    // (a cover becomes a THUMBNAIL, a draft attachment a TEMP_UPLOAD), so the
    // matrix records the answer for a plain upload and the function is applied
    // to one. The session-dependent branches are pinned in `persist.test.ts`.
    const kind =
      typeof handler.assetKind === 'function'
        ? handler.assetKind({ metadata: {} } as PresignedUploadSession)
        : handler.assetKind
    expect(kind).toBe(c.assetKind)
  })

  if (c.maxFileSize < Number.MAX_SAFE_INTEGER) {
    it('refuses a file one byte over the ceiling', () => {
      expect(() => build({ expectedSize: c.maxFileSize + 1 })).toThrow(UnprocessableEntityError)
      expect(() => build({ expectedSize: c.maxFileSize + 1 })).toThrow(
        `Size ${c.maxFileSize + 1} outside [0, ${c.maxFileSize}]`
      )
    })
  }

  if (c.refusedMime) {
    it(`refuses '${c.refusedMime}'`, () => {
      expect(() => build({ mimeType: c.refusedMime as string })).toThrow(UnprocessableEntityError)
      expect(() => build({ mimeType: c.refusedMime as string })).toThrow(
        `MIME '${c.refusedMime}' not allowed`
      )
    })
  } else {
    it('admits any type', () => {
      expect(() => build({ mimeType: 'application/x-msdownload' })).not.toThrow()
    })
  }

  if (c.multipartAt === null) {
    it('cannot reach multipart, because the size ceiling is below the threshold', () => {
      // Worth stating: multipart carries no S3 policy document at all
      // (`storage/presign.ts`), so an entity whose ceiling keeps every upload on
      // the single-shot path is one whose policy S3 re-enforces for us.
      expect(() => build({ expectedSize: c.maxFileSize })).not.toThrow()
      expect(build({ expectedSize: c.maxFileSize }).uploadPlan).toEqual({ strategy: 'single' })
    })
  } else {
    it('plans single one byte below the multipart threshold', () => {
      expect(build({ expectedSize: (c.multipartAt as number) - 1 }).uploadPlan).toEqual({
        strategy: 'single',
      })
    })

    it('plans multipart at the threshold', () => {
      expect(build({ expectedSize: c.multipartAt as number }).uploadPlan).toEqual({
        strategy: 'multipart',
      })
    })
  }

  it('clamps a too-long TTL to the handler ceiling', () => {
    expect(build({ ttlSec: 86_400 }).ttlSec).toBe(c.maxTtlSec)
  })

  it('clamps a too-short TTL to the floor', () => {
    expect(build({ ttlSec: 1 }).ttlSec).toBe(MIN_TTL_SEC)
  })

  it('defaults the TTL, the provider, and freezes the result', () => {
    const config = build()
    expect(config.ttlSec).toBe(Math.min(DEFAULT_TTL_SEC, c.maxTtlSec))
    expect(config.provider).toBe('S3')
    expect(Object.isFrozen(config)).toBe(true)
  })

  it('never emits a config its own policy would refuse', () => {
    // The invariant that makes the presign-time check unable to fail: whatever
    // survives `buildUploadConfig` satisfies the policy it carries.
    const config = build({ ttlSec: 86_400, expectedSize: c.maxFileSize })
    expect(config.ttlSec).toBeLessThanOrEqual(config.policy.maxTtl)
    expect(config.storageKey.startsWith(config.policy.keyPrefix)).toBe(true)
    expect(config.expectedSize).toBeLessThanOrEqual(config.policy.contentLengthRange[1])
  })
})

describe('buildUploadConfig: normalization', () => {
  const article = UPLOAD_HANDLERS.ARTICLE

  it('lowercases the MIME type and strips its parameters', () => {
    const config = buildUploadConfig(
      article,
      init({ entityType: 'ARTICLE', mimeType: 'IMAGE/PNG; charset=binary' }),
      clock.now
    )
    expect(config.mimeType).toBe('image/png')
  })

  it('judges the normalized type, not the raw one', () => {
    // `BaseAssetProcessor` tested its allow-list against the RAW `init.mimeType`
    // while emitting a policy built from the normalized one, so an uppercase
    // type was refused at the door and admitted by the policy behind it.
    expect(() =>
      buildUploadConfig(article, init({ entityType: 'ARTICLE', mimeType: 'Image/PNG' }), clock.now)
    ).not.toThrow()
  })

  it('sanitizes the filename into the key', () => {
    const config = buildUploadConfig(
      article,
      init({ entityType: 'ARTICLE', mimeType: 'image/png', fileName: 'my report (v2)!.png' }),
      clock.now
    )
    expect(config.storageKey).toBe(`${ORG}/article/ent_1/${NOW_MS}_my_report__v2__.png`)
  })

  it("addresses an entity-less upload under 'temp'", () => {
    const config = buildUploadConfig(
      UPLOAD_HANDLERS.FILE,
      init({ entityType: 'FILE', entityId: undefined }),
      clock.now
    )
    expect(config.storageKey).toBe(`${ORG}/file/temp/${NOW_MS}_report.pdf`)
  })

  it('uses the injected clock, so two builds a second apart differ', () => {
    const moving = makeClock('2026-03-04T05:06:07.000Z')
    const first = buildUploadConfig(UPLOAD_HANDLERS.FILE, init({ entityType: 'FILE' }), moving.now)
    moving.advance(1000)
    const second = buildUploadConfig(UPLOAD_HANDLERS.FILE, init({ entityType: 'FILE' }), moving.now)
    expect(first.storageKey).not.toBe(second.storageKey)
  })
})

describe('buildUploadConfig: request-dependent visibility', () => {
  it('forces an article COVER to the public bucket', () => {
    // Covers are read by OG crawlers that cache for hours; a presigned URL
    // would answer 403 long before the cache expires.
    const config = buildUploadConfig(
      UPLOAD_HANDLERS.ARTICLE,
      init({ entityType: 'ARTICLE', mimeType: 'image/png', metadata: { role: 'COVER' } }),
      clock.now
    )
    expect(config.visibility).toBe('PUBLIC')
    expect(config.bucket).toBe(BUCKETS.public)
  })

  it('leaves any other article role private', () => {
    const config = buildUploadConfig(
      UPLOAD_HANDLERS.ARTICLE,
      init({ entityType: 'ARTICLE', mimeType: 'image/png', metadata: { role: 'ATTACHMENT' } }),
      clock.now
    )
    expect(config.visibility).toBe('PRIVATE')
    expect(config.bucket).toBe(BUCKETS.private)
  })
})

describe('buildUploadConfig: normalizeInit', () => {
  it('defaults a user-profile upload to the uploading user, in the key too', () => {
    const config = buildUploadConfig(
      UPLOAD_HANDLERS.USER_PROFILE,
      init({ entityType: 'USER_PROFILE', mimeType: 'image/png', entityId: undefined }),
      clock.now
    )
    expect(config.entityId).toBe(USER)
    expect(config.storageKey).toBe(`${ORG}/user-profile/${USER}/${NOW_MS}_report.pdf`)
  })

  it('leaves an explicit user-profile target alone', () => {
    const config = buildUploadConfig(
      UPLOAD_HANDLERS.USER_PROFILE,
      init({ entityType: 'USER_PROFILE', mimeType: 'image/png', entityId: 'usr_agent' }),
      clock.now
    )
    expect(config.entityId).toBe('usr_agent')
  })

  it('copies a dataset upload’s entityId into metadata.datasetId', () => {
    const config = buildUploadConfig(
      UPLOAD_HANDLERS.DATASET,
      init({ entityType: 'DATASET', mimeType: 'text/csv', entityId: 'ds_1' }),
      clock.now
    )
    expect(config.metadata?.datasetId).toBe('ds_1')
  })

  it('does not drop metadata the client sent', () => {
    const config = buildUploadConfig(
      UPLOAD_HANDLERS.DATASET,
      init({
        entityType: 'DATASET',
        mimeType: 'text/csv',
        entityId: 'ds_1',
        metadata: { documentName: 'Q3' },
      }),
      clock.now
    )
    expect(config.metadata).toEqual({ documentName: 'Q3', datasetId: 'ds_1' })
  })
})

describe('validateCompletedUpload', () => {
  const policy: UploadPolicy = {
    keyPrefix: `${ORG}/`,
    contentLengthRange: [0, 10 * MB],
    maxTtl: 600,
    allowedMimeTypes: ['image/png', 'application/pdf'],
  }

  const session = { expectedSize: 2048, mimeType: 'application/pdf', policy }

  it('accepts a head that matches the declaration', () => {
    expect(() =>
      validateCompletedUpload(session, { size: 2048, mimeType: 'application/pdf' })
    ).not.toThrow()
  })

  it('refuses a size the client did not declare', () => {
    expect(() => validateCompletedUpload(session, { size: 2049 })).toThrow(UnprocessableEntityError)
    expect(() => validateCompletedUpload(session, { size: 2049 })).toThrow(
      'Size mismatch: expected 2048, got 2049'
    )
  })

  it('refuses a type the client did not declare', () => {
    expect(() => validateCompletedUpload(session, { size: 2048, mimeType: 'image/png' })).toThrow(
      'MIME mismatch: expected application/pdf, got image/png'
    )
  })

  it('ignores charset parameters on both sides of the comparison', () => {
    expect(() =>
      validateCompletedUpload(
        { ...session, mimeType: 'text/html' },
        { size: 2048, mimeType: 'TEXT/HTML; charset=utf-8' }
      )
    ).toThrow(/not allowed/)
    expect(() =>
      validateCompletedUpload(
        { ...session, mimeType: 'text/html', policy: { ...policy, allowedMimeTypes: ['text/*'] } },
        { size: 2048, mimeType: 'TEXT/HTML; charset=utf-8' }
      )
    ).not.toThrow()
  })

  it('skips the allow-list when the provider reported no content type', () => {
    // A HEAD without `Content-Type` makes the type rule unanswerable, not
    // violated — the same thing `BaseAssetProcessor`'s `if (head.mimeType && …)`
    // did.
    expect(() => validateCompletedUpload(session, { size: 2048 })).not.toThrow()
  })

  it('refuses bytes over the policy ceiling even when the client declared them', () => {
    // The multipart hole: nothing bounded the total size until this ran, so a
    // session that declared 20 MB against a 10 MB policy has to fail here.
    // (`buildUploadConfig` would never have emitted such a session; a legacy one
    // or a widened handler could.)
    expect(() =>
      validateCompletedUpload(
        { ...session, expectedSize: 20 * MB },
        { size: 20 * MB, mimeType: 'application/pdf' }
      )
    ).toThrow(`Size ${20 * MB} outside [0, ${10 * MB}]`)
  })

  it('judges the session policy, not a processor field', () => {
    // Why this matters: `CUSTOM_FIELD` narrows its MIME list per field through
    // `refineConfig`, and that narrowing is written into the session policy.
    // The old override re-checked the processor's own `*​/*`, so the narrowing
    // applied to the presign and to nothing else.
    const narrowed = {
      expectedSize: 2048,
      mimeType: 'image/png',
      policy: { ...policy, allowedMimeTypes: ['image/png'] },
    }
    expect(() =>
      validateCompletedUpload(narrowed, { size: 2048, mimeType: 'image/png' })
    ).not.toThrow()
    expect(() =>
      validateCompletedUpload(
        { ...narrowed, mimeType: 'application/pdf' },
        { size: 2048, mimeType: 'application/pdf' }
      )
    ).toThrow("MIME 'application/pdf' not allowed")
  })

  it('never fails on the key or the TTL, which are not facts about the bytes', () => {
    // Re-judging the TTL here would fail every session signed under a ceiling
    // that has since changed, for an upload that is otherwise perfectly fine.
    expect(() =>
      validateCompletedUpload(
        { ...session, policy: { ...policy, keyPrefix: 'someone-else/', maxTtl: 1 } },
        { size: 2048, mimeType: 'application/pdf' }
      )
    ).not.toThrow()
  })
})
