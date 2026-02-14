// packages/lib/src/files/core/thumbnail-enqueue.ts
// Server-side helper to enqueue thumbnail generation without importing processing code.

import { database as db, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { getQueue, Queues } from '../../jobs/queues'
import type { PresetKey, ThumbnailOptions, ThumbnailSource } from './thumbnail-types'
import { THUMBNAIL_PRESETS } from './thumbnail-types'

export async function enqueueEnsureThumbnail(params: {
  organizationId: string
  userId: string
  source: ThumbnailSource
  opts: ThumbnailOptions
}): Promise<
  | { status: 'queued'; jobId: string }
  | { status: 'ready'; assetId: string; storageLocationId: string }
> {
  const { organizationId, userId, source, opts } = params

  const preset = (opts.preset ?? 'avatar-64') as PresetKey
  if (!THUMBNAIL_PRESETS[preset]) {
    throw new Error(`Invalid thumbnail preset: ${preset}`)
  }

  // Resolve to mediaAssetVersion id and visibility
  const { versionId, visibility } = await resolveVersion(organizationId, source)

  // Check if already exists
  const [existing] = await db
    .select()
    .from(schema.MediaAssetVersion)
    .where(
      and(
        eq(schema.MediaAssetVersion.derivedFromVersionId, versionId),
        eq(schema.MediaAssetVersion.preset, preset),
        isNull(schema.MediaAssetVersion.deletedAt)
      )
    )
    .limit(1)
  if (existing?.storageLocationId) {
    return {
      status: 'ready',
      assetId: existing.assetId!,
      storageLocationId: existing.storageLocationId,
    }
  }

  const key = makeKey(versionId, preset, opts)
  const thumbnailQueue = getQueue(Queues.thumbnailQueue)
  const job = await thumbnailQueue.add(
    'generateThumbnail',
    {
      orgId: organizationId,
      userId,
      versionId,
      preset,
      opts,
      key,
      visibility,
    },
    { removeOnComplete: true, removeOnFail: false }
  )
  return { status: 'queued', jobId: job.id! as unknown as string }
}

function makeKey(versionId: string, preset: string, opts: ThumbnailOptions): string {
  const q = opts.queue ? 'q1' : 'q0'
  const vis = opts.visibility ?? 'PRIVATE'
  return `${versionId}:${preset}:${q}:${vis}`
}

async function resolveVersion(
  organizationId: string,
  source: ThumbnailSource
): Promise<{ versionId: string; visibility: 'PUBLIC' | 'PRIVATE' }> {
  switch (source.type) {
    case 'asset': {
      const [asset] = await db
        .select()
        .from(schema.MediaAsset)
        .where(
          and(
            eq(schema.MediaAsset.id, source.assetId),
            eq(schema.MediaAsset.organizationId, organizationId)
          )
        )
        .limit(1)
      if (!asset) throw new Error(`Asset not found: ${source.assetId}`)
      const versionId = source.assetVersionId ?? asset.currentVersionId
      if (!versionId) throw new Error('Asset has no current version')
      return { versionId, visibility: asset.isPrivate ? 'PRIVATE' : 'PUBLIC' }
    }
    case 'file': {
      const [file] = await db
        .select()
        .from(schema.FolderFile)
        .where(
          and(
            eq(schema.FolderFile.id, source.fileId),
            eq(schema.FolderFile.organizationId, organizationId)
          )
        )
        .limit(1)
      if (!file || !file.currentVersionId) throw new Error('File not found or missing version')
      const versionId = source.fileVersionId ?? file.currentVersionId
      return { versionId, visibility: 'PRIVATE' }
    }
    default:
      throw new Error(`Unsupported thumbnail source type: ${(source as any).type}`)
  }
}
