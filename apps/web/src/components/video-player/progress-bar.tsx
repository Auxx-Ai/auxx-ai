// apps/web/src/components/video-player/progress-bar.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { throttle } from '@auxx/utils/functions'
import { useMemo } from 'react'
import { usePlayerMode } from './player-mode-context'
import { StoryboardPreview } from './storyboard-preview'
import type { Chapter, ChapterSegment } from './types'
import { clamp, formatTime } from './utils'
import {
  usePlayerContext,
  useVideoPlayerActions,
  useVideoPlayerStore,
} from './video-player-context'

const SEEK_CHANGE_EVENT = 'on-seek-change-custom-event'

function useChapterSegments(chapters: Chapter[] | undefined): ChapterSegment[] {
  const played = useVideoPlayerStore((s) => s.played)
  const duration = useVideoPlayerStore((s) => s.duration)
  const totalDuration =
    duration > 0 ? duration : chapters?.length ? chapters[chapters.length - 1].end : 0

  return useMemo(() => {
    if (!chapters || chapters.length === 0) {
      return [
        {
          start: 0,
          end: totalDuration,
          title: '',
          width: 100,
          progress: totalDuration > 0 ? Math.min((played / totalDuration) * 100, 100) : 0,
        },
      ]
    }
    return chapters.map((ch) => {
      const len = ch.end - ch.start
      const width = totalDuration > 0 ? (len / totalDuration) * 100 : 0
      let progress = 0
      if (played >= ch.end) progress = 100
      else if (played > ch.start) progress = ((played - ch.start) / len) * 100
      return { ...ch, width, progress }
    })
  }, [chapters, played, totalDuration])
}

export function ProgressBar() {
  const { player, chapters, thumbnailStoryboardUrl } = usePlayerContext()
  const { seekTo } = useVideoPlayerActions()
  const { mode } = usePlayerMode()

  const played = useVideoPlayerStore((s) => s.played)
  const duration = useVideoPlayerStore((s) => s.duration)
  const hoveredPct = useVideoPlayerStore((s) => s.hoveredTimePercentage)
  const highlightedRanges = useVideoPlayerStore((s) => s.highlightedRanges)
  const store = useVideoPlayerStore()

  const totalDuration =
    duration > 0 ? duration : chapters?.length ? chapters[chapters.length - 1].end : 0
  const segments = useChapterSegments(chapters)
  const progressPct = totalDuration > 0 ? (played / totalDuration) * 100 : 0
  const hasHighlights = highlightedRanges.length > 0

  const isRegular = mode === 'regular'

  const throttledSeek = useMemo(() => throttle(seekTo, 100), [seekTo])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pct = Number.parseFloat(e.target.value)
    const time = (pct / 100) * totalDuration
    throttledSeek(time)

    // Dispatch custom event for external listeners
    const internal = player.current?.getInternalPlayer() as HTMLVideoElement | null
    internal?.dispatchEvent(new CustomEvent(SEEK_CHANGE_EVENT, { detail: { seekToTime: time } }))
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1)
    store.getState().setHoveredTimePercentage(pct)
  }

  const handlePointerLeave = () => {
    store.getState().setHoveredTimePercentage(undefined)
  }

  return (
    <div className='self-stretch px-1'>
      {/* Time labels */}
      <div className='mb-0.5 flex justify-between gap-2'>
        <span
          className={cn(
            'text-[10px] tabular-nums',
            isRegular ? 'text-white' : 'text-muted-foreground'
          )}>
          {formatTime(played)}
        </span>
        <span
          className={cn(
            'text-[10px] tabular-nums',
            isRegular ? 'text-white' : 'text-muted-foreground'
          )}>
          {formatTime(totalDuration)}
        </span>
      </div>

      {/* Track area */}
      <div
        className='relative flex h-5 w-full cursor-pointer items-center gap-[3px]'
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}>
        {/* Chapter segments */}
        {segments.map((seg, i) => (
          <div
            key={i}
            className={cn(
              'relative h-1 grow overflow-hidden rounded-full',
              isRegular ? 'bg-white/40' : 'bg-black/15'
            )}
            style={{ flexBasis: `${seg.width}%` }}>
            <span
              className={cn(
                'absolute top-0 left-0 h-full rounded-full transition-[width] duration-100 ease-linear',
                !hasHighlights && (isRegular ? 'bg-white' : 'bg-foreground')
              )}
              style={{ width: `${seg.progress}%` }}
            />
          </div>
        ))}

        {/* Highlighted ranges */}
        {highlightedRanges.map((range) => {
          const left = totalDuration > 0 ? (range.start / totalDuration) * 100 : 0
          const width = totalDuration > 0 ? ((range.end - range.start) / totalDuration) * 100 : 0
          return (
            <div
              key={`${range.start}-${range.end}`}
              className='pointer-events-none absolute h-1 rounded-full'
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: range.color,
              }}
            />
          )
        })}

        {/* Hover indicator */}
        {hoveredPct !== undefined && (
          <div
            className={cn(
              'pointer-events-none absolute h-1 w-2 -translate-x-1/2 rounded-full',
              isRegular ? 'bg-white' : 'bg-foreground'
            )}
            style={{ left: `${hoveredPct * 100}%` }}
          />
        )}

        {/* Seek thumb */}
        <div
          className='pointer-events-none absolute z-2 size-[9px] -translate-x-1/2 rounded-full border-[1.5px] border-border bg-muted-foreground transition-[left] duration-150 ease-out'
          style={{
            left: `${progressPct}%`,
            ...(hasHighlights && { background: highlightedRanges[0].color }),
          }}
        />

        {/* Invisible range input for interaction */}
        <input
          type='range'
          min={0}
          max={100}
          step={0.1}
          value={progressPct}
          onChange={handleChange}
          aria-label='Played progress'
          className='absolute z-3 m-0 h-5 w-full cursor-pointer opacity-0'
        />

        {/* Storyboard preview */}
        <StoryboardPreview />
      </div>
    </div>
  )
}
