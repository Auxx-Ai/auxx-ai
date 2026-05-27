// packages/chat/src/theme/hex-to-oklch-hue.ts
//
// Extract the OKLCH hue (degrees, 0–360) from a CSS hex color so the widget
// can derive a brand-tinted neutral surface from `--auxx-chat-primary`.
//
// sRGB → linear → OKLab → atan2(b, a) → degrees. Pure function. Returns the
// default cool-blue hue (250) on parse failure so a malformed config can
// never crash the render.

const DEFAULT_HUE = 250

export function hexToOklchHue(hex: string | null | undefined): number {
  if (!hex) return DEFAULT_HUE
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return DEFAULT_HUE
  let h = match[1]!
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255

  // sRGB → linear-light sRGB
  const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lr = toLin(r)
  const lg = toLin(g)
  const lb = toLin(b)

  // Linear sRGB → LMS (Björn Ottosson's OKLab matrix)
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb

  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)

  // LMS → OKLab
  const labA = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const labB = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_

  // OKLab → OKLCH hue (degrees). For near-greys (tiny chroma) hue is unstable
  // and meaningless — fall back to the default rather than letting noise drive
  // the tint.
  const chroma = Math.sqrt(labA * labA + labB * labB)
  if (chroma < 0.0005) return DEFAULT_HUE

  const deg = (Math.atan2(labB, labA) * 180) / Math.PI
  return deg < 0 ? deg + 360 : deg
}
