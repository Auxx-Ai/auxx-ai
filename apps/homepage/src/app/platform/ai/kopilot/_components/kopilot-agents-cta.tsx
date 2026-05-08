// apps/homepage/src/app/platform/ai/kopilot/_components/kopilot-agents-cta.tsx
'use client'

import Image from 'next/image'
import Link from 'next/link'
import { type CSSProperties, type MouseEvent, useRef, useState } from 'react'
import { ShaderGradientBg } from '~/app/_components/shader-gradient-bg'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'

interface Character {
  src: string
  alt: string
  /** Tailwind position + size — `left/right`, `bottom`, `w-*`. Excludes any transform. */
  position: string
  /** Baseline vertical offset in % of the image's own height. Negative lifts up. */
  baseY: number
  /** Center character horizontally? */
  centerX?: boolean
  /** Stack order: higher renders in front. */
  z: number
  /** Parallax depth multiplier. 1 = closest (most movement), 0 = locked. */
  depth: number
  /** Subtle scale to fake depth. */
  scale: number
  /** Subtle opacity to fake atmospheric depth. */
  opacity: number
}

const characters: Character[] = [
  {
    src: '/images/ai-headshots/agent-blue-female.png',
    alt: 'Auxx AI agent — blue',
    position: 'left-[3%] bottom-0 w-[26%] sm:w-[23%] md:w-[21%] lg:w-[20%]',
    baseY: 14,
    z: 0,
    depth: 0.35,
    scale: 0.95,
    opacity: 0.94,
  },
  {
    src: '/images/ai-headshots/agent-green-male.png',
    alt: 'Auxx AI agent — green',
    position: 'left-[19%] bottom-0 w-[28%] sm:w-[25%] md:w-[23%] lg:w-[22%]',
    baseY: 6,
    z: 1,
    depth: 0.6,
    scale: 0.99,
    opacity: 1,
  },
  {
    src: '/images/ai-headshots/agent-purple-female-1.png',
    alt: 'Auxx AI agent — purple',
    position: 'left-1/2 bottom-0 w-[36%] sm:w-[32%] md:w-[30%] lg:w-[28%]',
    centerX: true,
    baseY: 6,
    z: 3,
    depth: 1,
    scale: 1,
    opacity: 1,
  },
  {
    src: '/images/ai-headshots/agent-pink-female.png',
    alt: 'Auxx AI agent — pink',
    position: 'right-[19%] bottom-0 w-[28%] sm:w-[25%] md:w-[23%] lg:w-[22%]',
    baseY: 6,
    z: 2,
    depth: 0.6,
    scale: 0.99,
    opacity: 1,
  },
  {
    src: '/images/ai-headshots/agent-orange-male.png',
    alt: 'Auxx AI agent — orange',
    position: 'right-[3%] bottom-0 w-[26%] sm:w-[23%] md:w-[21%] lg:w-[20%]',
    baseY: 14,
    z: 0,
    depth: 0.35,
    scale: 0.95,
    opacity: 0.94,
  },
]

const MAX_PARALLAX_PX = 22
/** Hides transparent padding at the bottom of the headshot PNGs. */
const BOTTOM_TRIM_PX = 10

export default function KopilotAgentsCta() {
  const cardRef = useRef<HTMLDivElement>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  const onMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const nx = (e.clientX - rect.left) / rect.width - 0.5
    const ny = (e.clientY - rect.top) / rect.height - 0.5
    setPointer({ x: nx * 2 * MAX_PARALLAX_PX, y: ny * 2 * MAX_PARALLAX_PX })
  }

  const onMouseLeave = () => setPointer({ x: 0, y: 0 })

  return (
    <section className='relative bg-background border-b border-foreground/10'>
      <div className='mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24'>
        <div
          ref={cardRef}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          data-theme='dark'
          className='relative isolate overflow-hidden rounded-3xl text-white shadow-xl ring-1 ring-foreground/5'>
          <div aria-hidden className='absolute inset-0 -z-10'>
            <ShaderGradientBg
              preset='aurora'
              colors={['#6D28D9', '#EC4899', '#27272A']}
              uniforms={{ timeSpeed: 0.35, saturation: 1.15, contrast: 1.35, grainAmount: 0.12 }}
            />
            <div className='absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.18),transparent_60%)]' />
          </div>

          <div className='relative px-6 pt-16 pb-[48%] text-center sm:pt-20 sm:pb-[44%] md:pt-24 md:pb-[42%] lg:pb-[40%]'>
            <h2 className='mx-auto max-w-3xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl'>
              Try Kopilot
              <br />
              today
            </h2>

            <div className='mt-8 flex items-center justify-center'>
              <Button
                asChild
                size='sm'
                className='bg-white text-zinc-900 hover:bg-white/90 shadow-md'>
                <Link href={config.urls.signup}>Get started</Link>
              </Button>
            </div>
          </div>

          <div aria-hidden className='pointer-events-none absolute inset-x-0 bottom-0 h-[72%]'>
            {characters.map((c) => {
              const tx = pointer.x * c.depth
              const ty = pointer.y * c.depth * 0.4 + BOTTOM_TRIM_PX
              const centerShift = c.centerX ? 'translateX(-50%) ' : ''
              const style: CSSProperties = {
                zIndex: c.z,
                opacity: c.opacity,
                transform: `${centerShift}translate3d(${tx}px, calc(${c.baseY}% + ${ty}px), 0) scale(${c.scale})`,
                transition: 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
                willChange: 'transform',
              }
              return (
                <Image
                  key={c.src}
                  src={c.src}
                  alt={c.alt}
                  width={512}
                  height={640}
                  className={`absolute select-none drop-shadow-[0_24px_30px_rgba(0,0,0,0.18)] ${c.position}`}
                  style={style}
                  priority={false}
                />
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
