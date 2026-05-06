// apps/homepage/src/app/platform/data-model/_components/surfaces/ripple-canvas.tsx
'use client'

import { useEffect, useRef } from 'react'

type Props = {
  color: string
  count?: number
}

export function RippleCanvas({ color, count = 5 }: Props) {
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
    let intensity = 0
    let target = 0
    let raf = 0
    let start = performance.now()
    let mounted = true

    const resize = () => {
      const rect = wrapper.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      ctx.scale(dpr, dpr)
    }

    const draw = (now: number) => {
      if (!mounted) return
      intensity += (target - intensity) * 0.08
      if (intensity < 0.01 && target === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        raf = 0
        return
      }
      const w = canvas.width / dpr
      const h = canvas.height / dpr
      ctx.clearRect(0, 0, w, h)
      const cx = w / 2
      const cy = h / 2
      const max = Math.max(w, h) * 0.55
      const t = (now - start) / 1000
      ctx.lineWidth = 1.25

      for (let i = 0; i < count; i++) {
        const offset = (t * 0.35 + i / count) % 1
        const radius = 10 + offset * (max - 10)
        const ease = Math.min(4 * offset, 1) * (1 - offset * offset)
        const alpha = ease * intensity
        if (alpha <= 0) continue

        ctx.strokeStyle = color.replace('rgb(', 'rgba(').replace(')', `, ${alpha.toFixed(3)})`)
        ctx.beginPath()
        const steps = 60
        for (let s = 0; s <= steps; s++) {
          const a = (s / steps) * Math.PI * 2
          const wob =
            Math.sin(a * 3 + t * 0.8 + i) * 1.5 +
            Math.sin(a * 5 - t * 1.2 + i * 0.7) * 1 +
            Math.sin(a * 2 + t * 0.4) * 0.6
          const r = radius + wob
          const x = cx + Math.cos(a) * r
          const y = cy + Math.sin(a) * r
          if (s === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      raf = requestAnimationFrame(draw)
    }

    const onEnter = () => {
      if (reduced) return
      target = 1
      if (!raf) {
        start = performance.now()
        raf = requestAnimationFrame(draw)
      }
    }
    const onLeave = () => {
      target = 0
      if (!raf) raf = requestAnimationFrame(draw)
    }

    const card = wrapper.closest('.group\\/card') as HTMLElement | null
    const target_ = card ?? wrapper
    target_.addEventListener('mouseenter', onEnter)
    target_.addEventListener('mouseleave', onLeave)
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrapper)

    return () => {
      mounted = false
      target_.removeEventListener('mouseenter', onEnter)
      target_.removeEventListener('mouseleave', onLeave)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [color, count])

  return (
    <div
      ref={wrapperRef}
      className='pointer-events-none absolute inset-0 overflow-hidden [mask-image:radial-gradient(circle,#000_0,#000_40%,transparent_70%)]'>
      <canvas ref={canvasRef} className='block size-full' />
    </div>
  )
}
