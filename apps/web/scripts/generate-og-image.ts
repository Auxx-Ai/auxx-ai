// apps/web/scripts/generate-og-image.ts
// Generate the static Open Graph PNG for the web and homepage apps.
// Builds an SVG (mesh gradient background + logo + tagline) and rasterizes it
// via sharp. Output goes to apps/web/src/app/opengraph-image.png and
// apps/homepage/src/app/opengraph-image.png so Next.js serves it at /opengraph-image.png.
//
// Run: pnpm --filter @auxx/web og:generate
// Tweak CONFIG below and re-run to re-skin.

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type GradientMode, generateLayers, MODES } from '@auxx/ui/components/gradient-layers'
import {
  GRADIENT_PALETTE_MODES,
  GRADIENT_PALETTES,
  type GradientPaletteName,
} from '@auxx/ui/components/gradient-palettes'
import sharp from 'sharp'

const OG_WIDTH = 1200
const OG_HEIGHT = 630

/** Edit these and re-run to change the generated image. */
const CONFIG: {
  palette: GradientPaletteName
  mode: GradientMode
  seed: number
  layers?: number
  name: string
  tagline: string
} = {
  palette: 'ocean',
  mode: 'mesh',
  seed: 42,
  layers: 18,
  name: 'Auxx.ai',
  tagline: 'Connect AI with your small business',
}

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const OUTPUTS = [
  resolve(__dirname, '../src/app/opengraph-image.png'),
  resolve(__dirname, '../../homepage/src/app/opengraph-image.png'),
]

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildGradientSvg(): string {
  const palette = [...GRADIENT_PALETTES[CONFIG.palette]]
  const layers = generateLayers(CONFIG.seed, CONFIG.mode, palette, CONFIG.layers)
  const modeConfig = MODES[CONFIG.mode]
  const bg = palette[0] ?? '#000000'

  const defs: string[] = []
  const rects: string[] = []
  layers.forEach((l, i) => {
    const id = `g${i}`
    defs.push(
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${l.cx.toFixed(4)}" cy="${l.cy.toFixed(4)}" fx="${l.fx.toFixed(4)}" fy="${l.fy.toFixed(4)}" r="${l.r.toFixed(4)}" gradientTransform="rotate(${l.rotation.toFixed(4)} ${l.cx.toFixed(4)} ${l.cy.toFixed(4)}) scale(${l.scaleX.toFixed(4)} ${l.scaleY.toFixed(4)})">` +
        `<stop offset="0%" stop-color="${l.color}" stop-opacity="${l.opacity.toFixed(4)}"/>` +
        `<stop offset="55%" stop-color="${l.color}" stop-opacity="${(l.opacity * 0.35).toFixed(4)}"/>` +
        `<stop offset="100%" stop-color="${l.color}" stop-opacity="0"/>` +
        `</radialGradient>`
    )
    rects.push(
      `<rect width="100" height="100" fill="url(#${id})" style="mix-blend-mode:${modeConfig.blendMode ?? 'normal'}"/>`
    )
  })

  // Nested SVG remaps the 0..100 viewBox onto the 1200x630 output area.
  return `<svg x="0" y="0" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 100 100" preserveAspectRatio="none">
  <rect width="100" height="100" fill="${bg}"/>
  <defs>${defs.join('')}</defs>
  ${rects.join('\n  ')}
</svg>`
}

function buildLogoSvg(cx: number, cy: number, size: number): string {
  const scale = size / 68
  const x = cx - size / 2
  const y = cy - size / 2
  return `<g transform="translate(${x}, ${y}) scale(${scale})">
    <circle fill="#69b3fe" cx="34" cy="33.5" r="34"/>
    <path fill="#fff" d="M7.74,39.14c-.69,0-1.39-.24-1.95-.72-1.37-1.17-1.29-3.34-.02-4.62L31.78,7.59c1.19-1.2,3.13-1.2,4.32,0l26.06,26.25c1.05,1.05,1.31,2.73.47,3.96-1.11,1.61-3.31,1.75-4.62.44l-24.04-24.22s-.04-.02-.06,0l-24.04,24.22c-.59.59-1.36.89-2.13.89Z"/>
    <rect fill="#fff" x="18.88" y="31.89" width="13.68" height="13.79" rx="2.46" ry="2.46"/>
    <rect fill="#fff" x="33.93" y="31.89" width="13.68" height="13.79" rx="2.39" ry="2.39"/>
    <rect fill="#fff" x="33.93" y="47.06" width="13.68" height="13.79" rx="2.5" ry="2.5"/>
  </g>`
}

function buildOgSvg(): string {
  const gradient = buildGradientSvg()
  const logo = buildLogoSvg(OG_WIDTH / 2, 215, 150)
  const isDark = GRADIENT_PALETTE_MODES[CONFIG.palette] === 'dark'
  const nameColor = isDark ? '#f8fafc' : '#0f172a'
  const taglineColor = isDark ? 'rgba(248,250,252,0.78)' : 'rgba(15,23,42,0.72)'
  const fontFam = "'Helvetica Neue', Helvetica, Arial, sans-serif"

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="accent" x1="0" x2="${OG_WIDTH}" y1="0" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#69b3fe"/>
      <stop offset="100%" stop-color="#3b82f6"/>
    </linearGradient>
  </defs>
  ${gradient}
  ${logo}
  <text x="${OG_WIDTH / 2}" y="410" text-anchor="middle" font-family="${fontFam}" font-size="96" font-weight="700" fill="${nameColor}" letter-spacing="-3">${escapeXml(CONFIG.name)}</text>
  <text x="${OG_WIDTH / 2}" y="475" text-anchor="middle" font-family="${fontFam}" font-size="34" font-weight="400" fill="${taglineColor}">${escapeXml(CONFIG.tagline)}</text>
  <rect x="0" y="${OG_HEIGHT - 8}" width="${OG_WIDTH}" height="8" fill="url(#accent)"/>
</svg>`
}

async function main(): Promise<void> {
  const svg = buildOgSvg()
  const png = await sharp(Buffer.from(svg), { density: 300 })
    .resize(OG_WIDTH, OG_HEIGHT)
    .png({ compressionLevel: 9 })
    .toBuffer()

  for (const out of OUTPUTS) {
    writeFileSync(out, png)
    console.log(`✓ wrote ${out} (${(png.length / 1024).toFixed(1)} KB)`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
