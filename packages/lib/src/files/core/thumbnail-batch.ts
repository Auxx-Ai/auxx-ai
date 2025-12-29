// packages/lib/src/files/core/thumbnail-batch.ts

/**
 * Shared helper to enqueue multiple thumbnail presets for a given source.
 * Ensures consistent queuing behavior across processors and runs post-commit.
 */
import { ThumbnailService } from './thumbnail-service'
import type { ThumbnailSource, ThumbnailOptions, PresetKey } from './thumbnail-types'

export interface EnsureThumbnailPresetsParams {
  /** Organization scope */
  organizationId: string
  /** Acting user */
  userId: string
  /** Thumbnail source */
  source: ThumbnailSource
  /** Presets to enqueue */
  presets: readonly PresetKey[]
  /** Default options applied to all presets (queue true by default) */
  defaultOptions?: Omit<ThumbnailOptions, 'preset'>
  /** Optional per-preset overrides */
  perPreset?: Partial<Record<PresetKey, Partial<ThumbnailOptions>>>
}

/**
 * Enqueue a set of thumbnails. Returns an array of results in preset order.
 */
export async function ensureThumbnailPresets(
  params: EnsureThumbnailPresetsParams
): Promise<Array<{ preset: PresetKey; status: 'queued' | 'ready' | 'generated'; jobId?: string }>> {
  const { organizationId, userId, source, presets, defaultOptions, perPreset } = params
  const service = new ThumbnailService(organizationId, userId)

  const results = await Promise.all(
    presets.map(async (preset) => {
      const base: ThumbnailOptions = {
        queue: true,
        visibility: 'PUBLIC',
        ...(defaultOptions || {}),
        ...(perPreset?.[preset] || {}),
      }
      const res = await service.ensureThumbnail(source, { ...base, preset })
      if (res.status === 'queued') return { preset, status: 'queued', jobId: res.jobId }
      return { preset, status: res.status }
    })
  )

  return results
}

