// apps/web/src/components/video-player/video-player.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { debounce } from '@auxx/utils/functions'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ControlBar } from './controls'
import { PlayOverlay } from './play-overlay'
import { PlayerModeProvider, usePlayerMode } from './player-mode-context'
import type { PlayerControls, VideoPlayerProps } from './types'
import {
  useVideoPlayerActions,
  useVideoPlayerStore,
  VideoPlayerProvider,
} from './video-player-context'
import { VideoRenderer } from './video-renderer'

// ── Constants ────────────────────────────────────────────────────

const MINI_HEIGHT = 64
const CONTROLS_HIDE_DELAY = 3000

// ── Inner player (manages visibility, keyboard, animations) ─────

interface VideoPlayerInnerProps {
  borderRadius: string
  hasBorder: boolean
  className?: string
  miniStandaloneControls?: React.ReactNode
  autoFocus?: boolean
}

function VideoPlayerInner({
  borderRadius,
  hasBorder,
  className,
  miniStandaloneControls,
  autoFocus,
}: VideoPlayerInnerProps) {
  const { mode } = usePlayerMode()
  const store = useVideoPlayerStore()
  const { play, pause, seekForward, seekBackward } = useVideoPlayerActions()

  const playing = useVideoPlayerStore((s) => s.playing)
  const pip = useVideoPlayerStore((s) => s.pip)
  const openMenus = useVideoPlayerStore((s) => s.openMenus)
  const isInitialLoading = useVideoPlayerStore((s) => s.isInitialLoading)
  const ready = useVideoPlayerStore((s) => s.ready)

  const containerRef = useRef<HTMLDivElement>(null)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [hovering, setHovering] = useState(false)

  // Auto-focus when ready
  useEffect(() => {
    if (autoFocus && ready && containerRef.current) {
      const active = document.activeElement
      if (!active || active === document.body) {
        containerRef.current.focus()
      }
    }
  }, [autoFocus, ready])

  // Hide controls after inactivity
  const scheduleHide = useMemo(
    () =>
      debounce(() => {
        setControlsVisible(false)
      }, CONTROLS_HIDE_DELAY),
    []
  )

  const showControls = useCallback(() => {
    setControlsVisible(true)
    scheduleHide()
  }, [scheduleHide])

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          seekBackward()
          break
        case 'ArrowRight':
          seekForward()
          break
        case ' ':
          e.preventDefault()
          playing ? pause() : play()
          break
      }
    },
    [seekBackward, seekForward, playing, pause, play]
  )

  const shouldShowControls = controlsVisible || openMenus.length > 0 || hovering
  const isMini = mode === 'mini' || mode === 'mini-standalone'

  return (
    <div
      data-mode={mode}
      className={cn(
        'relative w-full overflow-x-clip',
        isMini && 'flex items-center p-3',
        className
      )}>
      {/* Main video surface */}
      <div
        ref={containerRef}
        data-mode={mode}
        className={cn(
          'react-player-container z-1 overflow-hidden outline-none',
          isMini ? 'shrink-0' : 'relative aspect-video h-auto w-full'
        )}
        tabIndex={0}
        onPointerMove={showControls}
        onPointerEnter={showControls}
        onKeyDown={handleKeyDown}
        style={{
          borderRadius: `${borderRadius}px`,
          ...(isMini && {
            height: MINI_HEIGHT,
            width: (MINI_HEIGHT * 16) / 9,
          }),
        }}>
        {/* Border overlay */}
        {hasBorder && (
          <div
            className='pointer-events-none absolute inset-0 z-5'
            style={{
              borderRadius: `${borderRadius}px`,
              boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)',
            }}
          />
        )}

        <VideoRenderer borderRadius={borderRadius} hasBorder={hasBorder} />

        {/* PiP placeholder */}
        {pip && (
          <div
            className='absolute inset-0 flex items-center justify-center text-[13px]'
            style={{
              background: 'var(--surface-secondary, #f3f4f6)',
              color: 'var(--text-quaternary, #9ca3af)',
            }}>
            Video playing in picture-in-picture
          </div>
        )}

        {/* Play overlay + controls (regular mode only, not during initial load) */}
        {!isMini && !pip && !(isInitialLoading && !store.getState().videoLoadRequested) && (
          <>
            <PlayOverlay />
            <div
              className={cn(
                'absolute right-0 bottom-0 left-0 text-white transition-opacity duration-300 ease-out',
                shouldShowControls
                  ? 'pointer-events-auto opacity-100'
                  : 'pointer-events-none opacity-0'
              )}
              onMouseEnter={() => setHovering(true)}
              onMouseLeave={() => setHovering(false)}>
              <ControlBar />
            </div>
          </>
        )}
      </div>

      {/* Mini-mode side controls */}
      {isMini && (
        <div
          data-mode={mode}
          className='flex min-w-0 flex-1'
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}>
          <ControlBar miniStandaloneControls={miniStandaloneControls} />
        </div>
      )}
    </div>
  )
}

// ── Mode wrapper ─────────────────────────────────────────────────

function ModeWrapper({
  mode,
  controls,
  borderRadius,
  hasBorder,
  className,
  miniStandaloneControls,
  autoFocus,
  children,
}: {
  mode: VideoPlayerProps['mode']
  controls: PlayerControls
  borderRadius: string
  hasBorder: boolean
  className?: string
  miniStandaloneControls?: React.ReactNode
  autoFocus?: boolean
  children?: React.ReactNode
}) {
  const fullscreen = useVideoPlayerStore((s) => s.fullscreen)

  return (
    <PlayerModeProvider mode={mode ?? 'regular'} controls={controls} isFullscreen={fullscreen}>
      <VideoPlayerInner
        borderRadius={mode === 'mini' || mode === 'mini-standalone' ? '8' : borderRadius}
        hasBorder={hasBorder}
        className={className}
        miniStandaloneControls={miniStandaloneControls}
        autoFocus={autoFocus}
      />
      {children}
    </PlayerModeProvider>
  )
}

// ── Public VideoPlayer ───────────────────────────────────────────

export function VideoPlayer({
  videoId,
  sourceUrl,
  previewThumbnailUrl,
  thumbnailStoryboardUrl,
  children,
  chapters,
  mode = 'regular',
  controls,
  borderRadius = '10',
  hasBorder = true,
  className,
  disableMotion,
  miniStandaloneControls,
  autoFocus,
  lazyLoadVideo = false,
}: VideoPlayerProps) {
  const resolvedControls = useMemo<PlayerControls>(
    () => ({
      toggleMiniPlayer: controls?.toggleMiniPlayer ?? true,
      pictureInPicture: controls?.pictureInPicture ?? true,
    }),
    [controls?.toggleMiniPlayer, controls?.pictureInPicture]
  )

  return (
    <VideoPlayerProvider
      videoId={videoId}
      sourceUrl={sourceUrl}
      previewThumbnailUrl={previewThumbnailUrl}
      thumbnailStoryboardUrl={thumbnailStoryboardUrl}
      lazyLoadVideo={lazyLoadVideo}
      chapters={chapters}>
      <ModeWrapper
        mode={mode}
        controls={resolvedControls}
        borderRadius={borderRadius}
        hasBorder={hasBorder}
        className={className}
        miniStandaloneControls={miniStandaloneControls}
        autoFocus={autoFocus}>
        {children}
      </ModeWrapper>
    </VideoPlayerProvider>
  )
}
