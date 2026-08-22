// packages/lib/src/files/upload/__tests__/handler-processor-parity.test.ts

/**
 * The guard that makes it safe for PR 4a to ship {@link UPLOAD_HANDLERS} before
 * PR 4d converts the processors.
 *
 * Until that conversion lands there are two statements of the same per-entity
 * numbers: the handler records, and the `protected readonly` fields on the
 * processor classes the routes still dispatch through. Two statements of one
 * fact drift — that is what this file exists to prevent. It fails the moment
 * someone edits a size ceiling, a MIME list, a bucket or an asset kind on one
 * side only.
 *
 * PR 4d deletes the processors and this file with them.
 *
 * ## The cast
 *
 * The processors declare these fields `protected`, so reading them needs a cast.
 * That is the *test* reaching into production, not production reaching around
 * its own types — and it is the only way to compare the two declarations
 * without constructing a database. `processConfig` is not usable for the
 * comparison: `BaseAttachmentProcessor` requires an `entityId` and then runs
 * `validateEntityAccess`, which queries. `FileProcessor` has neither, so it is
 * the one processor compared end to end.
 */

import { describe, expect, it } from 'vitest'
import { makeClock } from '../../__tests__/support'
import type { AssetKind } from '../../core/types'
import type { StorageVisibility } from '../../storage/buckets'
import { ENTITY_TYPES, type EntityType } from '../../types/entities'
import { buildUploadConfig } from '../config'
import { UPLOAD_HANDLERS } from '../handlers'
import type { UploadInitConfig } from '../init-types'
import type { BaseAssetProcessor } from '../processors/base-asset-processor'
import { DatasetAssetProcessor } from '../processors/dataset'
import {
  ArticleProcessor,
  ChatWidgetProcessor,
  CommentProcessor,
  CustomFieldProcessor,
  KnowledgeBaseProcessor,
  MessageProcessor,
  UserProfileProcessor,
  WorkflowRunProcessor,
} from '../processors/entity-processors'
import { FileProcessor } from '../processors/file-processor'
import { VisitQcItemProcessor } from '../processors/visit-qc-processor'

const ORG = 'org_parity'

/** The four declarative fields `BaseAssetProcessor` subclasses carry. */
interface DeclaredFields {
  fileVisibility: StorageVisibility
  maxFileSize: number
  allowedMimeTypes: string[]
  assetKind: AssetKind
}

/** Read the `protected readonly` block off a constructed processor. */
function declaredFields(processor: BaseAssetProcessor): DeclaredFields {
  return processor as unknown as DeclaredFields
}

const ASSET_PROCESSORS: ReadonlyArray<[EntityType, () => BaseAssetProcessor]> = [
  [ENTITY_TYPES.DATASET, () => new DatasetAssetProcessor(ORG)],
  [ENTITY_TYPES.ARTICLE, () => new ArticleProcessor(ORG)],
  [ENTITY_TYPES.USER_PROFILE, () => new UserProfileProcessor(ORG)],
  [ENTITY_TYPES.WORKFLOW_RUN, () => new WorkflowRunProcessor(ORG)],
  [ENTITY_TYPES.COMMENT, () => new CommentProcessor(ORG)],
  [ENTITY_TYPES.MESSAGE, () => new MessageProcessor(ORG)],
  [ENTITY_TYPES.KNOWLEDGE_BASE, () => new KnowledgeBaseProcessor(ORG)],
  [ENTITY_TYPES.CHAT_WIDGET, () => new ChatWidgetProcessor(ORG)],
  [ENTITY_TYPES.CUSTOM_FIELD, () => new CustomFieldProcessor(ORG)],
  [ENTITY_TYPES.VISIT_QC_ITEM, () => new VisitQcItemProcessor(ORG)],
]

describe.each(ASSET_PROCESSORS)('%s handler matches its processor', (entityType, construct) => {
  const handler = UPLOAD_HANDLERS[entityType as keyof typeof UPLOAD_HANDLERS]
  const fields = declaredFields(construct())

  it('declares the same bucket routing', () => {
    // `ARTICLE` is the only handler whose visibility is a function; its base
    // answer has to equal the processor's field, and the COVER override is
    // asserted in `upload-config.test.ts`.
    const base =
      typeof handler.visibility === 'function'
        ? handler.visibility({ metadata: {} } as UploadInitConfig)
        : handler.visibility
    expect(base).toBe(fields.fileVisibility)
  })

  it('declares the same size ceiling', () => {
    expect(handler.maxFileSize).toBe(fields.maxFileSize)
  })

  it('declares the same MIME allow-list', () => {
    expect([...handler.allowedMimeTypes]).toEqual(fields.allowedMimeTypes)
  })

  it('declares the same asset kind', () => {
    expect(handler.assetKind).toBe(fields.assetKind)
  })
})

describe('FILE handler matches FileProcessor end to end', () => {
  const clock = makeClock()

  function init(overrides: Partial<UploadInitConfig> = {}): UploadInitConfig {
    return {
      organizationId: ORG,
      userId: 'usr_parity',
      fileName: 'archive.zip',
      mimeType: 'application/zip',
      expectedSize: 4096,
      entityType: ENTITY_TYPES.FILE,
      ...overrides,
    }
  }

  it.each([
    ['a small file', 4096],
    ['one byte below the multipart threshold', 100 * 1024 * 1024 - 1],
    ['exactly at the multipart threshold', 100 * 1024 * 1024],
  ])('produces the same config for %s', async (_name, expectedSize) => {
    const { config: fromProcessor } = await new FileProcessor(ORG).processConfig(
      init({ expectedSize })
    )
    const fromHandler = buildUploadConfig(UPLOAD_HANDLERS.FILE, init({ expectedSize }), clock.now)

    // The key embeds a timestamp and the processor reads the wall clock, so the
    // two differ by construction; everything else must be identical.
    const { storageKey: processorKey, ...processorRest } = fromProcessor
    const { storageKey: handlerKey, ...handlerRest } = fromHandler

    expect(handlerRest).toEqual(processorRest)
    expect(handlerKey.replace(/\/\d+_/, '/_')).toBe(processorKey.replace(/\/\d+_/, '/_'))
  })
})
