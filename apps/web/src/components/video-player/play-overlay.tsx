// apps/web/src/components/video-player/play-overlay.tsx
'use client'

import { Play } from 'lucide-react'
import { useVideoPlayerActions, useVideoPlayerStore } from './video-player-context'

export function PlayOverlay() {
  const playing = useVideoPlayerStore((s) => s.playing)
  const { play, pause } = useVideoPlayerActions()

  return (
    <button
      type='button'
      onClick={playing ? pause : play}
      aria-label={playing ? 'Pause video' : 'Play video'}
      className='absolute top-0 right-0 bottom-[76px] left-0 flex cursor-pointer items-center justify-center border-none bg-transparent'>
      {!playing && (
        <div className='flex size-16 items-center justify-center rounded-full bg-white/20 shadow-[0px_16px_56px_-12px_rgba(28,40,64,0.12),0px_36px_176px_-8px_rgba(28,40,64,0.14)] backdrop-blur-sm'>
          <div className='flex size-[52px] items-center justify-center rounded-full bg-white'>
            <Play size={24} fill='#000' stroke='none' />
          </div>
        </div>
      )}
    </button>
  )
}
