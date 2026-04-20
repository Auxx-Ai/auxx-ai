// packages/ui/src/components/random-gradient.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { type CSSProperties, useEffect, useId, useMemo, useState } from 'react'
import { type GradientMode, generateLayers, hashColors, MODES, rgba } from './gradient-layers'

export type { GradientMode } from './gradient-layers'
export { GRADIENT_PALETTES, type GradientPaletteName } from './gradient-palettes'

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
 *  - `openai`: the OpenAI 2020-era look. 12 full-viewBox rects, each with an
 *    asymmetric focal point (fx ~0.1–0.4) and a scale/skewX/rotate/translate
 *    chain applied to the rect itself. All layers render as SVG (skew can't be
 *    represented in CSS radial-gradient) and the whole SVG gets a
 *    saturate(125%) filter. Drift is animated via SMIL `<animateTransform>` so
 *    the skewed rects can still translate.
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
