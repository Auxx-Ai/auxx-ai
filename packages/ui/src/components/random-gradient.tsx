// packages/ui/src/components/random-gradient.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { type CSSProperties, useEffect, useId, useMemo, useState } from 'react'

export { GRADIENT_PALETTES, type GradientPaletteName } from './gradient-palettes'

export type GradientMode = 'hero' | 'ambient' | 'mesh' | 'openai'

export interface RandomGradientProps {
  colors: string[]
  mode?: GradientMode
  seed?: number
  layers?: number
  animated?: boolean
  blur?: number
  /** Length of one animation cycle in seconds. Lower = faster. Overrides the mode default. */
  animationDuration?: number
  /** Max drift (%) each layer travels during an animation cycle. Higher = more visible motion. Overrides the mode default. */
  driftAmplitude?: number
  className?: string
  style?: CSSProperties
}

/**
 * A layered radial-gradient background.
 *
 * Two generation strategies:
 *  - `hero` / `ambient` / `mesh`: peak placement from a Perlin-noise heightmap.
 *    Half of the layers render as native SVG `<radialGradient>` (with
 *    fx/fy elongation + `gradientTransform` skew CSS can't match); the other
 *    half render as CSS `radial-gradient()` divs that drift via CSS transform
 *    animation. Peak colors are picked from the palette by noise height.
 *  - `openai`: the OpenAI 2020-era look (per Justin Jay Wang / venkr/gradient-gen).
 *    12 full-viewBox rects, each with an asymmetric focal point (fx ~0.1–0.4)
 *    and a scale/skewX/rotate/translate chain applied to the rect itself.
 *    All layers render as SVG (skew can't be represented in CSS radial-gradient)
 *    and the whole SVG gets a saturate(125%) filter. Drift is animated via
 *    SMIL `<animateTransform>` so the skewed rects can still translate.
 */
