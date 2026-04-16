// apps/web/src/components/video-player/playback-speed.tsx
'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown as ChevronDownIcon } from 'lucide-react'
import { usePlayerMode } from './player-mode-context'
import { useVideoPlayerActions, useVideoPlayerStore } from './video-player-context'

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const

export function PlaybackSpeed() {
  const playbackRate = useVideoPlayerStore((s) => s.playbackRate)
  const { setPlaybackRate } = useVideoPlayerActions()
  const { mode } = usePlayerMode()

  const isRegular = mode === 'regular'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          aria-label='Change playback speed'
          className={cn(
            'flex cursor-pointer items-center gap-0.5 rounded-md border-none bg-transparent px-1 py-0.5 text-xs font-medium outline-none',
            isRegular ? 'text-white' : 'text-foreground'
          )}>
          {playbackRate}x
          <ChevronDownIcon size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side='top' align='end' className='w-[140px]'>
        {RATES.map((rate) => (
          <DropdownMenuItem
            key={rate}
            selected={playbackRate === rate}
            onSelect={() => setPlaybackRate(rate)}>
            {rate === 1 ? 'Normal' : `${rate}x`}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
