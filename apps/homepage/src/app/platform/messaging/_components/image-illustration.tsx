'use client'
import { Play, X } from 'lucide-react'
import { motion, useScroll, useTransform } from 'motion/react'
import { useState } from 'react'
import { Button } from '~/components/ui/button'

export const ImageIllustration = () => {
  const [showVideo, setShowVideo] = useState(false)
  const { scrollY } = useScroll()
  const parallaxFactor = 0.2
  const y = useTransform(scrollY, [0, 500], [0, 500 * parallaxFactor], { clamp: false })
  const maxScale = 1.5
  const scale = useTransform(scrollY, [0, 500], [1, maxScale], { clamp: true })
  const rotateX = useTransform(scrollY, [0, 500], [12, 0], { clamp: true })

  return (
    <>
      <motion.div
        variants={{
          hidden: {
            opacity: 0,
            filter: 'blur(12px)',
            y: -120,
            rotateX: 56,
            scale: 2,
          },
          visible: {
            opacity: 1,
            filter: 'blur(0px)',
            y: 0,
            scale: 1,
            rotateX: 0,
            transition: {
              type: 'spring',
              bounce: 0.2,
              duration: 2,
            },
          },
        }}
        style={{ y, scale }}
        className='perspective-near mx-auto mt-8 max-w-3xl'>
        <motion.div style={{ rotateX }} className='relative mx-auto max-w-2xl'>
          <div className='group relative'>
            <button
              onClick={() => setShowVideo(true)}
              className='absolute inset-1 z-10 flex items-center justify-center rounded-xl border border-dotted border-white/15'>
              <Button
                size='sm'
                variant='outline'
                asChild
                className='active:scale-99 m-auto w-fit rounded-full bg-white/15 text-white shadow-lg ring-white/25 backdrop-blur transition-all duration-200 before:absolute before:inset-0 hover:-translate-y-1 hover:scale-105 hover:bg-white/20 active:-translate-y-0.5'>
                <div>
                  <Play className='size-3.5!' />
                  Watch demo
                </div>
              </Button>
            </button>
            <div className='ring-background/25 before:inset-ring-4 before:mask-y-from-55% before:z-1 before:inset-ring-white/35 before:border-foreground relative aspect-video overflow-hidden rounded-2xl shadow-2xl shadow-black/40 ring-1 before:absolute before:inset-0 before:rounded-2xl before:border'>
              <img
                src='/images/platform/messaging/channels-list.png'
                alt='Hero Section'
                className='scale-100 size-full object-cover object-center duration-200 group-hover:scale-110'
              />
            </div>
          </div>
        </motion.div>
      </motion.div>

      {showVideo && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm'
          onClick={() => setShowVideo(false)}>
          <div className='relative w-full max-w-4xl mx-4' onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowVideo(false)}
              className='absolute -top-10 right-0 text-white/70 hover:text-white transition-colors'>
              <X className='size-6' />
            </button>
            <video
              autoPlay
              controls
              playsInline
              className='w-full rounded-2xl shadow-2xl'
              src='/videos/hero-video-1.mp4'
            />
          </div>
        </div>
      )}
    </>
  )
}