export function RandomGradient({
  colors,
  mode = 'hero',
  seed,
  layers,
  animated = true,
  blur,
  animationDuration,
  driftAmplitude,
  className,
  style,
}: RandomGradientProps) {
  const idPrefix = useId().replace(/:/g, '')
  const config = MODES[mode]
  const resolvedSeed = seed ?? hashColors(colors)
  const resolvedBlur = blur ?? config.blur
  const resolvedAnimationDuration = animationDuration ?? config.animationDuration
  const resolvedDriftAmplitude = driftAmplitude ?? config.driftAmplitude
  const reducedMotion = usePrefersReducedMotion()
  const shouldAnimate = animated && !reducedMotion

  const allLayers = useMemo(
    () =>
      generateLayers(resolvedSeed, mode, colors, layers, {
        driftAmplitude: resolvedDriftAmplitude,
        animationDuration: resolvedAnimationDuration,
      }),
    [resolvedSeed, mode, colors, layers, resolvedDriftAmplitude, resolvedAnimationDuration]
  )

  // openai mode can't split to CSS (skewX isn't expressible in CSS
  // radial-gradient), so render everything as SVG. Other modes interleave
  // SVG + CSS tiers so both get bright and faint peaks; otherwise all the
  // motion lives on the dimmest layers and looks static.
  const isScatter = mode === 'openai'
  const svgLayers = isScatter ? allLayers : allLayers.filter((_, i) => i % 2 === 0)
  const cssLayers = isScatter ? [] : allLayers.filter((_, i) => i % 2 === 1)

  return (
    <div
      aria-hidden
      className={cn(
        'random-gradient pointer-events-none absolute inset-0 overflow-hidden',
        animated && 'random-gradient--animated',
        className
      )}
      style={
        {
          ...style,
          '--rg-blur': `${resolvedBlur}px`,
          '--rg-duration': `${resolvedAnimationDuration}s`,
          backgroundColor: colors[0],
        } as CSSProperties
      }>
      <svg
        className='random-gradient__svg'
        viewBox='0 0 100 100'
        preserveAspectRatio='none'
        aria-hidden='true'
        style={isScatter ? { filter: 'saturate(125%)' } : undefined}>
        <defs>
          {svgLayers.map((l, i) => {
            const id = `${idPrefix}-${i}`
            if (l.scatter) {
              return (
                <radialGradient key={id} id={id} fx={l.scatter.fx01} fy={0.5}>
                  <stop offset='0%' stopColor={l.color} />
                  <stop offset='100%' stopColor={l.color} stopOpacity={0} />
                </radialGradient>
              )
            }
            return (
              <radialGradient
                key={id}
                id={id}
                gradientUnits='userSpaceOnUse'
                cx={l.cx}
                cy={l.cy}
                fx={l.fx}
                fy={l.fy}
                r={l.r}
                gradientTransform={`rotate(${l.rotation} ${l.cx} ${l.cy}) scale(${l.scaleX} ${l.scaleY})`}>
                <stop offset='0%' stopColor={l.color} stopOpacity={l.opacity} />
                <stop offset='55%' stopColor={l.color} stopOpacity={l.opacity * 0.35} />
                <stop offset='100%' stopColor={l.color} stopOpacity={0} />
              </radialGradient>
            )
          })}
        </defs>
        {svgLayers.map((l, i) => {
          const id = `${idPrefix}-${i}`
          if (l.scatter) {
            const { tx, ty, skewX } = l.scatter
            // Static outer transform (position/scale/skew/rotate), animated
            // inner translate so <animateTransform> can drive only the drift.
            const staticTransform = `translate(50 50) scale(${l.scaleX} ${l.scaleY}) skewX(${skewX}) rotate(${l.rotation})`
            const staticInner = `translate(${tx} ${ty})`
            return (
              <g key={id} transform={staticTransform}>
                <g transform={shouldAnimate ? undefined : staticInner}>
                  {shouldAnimate && (
                    <animateTransform
                      attributeName='transform'
                      attributeType='XML'
                      type='translate'
                      values={`${tx - l.driftX} ${ty - l.driftY}; ${tx + l.driftX} ${ty + l.driftY}; ${tx - l.driftX} ${ty - l.driftY}`}
                      dur={`${resolvedAnimationDuration}s`}
                      begin={`${l.delay}s`}
                      repeatCount='indefinite'
                      calcMode='spline'
                      keySplines='0.42 0 0.58 1; 0.42 0 0.58 1'
                      keyTimes='0; 0.5; 1'
                    />
                  )}
                  <rect
                    width='100'
                    height='100'
                    fill={`url(#${id})`}
                    transform='translate(-50 -50)'
                    style={{ mixBlendMode: config.blendMode }}
                  />
                </g>
              </g>
            )
          }
          return (
            <rect
              key={id}
              width='100'
              height='100'
              fill={`url(#${id})`}
              style={{ mixBlendMode: config.blendMode }}
            />
          )
        })}
      </svg>

      {cssLayers.map((l, i) => {
        const w = l.r * l.scaleX
        const h = l.r * l.scaleY
        const bg =
          `radial-gradient(ellipse ${w}% ${h}% at ${l.fx}% ${l.fy}%, ` +
          `${rgba(l.color, l.opacity)} 0%, ` +
          `${rgba(l.color, l.opacity * 0.35)} 55%, ` +
          `${rgba(l.color, 0)} 100%)`
        return (
          <div
            key={`css-${idPrefix}-${i}`}
            className='random-gradient__css-layer'
            style={
              {
                backgroundImage: bg,
                mixBlendMode: config.blendMode,
                '--rg-drift-x': `${l.driftX}%`,
                '--rg-drift-y': `${l.driftY}%`,
                '--rg-rotate': `${l.rotation}deg`,
                animationDelay: `${l.delay}s`,
              } as CSSProperties
            }
          />
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mode presets
// ---------------------------------------------------------------------------

interface ModeConfig {
  layers: number
  radiusRange: [number, number]
  opacityRange: [number, number]
  minPeakDistance: number
  elongation: number
  rotationDeg: number
  scaleRange: [number, number]
  blendMode: CSSProperties['mixBlendMode']
  blur: number
  driftAmplitude: number
  animationDuration: number
  /** How far beyond the [0,1] viewBox peaks may be placed so gradients bleed into the corners. */
  placementOverflow: number
}

const MODES: Record<GradientMode, ModeConfig> = {
  hero: {
    layers: 9,
    radiusRange: [50, 95],
    opacityRange: [0.4, 0.85],
    minPeakDistance: 0.14,
    elongation: 0.15,
    rotationDeg: 45,
    scaleRange: [0.75, 1.6],
    blendMode: 'screen',
    blur: 40,
    driftAmplitude: 18,
    animationDuration: 8,
    placementOverflow: 0.2,
  },
  ambient: {
    layers: 5,
    radiusRange: [65, 110],
    opacityRange: [0.2, 0.45],
    minPeakDistance: 0.22,
    elongation: 0.1,
    rotationDeg: 25,
    scaleRange: [1, 1.4],
    blendMode: 'normal',
    blur: 70,
    driftAmplitude: 4,
    animationDuration: 22,
    placementOverflow: 0.25,
  },
  mesh: {
    layers: 22,
    radiusRange: [22, 48],
    opacityRange: [0.55, 0.95],
    minPeakDistance: 0.07,
    elongation: 0.05,
    rotationDeg: 20,
    scaleRange: [0.9, 1.3],
    blendMode: 'screen',
    blur: 18,
    driftAmplitude: 4,
    animationDuration: 9,
    placementOverflow: 0.22,
  },
  // OpenAI 2020-era look: 12 rects, each with an asymmetric radial-gradient
  // focal point, scattered across the viewBox via a scale/skew/rotate/translate
  // chain on the rect itself. Most of the ModeConfig fields don't apply here —
  // see generateScatterLayers for the actual parameters used.
  openai: {
    layers: 12,
    radiusRange: [0, 0],
    opacityRange: [1, 1],
    minPeakDistance: 0,
    elongation: 0,
    rotationDeg: 360,
    scaleRange: [0.7, 1.5],
    blendMode: 'normal',
    blur: 0,
    driftAmplitude: 7,
    animationDuration: 18,
    placementOverflow: 0,
  },
}

// ---------------------------------------------------------------------------
// Layer generation (noise field → peaks → layer configs)
// ---------------------------------------------------------------------------

interface Layer {
  cx: number
  cy: number
  fx: number
  fy: number
  r: number
  rotation: number
  scaleX: number
  scaleY: number
  opacity: number
  color: string
  driftX: number
  driftY: number
  delay: number
  /** Present for openai-mode layers. Routes the layer through a different render path: the gradient uses objectBoundingBox fx/fy, and scale/skew/rotate/translate are applied to the rect. */
  scatter?: {
    fx01: number
    skewX: number
    tx: number
    ty: number
  }
}

function generateLayers(
  seed: number,
  mode: GradientMode,
  colors: string[],
  layerOverride?: number,
  overrides?: { driftAmplitude?: number; animationDuration?: number }
): Layer[] {
  if (mode === 'openai') {
    return generateScatterLayers(seed, colors, layerOverride, {
      driftAmplitude: overrides?.driftAmplitude ?? MODES.openai.driftAmplitude,
      animationDuration: overrides?.animationDuration ?? MODES.openai.animationDuration,
    })
  }

  const config = MODES[mode]
  const count = layerOverride ?? config.layers
  const drift = overrides?.driftAmplitude ?? config.driftAmplitude
  const duration = overrides?.animationDuration ?? config.animationDuration
  const random = mulberry32(seed || 1)
  const noise = createPerlin(random)
  const field = buildField(noise, 48, 3, 0.08)

  const peaks = findPeaks(field, config.minPeakDistance, count)
  while (peaks.length < count) {
    peaks.push({ x: random(), y: random(), height: random() * 0.5 })
  }

  // Treat colors[0] as the background only; peaks draw from colors[1..] so a
  // dark base palette doesn't produce invisible "dark peaks on dark bg".
  const peakPalette = colors.length > 1 ? colors.slice(1) : colors

  return peaks.slice(0, count).map((peak, i) => {
    const weight = 1 - i / count
    const radius = lerp(config.radiusRange[0], config.radiusRange[1], random() * 0.6 + weight * 0.4)
    const opacity = lerp(
      config.opacityRange[0],
      config.opacityRange[1],
      weight * 0.7 + random() * 0.3
    )
    const rotation = (random() - 0.5) * 2 * config.rotationDeg
    const scaleX = lerp(config.scaleRange[0], config.scaleRange[1], random())
    const scaleY = lerp(config.scaleRange[0], config.scaleRange[1], random())
    const focalAngle = random() * Math.PI * 2
    const focalDist = random() * config.elongation
    const heightNorm = (peak.height + 1) / 2
    const colorIdx = Math.min(peakPalette.length - 1, Math.floor(heightNorm * peakPalette.length))
    const color = peakPalette[colorIdx] ?? peakPalette[0] ?? '#000000'

    const ov = config.placementOverflow
    const px = peak.x * (1 + 2 * ov) - ov
    const py = peak.y * (1 + 2 * ov) - ov

    return {
      cx: px * 100,
      cy: py * 100,
      fx: (px + Math.cos(focalAngle) * focalDist) * 100,
      fy: (py + Math.sin(focalAngle) * focalDist) * 100,
      r: radius,
      rotation,
      scaleX,
      scaleY,
      opacity,
      color,
      driftX: (random() - 0.5) * 2 * drift,
      driftY: (random() - 0.5) * 2 * drift,
      delay: -random() * duration,
    }
  })
}

// Matches the venkr/gradient-gen ellipse parameters (after Justin Jay Wang's
// OpenAI-era method): random scatter, no peak detection. Translations scale
// from the original ±250 on a 600 viewBox down to ±42 on our 100 viewBox.
function generateScatterLayers(
  seed: number,
  colors: string[],
  layerOverride?: number,
  opts?: { driftAmplitude: number; animationDuration: number }
): Layer[] {
  const count = layerOverride ?? MODES.openai.layers
  const drift = opts?.driftAmplitude ?? MODES.openai.driftAmplitude
  const duration = opts?.animationDuration ?? MODES.openai.animationDuration
  const random = mulberry32(seed || 1)
  const palette = colors.length > 1 ? colors.slice(1) : colors
  return Array.from({ length: count }, () => {
    const color = palette[Math.floor(random() * palette.length)] ?? palette[0] ?? '#000000'
    return {
      cx: 50,
      cy: 50,
      fx: 50,
      fy: 50,
      r: 100,
      rotation: random() * 360,
      scaleX: 0.7 + random() * 0.8,
      scaleY: 0.7 + random() * 0.8,
      opacity: 1,
      color,
      driftX: (random() - 0.5) * 2 * drift,
      driftY: (random() - 0.5) * 2 * drift,
      delay: -random() * duration,
      scatter: {
        fx01: 0.1 + random() * 0.3,
        skewX: -10 + random() * 20,
        tx: -42 + random() * 84,
        ty: -42 + random() * 84,
      },
    }
  })
}

// ---------------------------------------------------------------------------
// Perlin noise + mulberry32 PRNG + peak finding
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function createPerlin(random: () => number) {
  const perm: number[] = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const tmp = perm[i]!
    perm[i] = perm[j]!
    perm[j] = tmp
  }
  const p = new Uint8Array(512)
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255]!

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  const lrp = (a: number, b: number, t: number) => a + t * (b - a)
  const grad = (hash: number, x: number, y: number) => {
    const h = hash & 3
    const u = h < 2 ? x : y
    const v = h < 2 ? y : x
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
  }

  return (x: number, y: number): number => {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const u = fade(xf)
    const v = fade(yf)
    const A = (p[X] ?? 0) + Y
    const B = (p[X + 1] ?? 0) + Y
    return lrp(
      lrp(grad(p[A] ?? 0, xf, yf), grad(p[B] ?? 0, xf - 1, yf), u),
      lrp(grad(p[A + 1] ?? 0, xf, yf - 1), grad(p[B + 1] ?? 0, xf - 1, yf - 1), u),
      v
    )
  }
}

function buildField(
  noise: (x: number, y: number) => number,
  resolution: number,
  octaves: number,
  baseScale: number
): number[][] {
  const field: number[][] = []
  for (let y = 0; y < resolution; y++) {
    const row: number[] = []
    for (let x = 0; x < resolution; x++) {
      let v = 0
      let amp = 1
      let freq = baseScale
      let max = 0
      for (let o = 0; o < octaves; o++) {
        v += noise(x * freq, y * freq) * amp
        max += amp
        amp *= 0.5
        freq *= 2
      }
      row.push(v / max)
    }
    field.push(row)
  }
  return field
}

interface Peak {
  x: number
  y: number
  height: number
}

function findPeaks(field: number[][], minDistance: number, limit: number): Peak[] {
  const res = field.length
  const candidates: Peak[] = []
  for (let y = 1; y < res - 1; y++) {
    const row = field[y]!
    const above = field[y - 1]!
    const below = field[y + 1]!
    for (let x = 1; x < res - 1; x++) {
      const v = row[x]!
      if (v > above[x]! && v > below[x]! && v > row[x - 1]! && v > row[x + 1]!) {
        candidates.push({ x: x / (res - 1), y: y / (res - 1), height: v })
      }
    }
  }
  candidates.sort((a, b) => b.height - a.height)
  const kept: Peak[] = []
  for (const peak of candidates) {
    let ok = true
    for (const k of kept) {
      if (Math.hypot(k.x - peak.x, k.y - peak.y) < minDistance) {
        ok = false
        break
      }
    }
    if (ok) {
      kept.push(peak)
      if (kept.length >= limit) break
    }
  }
  return kept
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function hashColors(colors: string[]): number {
  let h = 2166136261
  for (const c of colors) {
    for (let i = 0; i < c.length; i++) {
      h = Math.imul(h ^ c.charCodeAt(i), 16777619)
    }
  }
  return Math.abs(h | 0)
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}

function rgba(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const h = color.slice(1)
    let r = 0
    let g = 0
    let b = 0
    if (h.length === 3 || h.length === 4) {
      r = Number.parseInt(h[0]! + h[0]!, 16)
      g = Number.parseInt(h[1]! + h[1]!, 16)
      b = Number.parseInt(h[2]! + h[2]!, 16)
    } else if (h.length === 6 || h.length === 8) {
      r = Number.parseInt(h.slice(0, 2), 16)
      g = Number.parseInt(h.slice(2, 4), 16)
      b = Number.parseInt(h.slice(4, 6), 16)
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return `color-mix(in oklab, ${color} ${alpha * 100}%, transparent)`
}
