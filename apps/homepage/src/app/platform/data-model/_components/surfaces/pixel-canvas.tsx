// apps/homepage/src/app/platform/data-model/_components/surfaces/pixel-canvas.tsx
'use client'

import { useEffect, useRef } from 'react'

type Props = {
  color: string
  gap?: number
  pixelSize?: number
}

type Pixel = {
  x: number
  y: number
  size: number
  maxSize: number
  delay: number
  state: 'idle' | 'appear' | 'shimmer' | 'disappear'
  phase: number
  startedAt?: number
}

export function PixelCanvas({ color, gap = 5, pixelSize = 2 }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const wrapper = wrapperRef.current
    const canvas = canvasRef.current
    if (!wrapper || !canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = window.devicePixelRatio || 1
    let pixels: Pixel[] = []
    let raf = 0
    let mounted = true
    const max = pixelSize + gap

    const build = () => {
      const rect = wrapper.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)

      pixels = []
      const cx = rect.width / 2
      const cy = rect.height / 2
      const maxDist = Math.hypot(cx, cy)
      for (let y = pixelSize; y < rect.height; y += pixelSize + gap) {
        for (let x = pixelSize; x < rect.width; x += pixelSize + gap) {
          const dist = Math.hypot(x - cx, y - cy) / maxDist
          pixels.push({
            x,
            y,
            size: 0,
            maxSize: max,
            delay: dist * 600,
            state: 'idle',
            phase: Math.random() * Math.PI * 2,
          })
        }
      }
    }

    const drawFrame = (now: number) => {
      if (!mounted) return
      const rect = wrapper.getBoundingClientRect()
      ctx.clearRect(0, 0, rect.width, rect.height)
      let active = false
      for (const p of pixels) {
        if (p.state === 'appear') {
          if (now > p.startedAt! + p.delay) {
            p.size = Math.min(p.maxSize, p.size + 0.2)
            if (p.size >= p.maxSize) {
              p.state = 'shimmer'
              p.startedAt = now
            }
          }
          active = true
        } else if (p.state === 'shimmer') {
          const t = (now - (p.startedAt ?? now)) / 1000
          p.size = p.maxSize * (0.7 + 0.3 * Math.sin(t * 4 + p.phase))
          active = true
        } else if (p.state === 'disappear') {
          p.size = Math.max(0, p.size - 0.25)
          if (p.size <= 0) p.state = 'idle'
          else active = true
        }
        if (p.size > 0) {
          ctx.fillStyle = color
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
        }
      }
      if (active) raf = requestAnimationFrame(drawFrame)
      else raf = 0
    }

    const onEnter = () => {
      if (reduced) return
      const now = performance.now()
      for (const p of pixels) {
        p.state = 'appear'
        p.startedAt = now
      }
      if (!raf) raf = requestAnimationFrame(drawFrame)
    }
    const onLeave = () => {
      for (const p of pixels) p.state = p.size > 0 ? 'disappear' : 'idle'
      if (!raf) raf = requestAnimationFrame(drawFrame)
    }

    build()
    const ro = new ResizeObserver(build)
    ro.observe(wrapper)
    const card = wrapper.closest('.group\\/card') as HTMLElement | null
    const targetEl = card ?? wrapper
    targetEl.addEventListener('mouseenter', onEnter)
    targetEl.addEventListener('mouseleave', onLeave)

    return () => {
      mounted = false
      targetEl.removeEventListener('mouseenter', onEnter)
      targetEl.removeEventListener('mouseleave', onLeave)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [color, gap, pixelSize])

  return (
    <div
      ref={wrapperRef}
      className='pointer-events-none absolute inset-0 overflow-hidden [mask-image:radial-gradient(circle,#000_0,#000_40%,transparent_70%)]'>
      <canvas ref={canvasRef} className='block size-full' />
    </div>
  )
}
