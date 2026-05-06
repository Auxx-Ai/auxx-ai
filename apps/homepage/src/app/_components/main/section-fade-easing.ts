// apps/homepage/src/app/_components/main/section-fade-easing.ts

/**
 * Multi-stop alpha curve for "natural" section fades.
 *
 * A two-stop linear gradient from opaque → transparent reads as a hard
 * band: alpha changes at a constant rate, but the eye perceives the
 * change non-linearly, so the start and end of the fade look like rims.
 *
 * These stops sample a `smootherstep` curve (Ken Perlin's
 * 6t⁵ − 15t⁴ + 10t³) at 11 points. Smootherstep has zero first AND
 * second derivatives at both endpoints, so the alpha eases imperceptibly
 * out of the surrounding solid colors at both ends. Reads as a soft,
 * natural blend.
 */
const EASE_STOPS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [10, 0.99144],
  [20, 0.94208],
  [30, 0.83692],
  [40, 0.68256],
  [50, 0.5],
  [60, 0.31744],
  [70, 0.16308],
  [80, 0.05792],
  [90, 0.00856],
  [100, 0],
]

export type FadeDirection = 'opaque-to-transparent' | 'transparent-to-opaque'

/**
 * Build a `linear-gradient(to bottom, …)` string with eased alpha stops
 * for a given color. Top fades use `opaque-to-transparent`; bottom fades
 * use `transparent-to-opaque`.
 */
export function easedFadeGradient(color: string, direction: FadeDirection): string {
  const stops = EASE_STOPS.map(([pos, alpha]) => {
    const a = direction === 'opaque-to-transparent' ? alpha : 1 - alpha
    return `rgb(from ${color} r g b / ${a}) ${pos}%`
  })
  return `linear-gradient(to bottom, ${stops.join(', ')})`
}
