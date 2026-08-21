// packages/lib/src/field-values/__tests__/avatar-interim-url.test.ts

import { getFileRefDownloadUrl } from '@auxx/types/file-ref'
import { describe, expect, it } from 'vitest'
import { DisplayFieldService } from '../display-field-service'

/**
 * `EntityInstance.avatarUrl` for a FILE avatar field must never be `null` while a
 * ref exists.
 *
 * It used to be: the save path wrote `null` as an "interim" and left the CDN URL to
 * the thumbnail job. But `ThumbnailService.ensureThumbnail` returns `ready` without
 * queuing anything when the preset already exists, and the job was the only writer
 * of `avatarUrl` — so on every re-pick of an already-thumbnailed asset the interim
 * `null` was permanent and the record sat on its fallback icon. Even in the happy
 * path it blanked the avatar for the whole generation window.
 *
 * The interim is now the app's own download URL, which always resolves. The
 * thumbnail is an upgrade, not the only source of truth.
 */

const AVATAR_REF = 'asset:jjqnjnct2fg7vnblseqcqrsb'

/** `computeDisplayValue` is private; these tests exercise it directly by design. */
function computeAvatar(value: unknown): string | null {
  const service = new DisplayFieldService('org-1')
  return (
    service as unknown as {
      computeDisplayValue: (v: unknown, f: unknown, t: string, c?: string) => string | null
    }
  ).computeDisplayValue(value, { fieldType: 'FILE' }, 'avatar')
}

function jsonValue(v: Record<string, unknown>) {
  return { type: 'json' as const, value: v }
}

describe('avatar display value for a FILE ref', () => {
  it('resolves an asset ref to the download URL, never null', () => {
    const result = computeAvatar(jsonValue({ ref: AVATAR_REF }))

    expect(result).toBe(getFileRefDownloadUrl(AVATAR_REF as never))
    expect(result).toBe(`/api/files/download/${AVATAR_REF}`)
    expect(result).not.toBeNull()
  })

  it('resolves the ref when the value arrives as a multi-value array', () => {
    const result = computeAvatar([jsonValue({ ref: AVATAR_REF })])
    expect(result).toBe(`/api/files/download/${AVATAR_REF}`)
  })

  it('still prefers an explicit url over the ref', () => {
    const result = computeAvatar(jsonValue({ url: 'https://cdn.auxx.ai/a.png', ref: AVATAR_REF }))
    expect(result).toBe('https://cdn.auxx.ai/a.png')
  })

  it('leaves a non-asset ref alone', () => {
    // Only `asset:` refs route through the download URL — a `file:` ref or a
    // malformed one must not be handed to the avatar as if it resolved.
    expect(computeAvatar(jsonValue({ ref: 'not-a-ref' }))).toBeNull()
  })

  it('returns null when there is no value at all', () => {
    expect(computeAvatar(null)).toBeNull()
  })

  it('passes a text value through the visual-ref grammar untouched', () => {
    expect(computeAvatar({ type: 'text', value: 'color:indigo' })).toBe('color:indigo')
  })
})
