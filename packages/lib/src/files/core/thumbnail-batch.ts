// packages/lib/src/files/core/thumbnail-batch.ts

/**
 * Shared helper to enqueue multiple thumbnail presets for a given source.
 * Ensures consistent queuing behavior across processors and runs post-commit.
 */
import { ThumbnailService } from './thumbnail-service'
import type { PresetKey, ThumbnailOptions, ThumbnailSource } from './thumbnail-types'

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
export async function ensureThumbnailPresets(params: EnsureThumbnailPresetsParams): Promise<
  Array<{
    preset: PresetKey
    status: 'queued' | 'ready' | 'generated'
    jobId?: string
    /**
     * Present for `ready`/`generated`. Callers that need the public URL of a
     * thumbnail that already existed have no job to wait on and no other way to
     * find it — dropping this is what let an already-thumbnailed avatar strand
     * on `EntityInstance.avatarUrl = null` forever.
     */
    assetId?: string
    assetVersionId?: string
    storageLocationId?: string
  }>
> {
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
      if (res.status === 'queued') {
        return { preset, status: 'queued' as const, jobId: res.jobId }
      }
      return {
        preset,
        status: res.status,
        assetId: res.assetId,
        assetVersionId: res.assetVersionId,
        storageLocationId: res.storageLocationId,
      }
    })
  )

  return results
}
