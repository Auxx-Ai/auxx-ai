// packages/lib/src/recording/bot/media-downloader.ts

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import { createMediaAssetService } from '../../files/core/media-asset-service'
import type { AssetKind } from '../../files/core/types'
import { createStorageManager } from '../../files/storage/storage-manager'
import { findRecording, updateRecording } from '../recording-queries'
import { getProvider } from './providers'
import type { BotProviderId } from './types'

const logger = createScopedLogger('recording:media-downloader')

/**
 * Download recording media from the bot provider and store in S3.
 * Creates MediaAsset + MediaAssetVersion rows and updates the CallRecording with asset references.
 */
export async function downloadAndStoreRecordingMedia(params: {
  recordingId: string
  organizationId: string
}): Promise<Result<{ videoAssetId?: string; audioAssetId?: string }, Error>> {
  const { recordingId, organizationId } = params

  const recording = await findRecording({ id: recordingId, organizationId })

  if (!recording) {
    return err(new NotFoundError(`CallRecording ${recordingId} not found`))
  }

  if (!recording.externalBotId) {
    return err(new Error(`CallRecording ${recordingId} has no externalBotId`))
  }

  const provider = getProvider(recording.provider as BotProviderId)
  const mediaResult = await provider.getMediaUrl(recording.externalBotId)

  if (mediaResult.isErr()) {
    return err(mediaResult.error)
  }

  const { videoUrl, audioUrl } = mediaResult.value

  let videoAssetId: string | undefined
  let audioAssetId: string | undefined

  // Download and store video
  if (videoUrl) {
    const result = await downloadAndStoreFile({
      url: videoUrl,
      storageKey: `recordings/${organizationId}/${recordingId}/video.mp4`,
      mimeType: 'video/mp4',
      name: 'video.mp4',
      kind: 'VIDEO',
      organizationId,
      createdById: recording.createdById,
    })

    if (result.isOk()) {
      videoAssetId = result.value
      logger.info('Video stored', { recordingId, assetId: videoAssetId })
    } else {
      logger.error('Failed to store video', { recordingId, error: result.error.message })
    }
  }

  // Download and store audio
  if (audioUrl) {
    const result = await downloadAndStoreFile({
      url: audioUrl,
      storageKey: `recordings/${organizationId}/${recordingId}/audio.mp3`,
      mimeType: 'audio/mpeg',
      name: 'audio.mp3',
      kind: 'AUDIO',
      organizationId,
      createdById: recording.createdById,
    })

    if (result.isOk()) {
      audioAssetId = result.value
      logger.info('Audio stored', { recordingId, assetId: audioAssetId })
    } else {
      logger.error('Failed to store audio', { recordingId, error: result.error.message })
    }
  }

  if (!videoAssetId && !audioAssetId) {
    return err(new Error(`No media available for recording ${recordingId}`))
  }

  // Update CallRecording with asset references
  await updateRecording(
    { id: recordingId, organizationId },
    {
      ...(videoAssetId ? { videoAssetId } : {}),
      ...(audioAssetId ? { audioAssetId } : {}),
    }
  )

  logger.info('Recording media download complete', {
    recordingId,
    videoAssetId,
    audioAssetId,
  })

  return ok({ videoAssetId, audioAssetId })
}

/**
 * Download a file from a URL and upload to S3 via StorageManager.
 * Creates a MediaAsset + MediaAssetVersion and returns the asset ID.
 */
async function downloadAndStoreFile(params: {
  url: string
  storageKey: string
  mimeType: string
  name: string
  kind: AssetKind
  organizationId: string
  createdById: string
}): Promise<Result<string, Error>> {
  const { url, storageKey, mimeType, name, kind, organizationId, createdById } = params

  try {
    // Download from provider URL
    const response = await fetch(url)
    if (!response.ok) {
      return err(new Error(`Failed to download media: ${response.status} ${response.statusText}`))
    }

    const buffer = Buffer.from(await response.arrayBuffer())

    // Upload to S3
    const storageManager = createStorageManager(organizationId)
    const storageLocation = await storageManager.uploadContent({
      provider: 'S3',
      key: storageKey,
      content: buffer,
      mimeType,
      size: buffer.length,
      organizationId,
      visibility: 'PRIVATE',
    })

    // Create MediaAsset + MediaAssetVersion
    const mediaAssetService = createMediaAssetService(organizationId, createdById)
    const { asset } = await mediaAssetService.createWithVersion(
      {
        kind,
        purpose: `recording-${kind.toLowerCase()}`,
        name,
        mimeType,
        size: BigInt(buffer.length),
        isPrivate: true,
        organizationId,
        createdById,
      },
      storageLocation.id
    )

    return ok(asset.id)
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
