// apps/worker/src/recording/generate-video-assets.ts
//
// Orchestration: download the recorded video, extract a poster frame and a
// 5x5 storyboard sprite sheet, upload both to S3, link as MediaAssets, and
// update the CallRecording.

import { createWriteStream, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createMediaAssetService, createStorageManager } from '@auxx/lib/files/server'
import type { GenerateVideoAssetsJobData } from '@auxx/lib/jobs'
import { findRecording, updateRecording } from '@auxx/lib/recording'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { err, ok, type Result } from 'neverthrow'
import sharp from 'sharp'
import { compositeStoryboard } from './storyboard-compositor'
import { extractFrames, extractPosterFrame, probeDurationSeconds } from './video-frame-extractor'

const logger = createScopedLogger('worker:generate-video-assets')

// Match StoryboardPreview defaults (5 cols × 5 rows = 25 frames).
const STORYBOARD_COLUMNS = 5
const STORYBOARD_ROWS = 5
const STORYBOARD_FRAME_COUNT = STORYBOARD_COLUMNS * STORYBOARD_ROWS
const STORYBOARD_FRAME_WIDTH = 228
const STORYBOARD_FRAME_HEIGHT = Math.round(STORYBOARD_FRAME_WIDTH / (16 / 9)) // 128
const STORYBOARD_QUALITY = 75

const POSTER_WIDTH = 1280
const POSTER_TIMESTAMP_FRACTION = 0.1 // 10% in — avoids black intro frames

interface GenerateVideoAssetsParams {
  recordingId: string
  organizationId: string
}

interface GenerateVideoAssetsResult {
  previewAssetId: string | null
  storyboardAssetId: string | null
}

