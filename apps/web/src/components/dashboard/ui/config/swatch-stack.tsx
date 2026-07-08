// apps/web/src/components/dashboard/ui/config/swatch-stack.tsx
'use client'

// A little avatar-stack of overlapping color circles — the visual preview for a
// chart palette scheme (plan 12), mirroring Twenty's "Colors" picker. Each circle
// carries a subtle ring so the overlaps read; later circles sit on top. Colors are
// any CSS color string (we pass `var(--<hue>-N)` refs, so the stack tracks theme).

import { cn } from '@auxx/ui/lib/utils'

export function SwatchStack({
  colors,
  size = 16,
  className,
}: {
  colors: string[]
  /** Circle diameter in px. */
  size?: number
  className?: string
}) {
  // Overlap by ~40% of the diameter.
  const overlap = Math.round(size * 0.4)
  return (
    <div className={cn('flex items-center', className)}>
      {colors.map((color, i) => (
        <span
          // Palette swatches are a fixed ordered ramp — index key is stable + correct.
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-order color list
          key={i}
          className='shrink-0 rounded-full ring-1 ring-background'
          style={{
            width: size,
            height: size,
            backgroundColor: color,
            marginLeft: i === 0 ? 0 : -overlap,
            zIndex: i,
          }}
        />
      ))}
    </div>
  )
}
