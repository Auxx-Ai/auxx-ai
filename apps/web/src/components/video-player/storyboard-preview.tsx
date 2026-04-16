// apps/web/src/components/video-player/storyboard-preview.tsx
'use client'

import { useMemo } from 'react'
import type { Chapter } from './types'
import { formatTime } from './utils'
import { usePlayerContext, useVideoPlayerStore } from './video-player-context'

const PREVIEW_WIDTH = 236
const THUMB_WIDTH = 228
const COLUMNS = 5

function getRowCount(url: string | undefined): number {
  if (!url) return 5
  // Mux storyboard URLs have 10 rows; others default to 5
  if (url.startsWith('https://image.mux.com/') && url.includes('/storyboard.')) return 10
  return 5
}

interface StoryboardFrameProps {
  url: string
  percentage: number
  columns: number
  rows: number
}

function StoryboardFrame({ url, percentage, columns, rows }: StoryboardFrameProps) {
  const frameIndex = Math.floor(columns * rows * percentage)
  const col = frameIndex % columns
  const row = Math.floor(frameIndex / columns)

  return (
    <div
      className='rounded-md'
      style={{
        width: THUMB_WIDTH,
        height: THUMB_WIDTH / (16 / 9),
        backgroundImage: `url(${url})`,
        backgroundSize: `${100 * columns}% ${100 * rows}%`,
        backgroundPosition: `-${100 * col}% -${100 * row}%`,
      }}
    />
  )
}

function findChapter(chapters: Chapter[] | undefined, time: number): Chapter | undefined {
  if (!chapters) return undefined
  return chapters.find((ch) => ch.start <= time && time < ch.end)
}

export function StoryboardPreview() {
  const { thumbnailStoryboardUrl, chapters } = usePlayerContext()
  const hoveredPct = useVideoPlayerStore((s) => s.hoveredTimePercentage)
  const duration = useVideoPlayerStore((s) => s.duration)
  const totalDuration =
    duration > 0 ? duration : chapters?.length ? chapters[chapters.length - 1].end : 0

  const rows = useMemo(() => getRowCount(thumbnailStoryboardUrl), [thumbnailStoryboardUrl])

  if (hoveredPct === undefined) return null

  const hoveredTime = hoveredPct * totalDuration
  const chapter = findChapter(chapters, hoveredTime)

  // Nothing to show if no storyboard and no named chapter
  if (!thumbnailStoryboardUrl && !(chapter && chapter.title)) return null

  // Clamp horizontal position so the popup stays inside the player
  const leftPx = `clamp(8px, calc(${hoveredPct * 100}% - ${PREVIEW_WIDTH / 2}px), calc(100% - ${PREVIEW_WIDTH + 8}px))`

  return (
    <div
      className='pointer-events-none absolute z-10 rounded-lg p-1'
      style={{
        bottom: 48,
        left: leftPx,
        width: PREVIEW_WIDTH,
        background: 'var(--surface-floating, #fff)',
        border: '1px solid var(--stroke-floating, #e5e7eb)',
      }}>
      {thumbnailStoryboardUrl && (
        <StoryboardFrame
          url={thumbnailStoryboardUrl}
          percentage={hoveredPct}
          columns={COLUMNS}
          rows={rows}
        />
      )}
      <div className='overflow-hidden px-1'>
        {chapter?.title && (
          <div
            className='truncate text-xs font-medium'
            style={{ color: 'var(--text-on-accent, #fff)' }}>
            {chapter.title}
          </div>
        )}
        <span className='text-[10px]' style={{ color: 'var(--text-floating-tertiary, #8c95a6)' }}>
          {formatTime(hoveredTime)}
        </span>
      </div>
    </div>
  )
}
