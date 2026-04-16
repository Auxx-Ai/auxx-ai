// apps/web/src/components/video-player/volume-control.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Volume, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { usePlayerMode } from './player-mode-context'
import { volumeIcon } from './utils'
import { useVideoPlayerStore } from './video-player-context'

export function VolumeControl() {
  const volume = useVideoPlayerStore((s) => (s.muted ? 0 : s.volume))
  const store = useVideoPlayerStore()
  const { mode } = usePlayerMode()
  const [hovered, setHovered] = useState(false)

  const isRegular = mode === 'regular'

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    store.getState().setVolume(Number.parseFloat(e.target.value))
  }

  return (
    <div
      className='flex items-center gap-1'
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      <Tooltip content={volume > 0 ? 'Mute' : 'Unmute'} delayDuration={400} side='top'>
        <button
          type='button'
          onClick={() => store.getState().toggleMuted()}
          aria-label='Toggle mute'
          className={cn(
            'flex size-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-0.5',
            isRegular ? 'text-white' : 'text-foreground'
          )}>
          <VolumeIcon name={volumeIcon(volume)} />
        </button>
      </Tooltip>

      <div
        className={cn(
          'flex items-center overflow-hidden transition-[width] duration-200 ease-out',
          hovered ? 'w-14' : 'w-0'
        )}>
        <input
          type='range'
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={handleVolumeChange}
          aria-label='Volume'
          className='w-full cursor-pointer'
          style={{ accentColor: isRegular ? '#fff' : undefined }}
        />
      </div>
    </div>
  )
}

function VolumeIcon({ name }: { name: string }) {
  const size = 14
  switch (name) {
    case 'SpeakerOff':
      return <VolumeX size={size} />
    case 'SpeakerLow':
      return <Volume size={size} />
    case 'SpeakerMedium':
      return <Volume1 size={size} />
    case 'SpeakerHigh':
      return <Volume2 size={size} />
    default:
      return null
  }
}