export async function generateVideoAssets(
  params: GenerateVideoAssetsParams
): Promise<Result<GenerateVideoAssetsResult, Error>> {
  const { recordingId, organizationId } = params

  const recording = await findRecording({ id: recordingId, organizationId })
  if (!recording) {
    return err(new Error(`CallRecording ${recordingId} not found`))
  }
  if (!recording.videoAssetId) {
    return err(new Error(`CallRecording ${recordingId} has no videoAssetId`))
  }

  const mediaAssetService = createMediaAssetService(organizationId, recording.createdById)

  // Get a presigned URL to stream the video down to a local temp file.
  const videoRef = await mediaAssetService.getDownloadRefForVersion(recording.videoAssetId, {
    disposition: 'attachment',
  })
  if (videoRef.type !== 'url' || !videoRef.url) {
    return err(new Error('Could not get presigned download URL for recording video'))
  }

  const workDir = await fs.mkdtemp(path.join(tmpdir(), `recording-${recordingId}-`))
  const videoPath = path.join(workDir, 'video.mp4')
  const framesDir = path.join(workDir, 'frames')
  const posterPath = path.join(workDir, 'poster.webp')
  const storyboardPath = path.join(workDir, 'storyboard.webp')

  let previewAssetId: string | null = null
  let storyboardAssetId: string | null = null

  try {
    await streamUrlToFile(videoRef.url, videoPath)

    const durationResult = await probeDurationSeconds(videoPath)
    if (durationResult.isErr()) {
      return err(durationResult.error)
    }
    const duration = durationResult.value

    // Poster — best-effort, isolated.
    try {
      previewAssetId = await generatePoster({
        recordingId,
        createdById: recording.createdById,
        organizationId,
        videoPath,
        posterPath,
        duration,
        mediaAssetService,
      })
      if (previewAssetId) {
        await updateRecording(
          { id: recordingId, organizationId },
          { videoPreviewAssetId: previewAssetId }
        )
      }
    } catch (error) {
      logger.error('Poster generation failed', {
        recordingId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // Storyboard — best-effort, isolated.
    try {
      storyboardAssetId = await generateStoryboard({
        recordingId,
        createdById: recording.createdById,
        organizationId,
        videoPath,
        framesDir,
        storyboardPath,
        duration,
        mediaAssetService,
      })
      if (storyboardAssetId) {
        await updateRecording(
          { id: recordingId, organizationId },
          { videoStoryboardAssetId: storyboardAssetId }
        )
      }
    } catch (error) {
      logger.error('Storyboard generation failed', {
        recordingId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    if (!previewAssetId && !storyboardAssetId) {
      return err(new Error('Both poster and storyboard generation failed'))
    }

    logger.info('Video assets generated', {
      recordingId,
      previewAssetId,
      storyboardAssetId,
    })

    return ok({ previewAssetId, storyboardAssetId })
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch((error) => {
      logger.warn('Failed to clean up work dir', {
        workDir,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
}

interface PosterParams {
  recordingId: string
  createdById: string | null
  organizationId: string
  videoPath: string
  posterPath: string
  duration: number
  mediaAssetService: ReturnType<typeof createMediaAssetService>
}

async function generatePoster(params: PosterParams): Promise<string | null> {
  const {
    recordingId,
    createdById,
    organizationId,
    videoPath,
    posterPath,
    duration,
    mediaAssetService,
  } = params

  const posterJpegPath = posterPath.replace(/\.webp$/, '.jpg')
  const extracted = await extractPosterFrame({
    inputPath: videoPath,
    outputPath: posterJpegPath,
    timestampSeconds: duration * POSTER_TIMESTAMP_FRACTION,
    width: POSTER_WIDTH,
  })
  if (extracted.isErr()) {
    throw extracted.error
  }

  // Re-encode as WebP for smaller size.
  await sharp(posterJpegPath).webp({ quality: 80 }).toFile(posterPath)

  const buffer = await fs.readFile(posterPath)
  const storageKey = `storyboards/${organizationId}/${recordingId}/preview.webp`

  const storageManager = createStorageManager(organizationId)
  const storageLocation = await storageManager.uploadContent({
    provider: 'S3',
    key: storageKey,
    content: buffer,
    mimeType: 'image/webp',
    size: buffer.length,
    organizationId,
    visibility: 'PRIVATE',
  })

  const { asset } = await mediaAssetService.createWithVersion(
    {
      kind: 'THUMBNAIL',
      purpose: 'recording-preview',
      name: 'preview.webp',
      mimeType: 'image/webp',
      size: BigInt(buffer.length),
      isPrivate: true,
      organizationId,
      createdById: createdById ?? undefined,
    },
    storageLocation.id
  )

  return asset.id
}

interface StoryboardParams {
  recordingId: string
  createdById: string | null
  organizationId: string
  videoPath: string
  framesDir: string
  storyboardPath: string
  duration: number
  mediaAssetService: ReturnType<typeof createMediaAssetService>
}

async function generateStoryboard(params: StoryboardParams): Promise<string | null> {
  const {
    recordingId,
    createdById,
    organizationId,
    videoPath,
    framesDir,
    storyboardPath,
    duration,
    mediaAssetService,
  } = params

  const extracted = await extractFrames({
    inputPath: videoPath,
    outputDir: framesDir,
    frameCount: STORYBOARD_FRAME_COUNT,
    frameWidth: STORYBOARD_FRAME_WIDTH,
    durationSeconds: duration,
  })
  if (extracted.isErr()) {
    throw extracted.error
  }

  const composited = await compositeStoryboard({
    framePaths: extracted.value.framePaths,
    columns: STORYBOARD_COLUMNS,
    frameWidth: STORYBOARD_FRAME_WIDTH,
    frameHeight: STORYBOARD_FRAME_HEIGHT,
    outputPath: storyboardPath,
    format: 'webp',
    quality: STORYBOARD_QUALITY,
  })
  if (composited.isErr()) {
    throw composited.error
  }

  const buffer = await fs.readFile(storyboardPath)
  const storageKey = `storyboards/${organizationId}/${recordingId}/storyboard.webp`

  const storageManager = createStorageManager(organizationId)
  const storageLocation = await storageManager.uploadContent({
    provider: 'S3',
    key: storageKey,
    content: buffer,
    mimeType: 'image/webp',
    size: buffer.length,
    organizationId,
    visibility: 'PRIVATE',
  })

  const { asset } = await mediaAssetService.createWithVersion(
    {
      kind: 'STORYBOARD',
      purpose: 'recording-storyboard',
      name: 'storyboard.webp',
      mimeType: 'image/webp',
      size: BigInt(buffer.length),
      isPrivate: true,
      organizationId,
      createdById: createdById ?? undefined,
    },
    storageLocation.id
  )

  logger.info('Storyboard composited', {
    rows: composited.value.rows,
    width: composited.value.width,
    height: composited.value.height,
    fileSize: composited.value.fileSize,
  })

  return asset.id
}

async function streamUrlToFile(url: string, filePath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status} ${response.statusText}`)
  }
  if (!response.body) {
    throw new Error('Video download response has no body')
  }
  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(filePath))
}

/**
 * BullMQ handler for `generateVideoAssetsJob`. Registered in the recording-processing
 * worker. Throws on full failure so BullMQ retries; succeeds when at least one of
 * the two derived assets (poster, storyboard) was produced.
 */
export const generateVideoAssetsJob = async (
  jobOrCtx: Job<GenerateVideoAssetsJobData>
): Promise<GenerateVideoAssetsResult> => {
  const job: Job<GenerateVideoAssetsJobData> = (jobOrCtx as any).job ?? jobOrCtx
  const { recordingId, organizationId } = job.data

  logger.info('Starting video assets generation', {
    jobId: job.id,
    recordingId,
    organizationId,
  })

  const result = await generateVideoAssets({ recordingId, organizationId })

  if (result.isErr()) {
    logger.error('Video assets generation failed', {
      jobId: job.id,
      recordingId,
      error: result.error.message,
    })
    throw result.error
  }

  return result.value
}
