// apps/homepage/src/components/tape-mark.tsx

import { cn } from '~/lib/utils'

/** The three apps of the Auxx Builder product. */
export type TapeApp = 'builder' | 'pdf' | 'estimator'

/**
 * Each app's tape ramp, top to bottom, with the app's colour in the middle band. The source is
 * `RAMPS` in the auxx-lift-builder repository (`src/shell/ui/app-switcher.tsx`); keep them equal.
 */
export const TAPE_RAMPS: Record<TapeApp, readonly string[]> = {
  builder: ['#f2c14e', '#2bb3a3', '#3b82f6', '#4338ca', '#2b1f6b'],
  pdf: ['#ecb942', '#ef7a2a', '#fa0f00', '#ab2459', '#6c2460'],
  estimator: ['#f2c14e', '#9cc63b', '#16a34a', '#0f766e', '#134e4a'],
}

/** Each app's own colour: the middle band of its ramp. */
export const TAPE_ACCENT: Record<TapeApp, string> = {
  builder: TAPE_RAMPS.builder[2],
  pdf: TAPE_RAMPS.pdf[2],
  estimator: TAPE_RAMPS.estimator[2],
}

/**
 * The app's mark as in the apps' app bar: a white A on black with the app's ramp sweeping through
 * the lower right corner.
 */
export function TapeMark({ app, className }: { app: TapeApp; className?: string }) {
  return (
    <svg
      viewBox='0 0 100 100'
      aria-hidden
      className={cn('size-6 shrink-0 overflow-hidden rounded-[22%]', className)}>
      <rect width='100' height='100' fill='#161514' />
      <g transform='rotate(-35 50 50)'>
        {TAPE_RAMPS[app].map((color, i) => (
          <rect key={color} x='-40' y={56 + i * 10} width='180' height='10.4' fill={color} />
        ))}
      </g>
      <text
        x='37'
        y='52'
        textAnchor='middle'
        fontSize='48'
        fontWeight='800'
        fill='#fff'
        fontFamily='var(--font-geist-sans), system-ui, sans-serif'>
        A
      </text>
    </svg>
  )
}

/** Five slanted tape bands, like the stripes in the apps' app bar. */
export function TapeStripes({ app = 'builder', className }: { app?: TapeApp; className?: string }) {
  return (
    <span aria-hidden className={cn('inline-flex h-3.5 shrink-0 px-1', className)}>
      {TAPE_RAMPS[app].map((color) => (
        <span key={color} className='w-1.5 -skew-x-[25deg]' style={{ backgroundColor: color }} />
      ))}
    </span>
  )
}

/**
 * Flat tape bands across the full width (or height, `vertical`), one equal band per colour. With
 * several apps, their ramps sit side by side.
 */
export function TapeBand({
  apps = ['builder'],
  vertical = false,
  className,
}: {
  apps?: readonly TapeApp[]
  vertical?: boolean
  className?: string
}) {
  return (
    <div aria-hidden className={cn('flex', vertical ? 'flex-row' : 'flex-col', className)}>
      {[0, 1, 2, 3, 4].map((band) => (
        <div key={band} className={cn('flex flex-1', vertical ? 'flex-col' : 'flex-row')}>
          {apps.map((app) => (
            <div key={app} className='flex-1' style={{ backgroundColor: TAPE_RAMPS[app][band] }} />
          ))}
        </div>
      ))}
    </div>
  )
}
