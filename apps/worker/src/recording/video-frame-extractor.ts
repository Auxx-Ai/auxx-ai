// apps/worker/src/recording/video-frame-extractor.ts
//
// Thin wrapper around fluent-ffmpeg for video frame extraction. Lives in apps/worker
// (not @auxx/lib) so the system ffmpeg binary and fluent-ffmpeg dependency are only
// resolved in the worker container.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createScopedLogger } from '@auxx/logger'
import ffmpeg from 'fluent-ffmpeg'
import { err, ok, type Result } from 'neverthrow'

const logger = createScopedLogger('worker:video-frame-extractor')

interface ExtractFramesParams {
  inputPath: string
  outputDir: string
  frameCount: number
  frameWidth: number
  durationSeconds: number
}

interface ExtractFramesResult {
  framePaths: string[]
  frameInterval: number
  frameDimensions: { width: number; height: number }
}

/** Extract `frameCount` evenly-spaced frames from a video. */
export async function extractFrames(
  params: ExtractFramesParams
): Promise<Result<ExtractFramesResult, Error>> {
  const { inputPath, outputDir, frameCount, frameWidth, durationSeconds } = params

  if (frameCount <= 0 || durationSeconds <= 0) {
    return err(new Error('frameCount and durationSeconds must be > 0'))
  }

  const frameInterval = durationSeconds / frameCount
  const fps = 1 / frameInterval

  await fs.mkdir(outputDir, { recursive: true })

  return new Promise((resolve) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-vf',
        `fps=${fps},scale=${frameWidth}:-2`,
        '-frames:v',
        String(frameCount),
        '-q:v',
        '4',
      ])
      .output(path.join(outputDir, 'frame_%04d.jpg'))
      .on('end', async () => {
        try {
          const entries = (await fs.readdir(outputDir))
            .filter((f) => f.startsWith('frame_') && f.endsWith('.jpg'))
            .sort()
            .map((f) => path.join(outputDir, f))

          if (entries.length === 0) {
            resolve(err(new Error('ffmpeg produced no frames')))
            return
          }

          // Probe the first frame to learn the actual dimensions (height is auto-scaled).
          const dims = await probeFrameDimensions(entries[0])
          if (dims.isErr()) {
            resolve(err(dims.error))
            return
          }

          resolve(
            ok({
              framePaths: entries,
              frameInterval,
              frameDimensions: dims.value,
            })
          )
        } catch (error) {
          resolve(err(toError(error)))
        }
      })
      .on('error', (error) => {
        logger.error('ffmpeg extractFrames failed', { error: error.message })
        resolve(err(toError(error)))
      })
      .run()
  })
}

/** Extract a single frame at a given timestamp (seconds). */
export async function extractPosterFrame(params: {
  inputPath: string
  outputPath: string
  timestampSeconds: number
  width: number
}): Promise<Result<{ width: number; height: number }, Error>> {
  const { inputPath, outputPath, timestampSeconds, width } = params

  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  return new Promise((resolve) => {
    ffmpeg(inputPath)
      .seekInput(timestampSeconds)
      .outputOptions(['-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '2'])
      .output(outputPath)
      .on('end', async () => {
        const dims = await probeFrameDimensions(outputPath)
        resolve(dims)
      })
      .on('error', (error) => {
        logger.error('ffmpeg extractPosterFrame failed', { error: error.message })
        resolve(err(toError(error)))
      })
      .run()
  })
}

/** Probe a video file to determine its duration in seconds. */
export async function probeDurationSeconds(inputPath: string): Promise<Result<number, Error>> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputPath, (error, data) => {
      if (error) {
        resolve(err(toError(error)))
        return
      }
      const duration = data?.format?.duration
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
        resolve(err(new Error('ffprobe could not determine video duration')))
        return
      }
      resolve(ok(duration))
    })
  })
}

async function probeFrameDimensions(
  imagePath: string
): Promise<Result<{ width: number; height: number }, Error>> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(imagePath, (error, data) => {
      if (error) {
        resolve(err(toError(error)))
        return
      }
      const stream = data?.streams?.find((s) => s.width && s.height)
      if (!stream?.width || !stream?.height) {
        resolve(err(new Error('ffprobe could not determine frame dimensions')))
        return
      }
      resolve(ok({ width: stream.width, height: stream.height }))
    })
  })
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
