// apps/worker/src/recording/storyboard-compositor.ts
//
// Sharp-based sprite-sheet composition for video storyboards.

import { promises as fs } from 'node:fs'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import sharp from 'sharp'

const logger = createScopedLogger('worker:storyboard-compositor')

interface CompositeParams {
  framePaths: string[]
  columns: number
  frameWidth: number
  frameHeight: number
  outputPath: string
  format: 'webp' | 'jpeg'
  quality: number
}

interface CompositeResult {
  width: number
  height: number
  rows: number
  fileSize: number
}

/** Tile ordered frames into a grid sprite sheet. */
export async function compositeStoryboard(
  params: CompositeParams
): Promise<Result<CompositeResult, Error>> {
  const { framePaths, columns, frameWidth, frameHeight, outputPath, format, quality } = params

  if (framePaths.length === 0) {
    return err(new Error('framePaths is empty'))
  }
  if (columns <= 0) {
    return err(new Error('columns must be > 0'))
  }

  const rows = Math.ceil(framePaths.length / columns)
  const canvasWidth = frameWidth * columns
  const canvasHeight = frameHeight * rows

  try {
    const composites = await Promise.all(
      framePaths.map(async (framePath, index) => {
        const col = index % columns
        const row = Math.floor(index / columns)
        // Resize each frame to the exact cell size so the grid is uniform even
        // when ffmpeg's auto-scaled height varies by ±1px per frame.
        const buffer = await sharp(framePath)
          .resize(frameWidth, frameHeight, { fit: 'cover', position: 'centre' })
          .toBuffer()
        return {
          input: buffer,
          left: col * frameWidth,
          top: row * frameHeight,
        }
      })
    )

    const pipeline = sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    }).composite(composites)

    const output = format === 'webp' ? pipeline.webp({ quality }) : pipeline.jpeg({ quality })

    await output.toFile(outputPath)

    const stat = await fs.stat(outputPath)

    return ok({
      width: canvasWidth,
      height: canvasHeight,
      rows,
      fileSize: stat.size,
    })
  } catch (error) {
    logger.error('compositeStoryboard failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
