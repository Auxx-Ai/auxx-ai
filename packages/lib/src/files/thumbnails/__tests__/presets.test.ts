// packages/lib/src/files/thumbnails/__tests__/presets.test.ts

/**
 * `thumbnails/presets.ts` — the pure half. **Zero doubles**, table-driven, which
 * is shape 1 of `plans/attachments/09-testing-strategy.md` §9.2.
 *
 * The assertions that matter are about the *key*, not about the preset table:
 * the key is what decides whether two thumbnail requests collapse into one job,
 * and it was the thing the two legacy enqueue sites disagreed about.
 */

import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../../../errors'
import {
  assertPresetKey,
  DEFAULT_PRESET,
  isPresetKey,
  mimeTypeForFormat,
  type PresetKey,
  THUMBNAIL_PRESETS,
  thumbnailJobId,
  thumbnailJobKey,
  thumbnailLatchKey,
} from '../presets'

const VERSION = 'ver_1'

describe('THUMBNAIL_PRESETS', () => {
  const expected: Array<[PresetKey, number, number, string, string, number]> = [
    ['avatar-32', 32, 32, 'cover', 'webp', 90],
    ['avatar-64', 64, 64, 'cover', 'webp', 90],
    ['avatar-128', 128, 128, 'cover', 'webp', 85],
    ['avatar-256', 256, 256, 'cover', 'webp', 85],
    ['article-thumb', 200, 150, 'cover', 'jpeg', 85],
    ['article-cover', 800, 400, 'cover', 'jpeg', 85],
    ['article-inline', 600, 600, 'inside', 'jpeg', 90],
    ['attachment-preview', 400, 400, 'inside', 'png', 100],
    ['attachment-thumb', 150, 150, 'cover', 'webp', 85],
    ['comment-preview', 200, 200, 'cover', 'webp', 85],
    ['comment-preview-large', 400, 300, 'inside', 'webp', 90],
    ['kb-logo-sm', 200, 60, 'inside', 'png', 100],
    ['kb-logo-lg', 400, 120, 'inside', 'png', 100],
  ]

  it.each(expected)('%s renders %ix%i %s/%s q%i', (preset, w, h, fit, format, quality) => {
    expect(THUMBNAIL_PRESETS[preset]).toEqual({ w, h, fit, format, quality })
  })

  it('has an entry for every declared key and no extras', () => {
    expect(Object.keys(THUMBNAIL_PRESETS).sort()).toEqual(expected.map(([k]) => k).sort())
  })

  it('names a default that exists', () => {
    expect(THUMBNAIL_PRESETS[DEFAULT_PRESET]).toBeDefined()
  })
})

describe('assertPresetKey', () => {
  it('narrows a known preset', () => {
    expect(assertPresetKey('kb-logo-lg')).toBe('kb-logo-lg')
  })

  it('refuses an unknown preset with a BadRequestError, not a TypeError', () => {
    // The legacy service indexed the table and read `.format` off `undefined`.
    expect(() => assertPresetKey('avatar-999')).toThrow(BadRequestError)
  })

  it('is not fooled by an inherited Object.prototype key', () => {
    expect(isPresetKey('toString')).toBe(false)
    expect(() => assertPresetKey('constructor')).toThrow(BadRequestError)
  })
})

describe('mimeTypeForFormat', () => {
  it.each([
    ['webp', 'image/webp'],
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
  ] as const)('%s -> %s', (format, mime) => {
    expect(mimeTypeForFormat(format)).toBe(mime)
  })
})

describe('thumbnailJobKey', () => {
  it('is stable for the same request', () => {
    expect(thumbnailJobKey(VERSION, 'avatar-64')).toBe(thumbnailJobKey(VERSION, 'avatar-64'))
  })

  it('is a 16-char hex digest', () => {
    expect(thumbnailJobKey(VERSION, 'avatar-64')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('separates versions and presets', () => {
    const base = thumbnailJobKey(VERSION, 'avatar-64')
    expect(thumbnailJobKey('ver_2', 'avatar-64')).not.toBe(base)
    expect(thumbnailJobKey(VERSION, 'avatar-128')).not.toBe(base)
  })

  it('separates requests whose output bytes would differ', () => {
    const base = thumbnailJobKey(VERSION, 'avatar-64')
    expect(thumbnailJobKey(VERSION, 'avatar-64', { format: 'png' })).not.toBe(base)
    expect(thumbnailJobKey(VERSION, 'avatar-64', { quality: 50 })).not.toBe(base)
  })

  it('treats an explicit override equal to the preset default as the same request', () => {
    const config = THUMBNAIL_PRESETS['avatar-64']
    expect(
      thumbnailJobKey(VERSION, 'avatar-64', { format: config.format, quality: config.quality })
    ).toBe(thumbnailJobKey(VERSION, 'avatar-64'))
  })

  it('ignores knobs that cannot change the output', () => {
    // `queue` is a routing choice and `visibility` is not part of the database's
    // own `(derivedFromVersionId, preset)` uniqueness — folding either into the
    // key would let two jobs race for one unique-index slot. The legacy
    // `thumbnail-enqueue.ts` key included both.
    const base = thumbnailJobKey(VERSION, 'avatar-64')
    expect(thumbnailJobKey(VERSION, 'avatar-64', { queue: false })).toBe(base)
    expect(thumbnailJobKey(VERSION, 'avatar-64', { visibility: 'PRIVATE' })).toBe(base)
    expect(thumbnailJobKey(VERSION, 'avatar-64', { updateUser: true })).toBe(base)
  })
})

describe('job id and latch key', () => {
  it('pair the way the worker expects', () => {
    // `generate-thumbnail-job.ts` released a latch at a hard-coded
    // `processing:thumb-${key}`. Pinning that string here is what stops the
    // producer and the consumer drifting again.
    expect(thumbnailJobId('abc123')).toBe('thumb-abc123')
    expect(thumbnailLatchKey('abc123')).toBe('processing:thumb-abc123')
    expect(thumbnailLatchKey('abc123')).toBe(`processing:${thumbnailJobId('abc123')}`)
  })
})
