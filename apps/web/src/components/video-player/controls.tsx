// apps/web/src/components/video-player/controls.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import {
  ChevronsLeft,
  ChevronsRight,
  Maximize,
  Maximize2,
  Minimize,
  Minimize2,
  Pause,
  PictureInPicture,
  Play,
} from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { PlaybackSpeed } from './playback-speed'
import { usePlayerMode } from './player-mode-context'
import { ProgressBar } from './progress-bar'
import { useVideoPlayerActions, useVideoPlayerStore } from './video-player-context'
import { VolumeControl } from './volume-control'

// ── Icon button helper ───────────────────────────────────────────

interface IconButtonProps {
  onClick: () => void
  ariaLabel: string
  disabled?: boolean
  title?: string
  children: React.ReactNode
}

function IconButton({ onClick, ariaLabel, disabled = false, title, children }: IconButtonProps) {
  const { mode } = usePlayerMode()
  const isRegular = mode === 'regular'

  const button = (
    <button
      type='button'
      onClick={onClick}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn(
        'flex size-7 items-center justify-center rounded-md border-none bg-transparent p-0.5',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
        isRegular ? 'text-white' : 'text-foreground'
      )}>
      {children}
    </button>
  )

  if (!title) return button

  return (
    <Tooltip content={title} delayDuration={400} side='top'>
      {button}
    </Tooltip>
  )
}

// ── Individual control buttons ───────────────────────────────────

function PlayPauseButton() {
  const playing = useVideoPlayerStore((s) => s.playing)
  const { play, pause } = useVideoPlayerActions()

  return (
    <IconButton
      onClick={playing ? pause : play}
      ariaLabel={playing ? 'Pause video' : 'Play video'}
      title={playing ? 'Pause' : 'Play'}>
      {playing ? (
        <Pause size={14} fill='currentColor' stroke='none' />
      ) : (
        <Play size={14} fill='currentColor' stroke='none' />
      )}
    </IconButton>
  )
}

function SkipButtons() {
  const played = useVideoPlayerStore((s) => s.played)
  const { seekForward, seekBackward } = useVideoPlayerActions()

  return (
    <div className='flex gap-1'>
      <IconButton
        onClick={seekBackward}
        ariaLabel='Go back 10 seconds'
        disabled={played === 0}
        title='Skip back 10s'>
        <ChevronsLeft size={14} />
      </IconButton>
      <IconButton onClick={seekForward} ariaLabel='Go forward 10 seconds' title='Skip 10s'>
        <ChevronsRight size={14} />
      </IconButton>
    </div>
  )
}

function MiniPlayerToggle() {
  const { mode, setMode } = usePlayerMode()
  const isMini = mode === 'mini'

  return (
    <IconButton
      onClick={() => setMode((m) => (m === 'mini' ? 'regular' : 'mini'))}
      ariaLabel={isMini ? 'Expand video' : 'Minimize video'}
      title={isMini ? 'Expand video' : 'Minimize video'}>
      {isMini ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
    </IconButton>
  )
}

function PipToggle() {
  const pip = useVideoPlayerStore((s) => s.pip)
  const store = useVideoPlayerStore()

  return (
    <IconButton
      onClick={() => store.getState().setPip(!pip)}
      ariaLabel={pip ? 'Close picture in picture mode' : 'Open picture in picture mode'}
      title={pip ? 'Pop in' : 'Pop out'}>
      {pip ? <Maximize size={14} /> : <PictureInPicture size={14} />}
    </IconButton>
  )
}

function FullscreenToggle() {
  const fullscreen = useVideoPlayerStore((s) => s.fullscreen)
  const { toggleFullscreen } = useVideoPlayerActions()

  return (
    <IconButton onClick={toggleFullscreen} ariaLabel='Toggle full screen' title='Fullscreen'>
      {fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
    </IconButton>
  )
}

// ── Control bar ──────────────────────────────────────────────────

interface ControlBarProps {
  className?: string
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  miniStandaloneControls?: React.ReactNode
}

export function ControlBar({
  className,
  onMouseEnter,
  onMouseLeave,
  miniStandaloneControls,
}: ControlBarProps) {
  const { mode, controls } = usePlayerMode()
  const isRegular = mode === 'regular'

  return (
    <div
      className={cn('flex w-full flex-col gap-0 self-stretch', className)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={
        isRegular
          ? {
              background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.72) 75.35%)',
              padding: '12px 8px 8px',
            }
          : { paddingInline: 12 }
      }>
      <ProgressBar />

      <div className='flex flex-row gap-1 self-stretch justify-between'>
        {/* Left controls */}
        <div className='flex items-center gap-1'>
          <PlayPauseButton />
          <SkipButtons />
          <VolumeControl />
        </div>

        {/* Right controls */}
        <div className='flex items-center gap-1'>
          {isRegular && <PlaybackSpeed />}

          {mode === 'mini-standalone' ? (
            miniStandaloneControls
          ) : (
            <>
              {controls.toggleMiniPlayer && <MiniPlayerToggle />}
              {controls.pictureInPicture && <PipToggle />}
              <FullscreenToggle />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
