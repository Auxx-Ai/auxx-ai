// apps/homepage/src/app/_components/sections/hero-illustration.tsx
'use client'

import { Play, Volume2, VolumeX } from 'lucide-react'
import { AnimatePresence, motion, useMotionValue } from 'motion/react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AutoplayVideo } from '~/components/autoplay-video'
import { videoUrl } from '~/lib/cdn'
import { HeroVideoModal } from './hero-video-modal'

export const HeroIllustration = () => {
  const [muted, setMuted] = useState(true)
  const [open, setOpen] = useState(false)
  const [hovering, setHovering] = useState(false)
  const x = useMotionValue(0)
  const y = useMotionValue(0)

  return (
    <>
      <div className='@container perspective-dramatic pb-20 lg:pb-32'>
        <div className='rotate-x-[0.125deg] before:z-1 before:bg-linear-to-b relative mx-auto max-w-6xl px-3 before:absolute before:inset-0 before:inset-x-4 before:top-0 before:rounded-2xl before:from-blue-950 before:opacity-20 before:mix-blend-color lg:px-12 lg:before:inset-x-12'>
          <div className='bg-linear-to-b from-foreground rotate-66 absolute inset-0 z-10 mx-auto w-8 -translate-y-44 rounded-full opacity-5 blur-xl' />
          <div className='bg-linear-to-b from-foreground rotate-66 absolute inset-0 z-10 mx-auto w-16 -translate-y-32 translate-x-44 rounded-full opacity-20 blur-2xl' />
          <div className='bg-foreground/5 border-foreground/5 group relative rounded-[15px] border p-0.5'>
            <div className='bg-background aspect-video ring-foreground/10 relative w-full origin-top overflow-hidden rounded-xl p-1 shadow ring-1'>
              <AutoplayVideo
                autoPlay
                loop
                muted={muted}
                className='pointer-events-none size-full rounded-lg object-cover'
                src={videoUrl('hero-16x9-loop.mp4')}
              />
            </div>

            {/* Click target — covers the whole frame and opens the modal */}
            <button
              type='button'
              onClick={() => setOpen(true)}
              onMouseMove={(e) => {
                x.set(e.clientX)
                y.set(e.clientY)
              }}
              onMouseEnter={(e) => {
                x.set(e.clientX)
                y.set(e.clientY)
                setHovering(true)
              }}
              onMouseLeave={() => setHovering(false)}
              aria-label='Play full video'
              className='absolute inset-0 z-10 cursor-pointer rounded-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'
            />

            {/* Mute toggle — z above the click target so it intercepts clicks first */}
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation()
                setMuted((m) => !m)
              }}
              aria-label={muted ? 'Unmute video' : 'Mute video'}
              aria-pressed={!muted}
              className='absolute bottom-4 right-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/15 backdrop-blur-md transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60'>
              {muted ? <VolumeX className='h-4 w-4' /> : <Volume2 className='h-4 w-4' />}
            </button>
          </div>
        </div>
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {hovering && (
              <motion.div
                className='pointer-events-none fixed z-40 -translate-x-[18px] -translate-y-1/2'
                style={{ top: y, left: x }}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.15 }}>
                <div className='flex items-center gap-1.5 rounded-full bg-black/85 px-3 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-white/15 backdrop-blur-md'>
                  <Play className='h-3 w-3 fill-white' />
                  Play video
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}

      {open && (
        <HeroVideoModal open={open} onOpenChange={setOpen} src={videoUrl('hero-16x9-full.mp4')} />
      )}
    </>
  )
}
