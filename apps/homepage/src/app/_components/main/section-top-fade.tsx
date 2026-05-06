// apps/homepage/src/app/_components/main/section-top-fade.tsx
import { cn } from '~/lib/utils'
import { easedFadeGradient } from './section-fade-easing'

interface SectionTopFadeProps {
  /**
   * CSS color of the section directly above this one. Should be a value
   * with a defined RGB triple (e.g. `var(--color-muted)`, `oklch(...)`,
   * a hex). Used as the top of the fade — the bottom transitions to the
   * same color at zero alpha so interpolation stays clean.
   */
  fromColor: string
  /** Height of the fade band. Default `6rem`. */
  height?: string
  className?: string
}

/**
 * Top-edge color fade for sections that sit beneath a flat-color section.
 *
 * Mounts inside the gradient-owning section and renders an absolutely-
 * positioned band at the top edge that fades from the previous section's
 * color to transparent. Sits above content (`z-20`) so it masks any
 * `border-x` rules and `bg-*` tints that extend to the section's top
 * edge — gradient, tints, and borders all fade together.
 *
 * Constraint: keep `height` smaller than the parent section's top
 * padding so the band never overpaints actual content.
 */
export function SectionTopFade({ fromColor, height = '6rem', className }: SectionTopFadeProps) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-x-0 top-0 z-20', className)}
      style={{
        height,
        background: easedFadeGradient(fromColor, 'opaque-to-transparent'),
      }}
    />
  )
}
