// apps/homepage/src/app/_components/main/section-bottom-fade.tsx
import { cn } from '~/lib/utils'
import { easedFadeGradient } from './section-fade-easing'

interface SectionBottomFadeProps {
  /**
   * CSS color of the section directly below this one. Used as the bottom
   * of the fade — the top transitions from the same color at zero alpha
   * so interpolation stays clean.
   */
  toColor: string
  /** Height of the fade band. Default `6rem`. */
  height?: string
  className?: string
}

/**
 * Bottom-edge color fade for sections that sit above a flat-color section.
 *
 * Mirrors `SectionTopFade`: mounts inside the gradient-owning section and
 * renders an absolutely-positioned band at the bottom edge that fades
 * from transparent at the top of the band into the next section's color
 * at the bottom. Sits above content (`z-20`) so any `border-x` rules and
 * `bg-*` tints that extend to the section's bottom edge fade together
 * with the gradient.
 *
 * Constraint: keep `height` smaller than the parent section's bottom
 * padding so the band never overpaints actual content.
 */
export function SectionBottomFade({ toColor, height = '6rem', className }: SectionBottomFadeProps) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-x-0 bottom-0 z-20', className)}
      style={{
        height,
        background: easedFadeGradient(toColor, 'transparent-to-opaque'),
      }}
    />
  )
}
