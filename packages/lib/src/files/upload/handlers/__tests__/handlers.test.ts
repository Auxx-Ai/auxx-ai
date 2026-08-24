// packages/lib/src/files/upload/handlers/__tests__/handlers.test.ts

/**
 * The invariants the handler records have to hold as a set.
 *
 * `satisfies Record<EntityType, UploadHandler>` already makes exhaustiveness a
 * compile error, which is the whole reason the record literal exists — the
 * `visit_qc_item` bug (guide §11.3) was an entity type with no registration
 * silently falling back to the file-library processor. These are the properties
 * the type system cannot state: that a handler's declared strategy matches the
 * hooks it carries, and that nothing declares an asset kind it will never use.
 *
 * `vi.mock` count in this file: **zero**.
 */

import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../../../../errors'
import { VALID_ASSET_KINDS } from '../../../core/types'
import { ENTITY_CONFIGS, ENTITY_TYPES } from '../../../types/entities'
import type { UploadPreparedConfig } from '../../init-types'
import { narrowPolicyToFieldOptions } from '../custom-field'
import { getUploadHandler, requiresEntityId, UPLOAD_HANDLERS } from '../index'

const HANDLERS = Object.entries(UPLOAD_HANDLERS)

describe('UPLOAD_HANDLERS', () => {
  it('covers every EntityType and nothing else', () => {
    expect(Object.keys(UPLOAD_HANDLERS).sort()).toEqual(Object.values(ENTITY_TYPES).sort())
  })

  it('registers each handler under the entity type it names', () => {
    for (const [key, handler] of HANDLERS) {
      expect(handler.entityType).toBe(key)
    }
  })

  it('keeps visit_qc_item on the asset path it needs', () => {
    // `qc-photo-strip.tsx` hands the returned `MediaAsset` id to
    // `add{My,Visit}VisitQcItemPhoto`, so a `folder-file` here is the original
    // bug back again — a `FolderFile` and no `assetId`.
    expect(UPLOAD_HANDLERS.visit_qc_item.persist).toBe('asset+attachment')
  })
})

describe('getUploadHandler', () => {
  it('answers by entity type', () => {
    expect(getUploadHandler('FILE')).toBe(UPLOAD_HANDLERS.FILE)
    expect(getUploadHandler('visit_qc_item')).toBe(UPLOAD_HANDLERS.visit_qc_item)
  })

  it('refuses an unknown entity type by name rather than falling back', () => {
    expect(() => getUploadHandler('TICKET')).toThrow(BadRequestError)
    expect(() => getUploadHandler('TICKET')).toThrow('No upload handler for entity type: TICKET')
  })
})

describe('the browser pre-flight table cannot drift from the handlers', () => {
  // `ENTITY_CONFIGS` is read in the browser (`orchestration-slice.ts`) to refuse
  // a file before it is uploaded. It used to restate the limits by hand and had
  // drifted: `WORKFLOW_RUN` refused at 15 MB what the server took to 50 MB,
  // `USER_PROFILE` offered `image/*` against four explicit server types, and
  // `ARTICLE` admitted video and audio the server rejects. Both sides now read
  // `UPLOAD_POLICIES`; this is what keeps them reading it.
  it.each(HANDLERS)('%s agrees with the client config on size and MIME', (key, handler) => {
    const config = ENTITY_CONFIGS[key as keyof typeof ENTITY_CONFIGS]

    expect(config.validation.maxFileSize).toBe(handler.maxFileSize)
    expect(config.validation.allowedMimeTypes).toEqual(handler.allowedMimeTypes)
  })
})

describe('strategy invariants', () => {
  it.each(HANDLERS)('%s declares an asset kind unless it is folder-file', (_key, handler) => {
    if (handler.persist === 'folder-file') {
      expect(handler.assetKind).toBeUndefined()
      return
    }
    const kind =
      typeof handler.assetKind === 'function'
        ? handler.assetKind({ metadata: {} } as never)
        : handler.assetKind
    expect(VALID_ASSET_KINDS).toContain(kind)
  })

  it.each(
    HANDLERS
  )('%s requires an entityId exactly when it writes an Attachment', (_k, handler) => {
    // `Attachment.entityId` is NOT NULL, so the two must agree or a session gets
    // signed for an upload whose completion cannot land.
    expect(requiresEntityId(handler)).toBe(handler.persist === 'asset+attachment')
  })

  it.each(HANDLERS)('%s only declares thumbnails on an asset-backed strategy', (_k, handler) => {
    if (!handler.thumbnails) return
    expect(handler.persist).not.toBe('folder-file')
    expect(handler.thumbnails.presets.length).toBeGreaterThan(0)
  })

  it('never asks two presets to write User.image', () => {
    for (const [, handler] of HANDLERS) {
      const writers = Object.values(handler.thumbnails?.perPreset ?? {}).filter(
        (options) => options?.updateUser
      )
      // Two askers would be two jobs racing to write one column.
      expect(writers.length).toBeLessThanOrEqual(1)
    }
  })

  it('previews only a preset it actually enqueues', () => {
    for (const [, handler] of HANDLERS) {
      const preview = handler.thumbnails?.preview
      if (!preview) continue
      expect(handler.thumbnails?.presets).toContain(preview)
    }
  })
})

describe('CUSTOM_FIELD policy narrowing', () => {
  const config = {
    policy: {
      keyPrefix: 'org/',
      contentLengthRange: [0, 25 * 1024 * 1024],
      maxTtl: 600,
      allowedMimeTypes: ['*/*'],
    },
  } as UploadPreparedConfig

  it('leaves the config alone when the field declares no file options', () => {
    expect(narrowPolicyToFieldOptions(config, undefined)).toBe(config)
    expect(narrowPolicyToFieldOptions(config, {})).not.toBe(config)
    expect(narrowPolicyToFieldOptions(config, {}).policy.allowedMimeTypes).toEqual(['*/*'])
  })

  it('replaces the wildcard with the field categories MIME patterns', () => {
    const narrowed = narrowPolicyToFieldOptions(config, { allowedFileTypes: ['image'] })

    expect(narrowed.policy.allowedMimeTypes).not.toContain('*/*')
    expect(narrowed.policy.allowedMimeTypes.length).toBeGreaterThan(0)
    // The original is untouched: the narrowing returns a new frozen config.
    expect(config.policy.allowedMimeTypes).toEqual(['*/*'])
  })

  it('records the extension list without touching the MIME list', () => {
    const narrowed = narrowPolicyToFieldOptions(config, {
      allowedFileExtensions: ['.pdf', '.docx'],
    })

    expect(narrowed.policy.allowedExtensions).toEqual(['.pdf', '.docx'])
    expect(narrowed.policy.allowedMimeTypes).toEqual(['*/*'])
  })
})
