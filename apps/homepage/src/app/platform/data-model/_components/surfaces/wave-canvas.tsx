// apps/homepage/src/app/platform/data-model/_components/surfaces/wave-canvas.tsx
'use client'

import { useEffect, useRef } from 'react'

type Props = {
  color: string
  bands?: number
}

export function WaveCanvas({ color, bands = 6 }: Props) {
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
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)
    }

    const noise = (x: number, t: number, seed: number) =>
      Math.sin(x * 0.018 + t * 0.6 + seed) * 0.5 +
      Math.sin(x * 0.034 - t * 0.4 + seed * 1.7) * 0.3 +
      Math.sin(x * 0.07 + t * 0.9 + seed * 2.3) * 0.2

    const draw = (now: number) => {
      if (!mounted) return
      intensity += (target - intensity) * 0.08
      if (intensity < 0.01 && target === 0) {
        const w = canvas.width / dpr
        const h = canvas.height / dpr
        ctx.clearRect(0, 0, w, h)
        raf = 0
        return
      }
      const w = canvas.width / dpr
      const h = canvas.height / dpr
      ctx.clearRect(0, 0, w, h)
      const t = (now - start) / 1000
      ctx.lineWidth = 1.25

      for (let i = 0; i < bands; i++) {
        const baseY = (h / (bands + 1)) * (i + 1)
        const alpha = (0.4 + 0.6 * (i / bands)) * intensity
        ctx.strokeStyle = color.replace('rgb(', 'rgba(').replace(')', `, ${alpha.toFixed(3)})`)
        ctx.beginPath()
        const step = 6
        for (let x = 0; x <= w; x += step) {
          const y = baseY + noise(x, t, i) * 22
          if (x === 0) ctx.moveTo(x, y)
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

    resize()
    const ro = new ResizeObserver(resize)
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
  }, [color, bands])

  return (
    <div
      ref={wrapperRef}
      className='pointer-events-none absolute inset-0 overflow-hidden [mask-image:radial-gradient(circle,#000_0,#000_40%,transparent_70%)]'>
      <canvas ref={canvasRef} className='block size-full' />
    </div>
  )
}
