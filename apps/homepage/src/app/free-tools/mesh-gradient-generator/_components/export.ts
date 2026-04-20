// apps/homepage/src/app/free-tools/mesh-gradient-generator/_components/export.ts
// Export helpers: turn a StudioState into CSS, SVG, or PNG. All client-only,
// no backend. PNG uses the Canvas 2D API; SVG mirrors RandomGradient's output;
// CSS stacks radial-gradient() layers (not supported for openai mode).

import {
  type GradientMode,
  generateLayers,
  type Layer,
  MODES,
  rgba,
} from '@auxx/ui/components/gradient-layers'

export type StudioConfig = {
  mode: GradientMode
  colors: string[]
  animated: boolean
  animationDuration: number
  driftAmplitude: number
  blur: number
  layers: number
  seed: number
}

function resolveLayers(config: StudioConfig): Layer[] {
  return generateLayers(config.seed, config.mode, config.colors, config.layers, {
    driftAmplitude: config.driftAmplitude,
    animationDuration: config.animationDuration,
  })
}

// ---------------------------------------------------------------------------
// CSS export
// ---------------------------------------------------------------------------

/**
 * Build a CSS snippet that reproduces the current gradient. Throws if the mode
 * is 'openai' — radial-gradient() cannot express skewX on the focal point.
 *
 * When `animated=true` the snippet includes the full @keyframes drift animation
 * and applies it directly on the base `.mesh-gradient` class, so paste-and-go
 * just works. The CSS drift is a `background-position` pan — it's a
 * simplification of the SVG per-layer drift (a pure-CSS per-layer drift would
 * need one div per layer), but matches the visual rhythm.
 */
export function toCss(config: StudioConfig): string {
  if (config.mode === 'openai') {
    throw new Error('CSS export is not available for openai mode. Use SVG instead.')
  }
  const layers = resolveLayers(config)
  const modeConfig = MODES[config.mode]
  const bg = config.colors[0] ?? '#000000'

  const gradientStack = layers
    .map((l) => {
      const w = Math.max(0, l.r * l.scaleX)
      const h = Math.max(0, l.r * l.scaleY)
      return (
        `    radial-gradient(ellipse ${w.toFixed(2)}% ${h.toFixed(2)}% at ${l.fx.toFixed(2)}% ${l.fy.toFixed(2)}%, ` +
        `${rgba(l.color, l.opacity)} 0%, ` +
        `${rgba(l.color, l.opacity * 0.35)} 55%, ` +
        `${rgba(l.color, 0)} 100%)`
      )
    })
    .join(',\n')

  const rules: string[] = [`  background-color: ${bg};`, `  background-image:\n${gradientStack};`]
  if (modeConfig.blendMode && modeConfig.blendMode !== 'normal') {
    rules.push(`  background-blend-mode: ${modeConfig.blendMode};`)
  }
  if (config.blur > 0) {
    rules.push(`  filter: blur(${config.blur}px);`)
  }
  if (config.animated) {
    rules.push(`  background-size: 110% 110%;`)
    rules.push(
      `  animation: mesh-gradient-drift ${config.animationDuration}s ease-in-out infinite;`
    )
  }

  const baseBlock = `.mesh-gradient {\n${rules.join('\n')}\n}`

  if (!config.animated) {
    return baseBlock
  }

  const dx = config.driftAmplitude.toFixed(2)
  return `${baseBlock}

@keyframes mesh-gradient-drift {
  0%   { background-position: 0% 0%; }
  50%  { background-position: ${dx}% ${dx}%; }
  100% { background-position: 0% 0%; }
}

@media (prefers-reduced-motion: reduce) {
  .mesh-gradient { animation: none; }
}`
}

// ---------------------------------------------------------------------------
// SVG export
// ---------------------------------------------------------------------------

/**
 * Build a standalone SVG string for the current gradient. Works for all modes,
 * including openai (which requires skewX that CSS cannot express).
 */
export function toSvg(
  config: StudioConfig,
  size: { w: number; h: number } = { w: 1200, h: 630 }
): string {
  const layers = resolveLayers(config)
  const modeConfig = MODES[config.mode]
  const bg = config.colors[0] ?? '#000000'
  const isScatter = config.mode === 'openai'
  const shouldAnimate = config.animated

  const defs: string[] = []
  const rects: string[] = []

  layers.forEach((l, i) => {
    const id = `g${i}`
    if (l.scatter) {
      defs.push(
        `    <radialGradient id="${id}" fx="${l.scatter.fx01.toFixed(4)}" fy="0.5">
      <stop offset="0%" stop-color="${l.color}"/>
      <stop offset="100%" stop-color="${l.color}" stop-opacity="0"/>
    </radialGradient>`
      )
      const { tx, ty, skewX } = l.scatter
      const staticTransform = `translate(50 50) scale(${l.scaleX.toFixed(4)} ${l.scaleY.toFixed(4)}) skewX(${skewX.toFixed(4)}) rotate(${l.rotation.toFixed(4)})`
      const staticInner = `translate(${tx.toFixed(4)} ${ty.toFixed(4)})`
      const animate = shouldAnimate
        ? `
      <animateTransform attributeName="transform" attributeType="XML" type="translate" values="${(tx - l.driftX).toFixed(4)} ${(ty - l.driftY).toFixed(4)}; ${(tx + l.driftX).toFixed(4)} ${(ty + l.driftY).toFixed(4)}; ${(tx - l.driftX).toFixed(4)} ${(ty - l.driftY).toFixed(4)}" dur="${config.animationDuration}s" begin="${l.delay.toFixed(4)}s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" keyTimes="0; 0.5; 1"/>`
        : ''
      rects.push(
        `  <g transform="${staticTransform}">
    <g${shouldAnimate ? '' : ` transform="${staticInner}"`}>${animate}
      <rect width="100" height="100" fill="url(#${id})" transform="translate(-50 -50)" style="mix-blend-mode:${modeConfig.blendMode ?? 'normal'}"/>
    </g>
  </g>`
      )
      return
    }

    defs.push(
      `    <radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${l.cx.toFixed(4)}" cy="${l.cy.toFixed(4)}" fx="${l.fx.toFixed(4)}" fy="${l.fy.toFixed(4)}" r="${l.r.toFixed(4)}" gradientTransform="rotate(${l.rotation.toFixed(4)} ${l.cx.toFixed(4)} ${l.cy.toFixed(4)}) scale(${l.scaleX.toFixed(4)} ${l.scaleY.toFixed(4)})">
      <stop offset="0%" stop-color="${l.color}" stop-opacity="${l.opacity.toFixed(4)}"/>
      <stop offset="55%" stop-color="${l.color}" stop-opacity="${(l.opacity * 0.35).toFixed(4)}"/>
      <stop offset="100%" stop-color="${l.color}" stop-opacity="0"/>
    </radialGradient>`
    )
    rects.push(
      `  <rect width="100" height="100" fill="url(#${id})" style="mix-blend-mode:${modeConfig.blendMode ?? 'normal'}"/>`
    )
  })

  const filter = config.blur > 0 ? ` filter="blur(${config.blur}px)"` : ''
  const saturate = isScatter ? ' style="filter: saturate(125%)"' : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size.w}" height="${size.h}" preserveAspectRatio="none"${saturate}>
  <rect width="100" height="100" fill="${bg}"/>
  <g${filter}>
    <defs>
${defs.join('\n')}
    </defs>
${rects.join('\n')}
  </g>
</svg>`
}

// ---------------------------------------------------------------------------
// PNG export — client-side canvas render
// ---------------------------------------------------------------------------

export type PngSize = { w: number; h: number }

export const PNG_SIZE_PRESETS: Array<{ label: string; size: PngSize }> = [
  { label: 'Hero (1440×900)', size: { w: 1440, h: 900 } },
  { label: 'OG image (1200×630)', size: { w: 1200, h: 630 } },
  { label: 'Twitter header (1500×500)', size: { w: 1500, h: 500 } },
  { label: 'iPhone wallpaper (1290×2796)', size: { w: 1290, h: 2796 } },
  { label: 'MacBook wallpaper (2880×1800)', size: { w: 2880, h: 1800 } },
  { label: 'Square (1200×1200)', size: { w: 1200, h: 1200 } },
]

/**
 * Render the current gradient to a PNG blob using the Canvas 2D API. The PNG
 * captures the base position of each layer — animated drift is frozen at t=0
 * because a PNG is a single frame.
 */
export async function toPng(config: StudioConfig, size: PngSize): Promise<Blob> {
  const canvas = renderGradientFrame(config, size, 0)
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('canvas.toBlob returned null'))
    }, 'image/png')
  })
}

/**
 * Render a single frame of the gradient to a fresh canvas. `phase` is a
 * normalized 0..1 position inside the animation cycle.
 *
 * Mirrors the live preview's exact rendering pipeline:
 *
 *   1. Background color fills the parent (unblurred).
 *   2. Gradient layers render. For `openai` mode, every layer uses the
 *      scatter path (skewed radial scatter). For other modes, the preview
 *      INTERLEAVES two paths by index:
 *        - Even indices: SVG `<radialGradient gradientUnits="userSpaceOnUse">`
 *          on a full viewBox rect. Static (no drift).
 *        - Odd indices: CSS `radial-gradient(ellipse w% h% at fx% fy%, ...)`
 *          on a div rotated by `layer.rotation` around its center, animated
 *          by translating via CSS `transform`.
 *   3. Mix-blend-mode is applied per-layer (screen/normal/multiply).
 *   4. `filter: blur(N)` on the SVG/CSS elements; saturate(125%) on the SVG
 *      for openai. Both applied to the layer stack before compositing with bg.
 *
 * Canvas equivalent: work in viewBox (0..100) units by calling `ctx.scale(sx, sy)`
 * on an offscreen canvas. That correctly reproduces SVG's `preserveAspectRatio='none'`
 * non-uniform stretch on a non-square canvas (1440×900, 1500×500, etc.). Then draw
 * each layer with the correct path — SVG-style for even, CSS-style for odd, scatter
 * for openai. `drawImage` the offscreen onto the main canvas with blur + saturate
 * filters and the layer's blend mode as the composite op.
 *
 * Drift phase: at phase=0 layers sit at base−drift, at phase=0.5 they're at
 * base+drift, at phase=1 back to base−drift. That's `−cos(2π·phase)`, matching
 * the SVG animateTransform / CSS @keyframes values.
 */
export function renderGradientFrame(
  config: StudioConfig,
  size: PngSize,
  phase: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size.w
  canvas.height = size.h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get 2D canvas context')

  // Background on the main canvas (unblurred, same as parent div in preview).
  const bg = config.colors[0] ?? '#000000'
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, size.w, size.h)

  const modeConfig = MODES[config.mode]
  const layers = resolveLayers(config)
  const isScatter = config.mode === 'openai'

  // Offscreen canvas for layers. Scale to viewBox (0..100) units so subsequent
  // draws match SVG's preserveAspectRatio='none' behavior — a circle of radius
  // r in the viewBox becomes an ellipse with semi-axes (r·sx, r·sy) in pixels.
  const offscreen = document.createElement('canvas')
  offscreen.width = size.w
  offscreen.height = size.h
  const octx = offscreen.getContext('2d')
  if (!octx) throw new Error('Failed to get offscreen 2D context')
  octx.scale(size.w / 100, size.h / 100)

  const blend = modeConfig.blendMode ?? 'normal'
  const compositeOp: GlobalCompositeOperation =
    blend === 'screen' ? 'screen' : blend === 'multiply' ? 'multiply' : 'source-over'
  octx.globalCompositeOperation = compositeOp

  const cycle = Math.max(0.0001, config.animationDuration)
  layers.forEach((layer, i) => {
    // SVG animateTransform keyframes: (base − drift) → (base + drift) → (base − drift),
    // ease-in-out. −cos(2π·t) hits those keyframe values exactly. Layer delay is negative
    // (set during generation) and shifts each layer into its own phase within the cycle.
    const rawPhase = phase + layer.delay / cycle
    const layerPhase = ((rawPhase % 1) + 1) % 1
    const driftT = -Math.cos(2 * Math.PI * layerPhase)
    const offX = layer.driftX * driftT
    const offY = layer.driftY * driftT

    if (isScatter && layer.scatter) {
      drawScatterLayer(octx, layer, offX, offY)
    } else if (i % 2 === 0) {
      // SVG-style layer: static (no drift), radial gradient in userSpaceOnUse.
      drawSvgStyleLayer(octx, layer)
    } else {
      // CSS-style layer: drifts, elliptical gradient, rotated around element center.
      drawCssStyleLayer(octx, layer, offX, offY)
    }
  })

  // Composite blurred layer stack onto bg with the layer-mode blend. drawImage
  // applies `ctx.filter` to the source first, then `globalCompositeOperation`
  // blends the filtered source against the destination (main canvas = bg).
  // That's the same order the browser uses in the live preview.
  const filterParts: string[] = []
  if (config.blur > 0) filterParts.push(`blur(${config.blur}px)`)
  if (isScatter) filterParts.push('saturate(125%)')
  ctx.filter = filterParts.length > 0 ? filterParts.join(' ') : 'none'
  ctx.globalCompositeOperation = compositeOp
  ctx.drawImage(offscreen, 0, 0)
  ctx.filter = 'none'
  ctx.globalCompositeOperation = 'source-over'

  return canvas
}

/**
 * SVG-style layer: radialGradient with gradientUnits='userSpaceOnUse' on a
 * full-viewBox rect. Rotation and non-uniform scale applied via gradientTransform.
 * Context is already scaled to viewBox units (0..100).
 */
function drawSvgStyleLayer(ctx: CanvasRenderingContext2D, layer: Layer): void {
  ctx.save()
  // gradientTransform: rotate around (cx, cy), then scale around origin.
  // In canvas, apply in reverse so they compose into the same matrix.
  ctx.translate(layer.cx, layer.cy)
  ctx.rotate((layer.rotation * Math.PI) / 180)
  ctx.scale(layer.scaleX, layer.scaleY)
  ctx.translate(-layer.cx, -layer.cy)
  const grad = ctx.createRadialGradient(layer.fx, layer.fy, 0, layer.cx, layer.cy, layer.r)
  grad.addColorStop(0, rgba(layer.color, layer.opacity))
  grad.addColorStop(0.55, rgba(layer.color, layer.opacity * 0.35))
  grad.addColorStop(1, rgba(layer.color, 0))
  ctx.fillStyle = grad
  // Fill huge area so the rotated/scaled ellipse covers everything. The viewBox
  // is 100 units; fill 2000 around origin to be safe after scale.
  ctx.fillRect(-1000, -1000, 2000, 2000)
  ctx.restore()
}

/**
 * CSS-style layer: the preview renders this as a div 100% × 100% with
 * `transform: rotate(θ) translate(drift)` and
 * `background: radial-gradient(ellipse w% h% at fx% fy%, ...)`.
 * Context is in viewBox units.
 */
function drawCssStyleLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  offX: number,
  offY: number
): void {
  const wRad = layer.r * layer.scaleX
  const hRad = layer.r * layer.scaleY
  if (wRad <= 0 || hRad <= 0) return

  ctx.save()
  // CSS `transform: rotate(θ) translate(drift)` around transform-origin 50% 50%:
  // rotate element around its center, then translate in the rotated frame.
  ctx.translate(50, 50)
  ctx.rotate((layer.rotation * Math.PI) / 180)
  ctx.translate(-50, -50)
  ctx.translate(offX, offY)

  // Clip to the element's rect. Beyond this the CSS gradient doesn't render.
  ctx.beginPath()
  ctx.rect(0, 0, 100, 100)
  ctx.clip()

  // Elliptical gradient at (fx, fy) with semi-axes (wRad, hRad). Canvas only
  // supports circular radial gradients, so scale the context to turn a circle
  // of radius max(wRad, hRad) into an ellipse with semi-axes (wRad, hRad).
  const maxR = Math.max(wRad, hRad)
  ctx.translate(layer.fx, layer.fy)
  ctx.scale(wRad / maxR, hRad / maxR)
  ctx.translate(-layer.fx, -layer.fy)

  const grad = ctx.createRadialGradient(layer.fx, layer.fy, 0, layer.fx, layer.fy, maxR)
  grad.addColorStop(0, rgba(layer.color, layer.opacity))
  grad.addColorStop(0.55, rgba(layer.color, layer.opacity * 0.35))
  grad.addColorStop(1, rgba(layer.color, 0))
  ctx.fillStyle = grad

  // Fill a generous rect; clip restricts to element bounds.
  ctx.fillRect(-1000, -1000, 2000, 2000)
  ctx.restore()
}

/**
 * Scatter (openai) layer: 100×100 rect at (-50,-50)..(50,50), with
 * translate(50 50) scale skewX rotate translate(tx + drift, ty + drift) chain,
 * asymmetric focal point (fx01 along x, 0.5 along y), SVG default r=50%.
 * Context is in viewBox units.
 */
function drawScatterLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  offX: number,
  offY: number
): void {
  if (!layer.scatter) return
  const { tx, ty, skewX, fx01 } = layer.scatter

  ctx.save()
  ctx.translate(50, 50)
  ctx.scale(layer.scaleX, layer.scaleY)
  // skewX = shear along X. Canvas transform matrix: [1, 0, tan(θ), 1, 0, 0]
  const skewRad = (skewX * Math.PI) / 180
  ctx.transform(1, 0, Math.tan(skewRad), 1, 0, 0)
  ctx.rotate((layer.rotation * Math.PI) / 180)
  ctx.translate(tx + offX, ty + offY)

  // Rect local bounds: (-50, -50) to (50, 50). Gradient uses SVG defaults with
  // fx=fx01, fy=0.5 in objectBoundingBox; cx=cy=0.5 (center), r=0.5.
  // Converting to rect-local absolute coords: focal=(fx01·100−50, 0),
  // end center=(0, 0), end radius=50.
  const fxAbs = fx01 * 100 - 50
  const grad = ctx.createRadialGradient(fxAbs, 0, 0, 0, 0, 50)
  grad.addColorStop(0, layer.color)
  grad.addColorStop(1, rgba(layer.color, 0))
  ctx.fillStyle = grad
  ctx.fillRect(-50, -50, 100, 100)
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Video export — MediaRecorder + canvas.captureStream
// ---------------------------------------------------------------------------

export type VideoSize = { w: number; h: number }

export const VIDEO_SIZE_PRESETS: Array<{ label: string; size: VideoSize }> = [
  { label: '1080p (1920×1080)', size: { w: 1920, h: 1080 } },
  { label: '720p (1280×720)', size: { w: 1280, h: 720 } },
  { label: 'Square 1080 (1080×1080)', size: { w: 1080, h: 1080 } },
  { label: 'Vertical 1080 (1080×1920)', size: { w: 1080, h: 1920 } },
]

export const VIDEO_DURATION_PRESETS: number[] = [5, 10, 15, 20, 30]

export type VideoMime = {
  /** MIME type passed to MediaRecorder, e.g. 'video/mp4;codecs=avc1.42E01E' */
  mime: string
  /** File extension to use on download */
  ext: 'mp4' | 'webm'
  /** Human-readable label for the UI */
  label: string
}

/**
 * Pick the best video MIME type MediaRecorder supports in this browser.
 * Safari can emit MP4 natively. Chrome/Firefox only do WebM; H.264 landed in
 * Chrome 130 but isn't universal yet.
 */
export function pickVideoMime(): VideoMime {
  if (typeof MediaRecorder === 'undefined') {
    // Caller should have feature-detected before invoking — return a best guess.
    return { mime: 'video/webm', ext: 'webm', label: 'WebM' }
  }
  const candidates: VideoMime[] = [
    { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4', label: 'MP4 (H.264)' },
    { mime: 'video/mp4', ext: 'mp4', label: 'MP4' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm', label: 'WebM (VP9)' },
    { mime: 'video/webm;codecs=vp8', ext: 'webm', label: 'WebM (VP8)' },
    { mime: 'video/webm', ext: 'webm', label: 'WebM' },
  ]
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c.mime)) return c
    } catch {
      // some browsers throw instead of returning false
    }
  }
  return { mime: 'video/webm', ext: 'webm', label: 'WebM' }
}

export type VideoExportProgress = {
  /** 0..1 while recording, 1 when blob is ready */
  progress: number
  /** Seconds elapsed inside the recording */
  elapsed: number
}

export type VideoExportOptions = {
  size: VideoSize
  /** Total recording length in seconds */
  durationSeconds: number
  /** Frames per second to render. Lower = smaller file, less smooth. */
  fps?: number
  mime?: VideoMime
  onProgress?: (p: VideoExportProgress) => void
  /** Abort signal — aborting stops the recorder early and rejects the promise */
  signal?: AbortSignal
}

/**
 * Render an animated version of the gradient to a video blob. Runs entirely
 * in the browser — no network, no WASM. The gradient is drawn frame-by-frame
 * to a canvas at `fps`, the canvas stream is piped into a `MediaRecorder`,
 * and the recorder output is returned when the recording finishes.
 *
 * Format: WebM (VP9/VP8) in Chrome/Firefox, MP4 (H.264) in Safari. Check the
 * returned `mime.ext` to pick a filename.
 */
export async function toVideo(
  config: StudioConfig,
  opts: VideoExportOptions
): Promise<{ blob: Blob; mime: VideoMime }> {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder is not supported in this browser')
  }
  const mime = opts.mime ?? pickVideoMime()
  const fps = opts.fps ?? 30

  // One persistent canvas for the entire recording so MediaRecorder's stream
  // keeps reading from the same source.
  const canvas = document.createElement('canvas')
  canvas.width = opts.size.w
  canvas.height = opts.size.h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get 2D canvas context')

  // Draw the initial frame before attaching the stream, otherwise MediaRecorder
  // can emit an empty first chunk.
  drawFrameInto(canvas, ctx, config, opts.size, 0)

  const stream = canvas.captureStream(fps)
  const recorder = new MediaRecorder(stream, {
    mimeType: mime.mime,
    videoBitsPerSecond: estimateBitrate(opts.size, fps),
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }

  const recordingDone = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime.mime })
      if (blob.size === 0) reject(new Error('Recording produced an empty blob'))
      else resolve(blob)
    }
    recorder.onerror = (e) => reject(e)
  })

  const cycleSeconds = Math.max(0.1, config.animationDuration)
  const startedAt = performance.now()
  recorder.start()

  // Drive the canvas with requestAnimationFrame at the target fps. Each frame
  // computes the phase (0..1 inside one animation cycle) based on real elapsed
  // time so the output plays back at the intended duration.
  let cancelled = false
  const cancel = () => {
    cancelled = true
  }
  opts.signal?.addEventListener('abort', cancel)

  await new Promise<void>((resolve) => {
    const frameInterval = 1000 / fps
    let lastFrame = -1
    const tick = (now: number) => {
      if (cancelled) {
        resolve()
        return
      }
      const elapsedMs = now - startedAt
      const elapsed = elapsedMs / 1000
      if (elapsed >= opts.durationSeconds) {
        // Render final frame to ensure the last chunk captures the end state.
        const finalPhase = (opts.durationSeconds / cycleSeconds) % 1
        drawFrameInto(canvas, ctx, config, opts.size, finalPhase)
        opts.onProgress?.({ progress: 1, elapsed: opts.durationSeconds })
        resolve()
        return
      }
      const frameIdx = Math.floor(elapsedMs / frameInterval)
      if (frameIdx !== lastFrame) {
        lastFrame = frameIdx
        const phase = (elapsed / cycleSeconds) % 1
        drawFrameInto(canvas, ctx, config, opts.size, phase)
        opts.onProgress?.({ progress: elapsed / opts.durationSeconds, elapsed })
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  recorder.stop()
  stream.getTracks().forEach((t) => t.stop())
  const blob = await recordingDone
  if (cancelled) throw new DOMException('Video recording was aborted', 'AbortError')
  return { blob, mime }
}

function drawFrameInto(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  config: StudioConfig,
  size: VideoSize,
  phase: number
): void {
  // Re-render the full frame each tick. Building a fresh canvas per frame would
  // be cleaner but would drop the MediaRecorder stream connection.
  const frame = renderGradientFrame(config, size, phase)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.filter = 'none'
  ctx.drawImage(frame, 0, 0)
}

function estimateBitrate(size: VideoSize, fps: number): number {
  // Rule of thumb: ~0.1 bits per pixel per frame for high-quality gradient
  // footage. Cap at 25 Mbps so we don't blow out memory on 1080p recordings.
  const pixels = size.w * size.h
  const bitsPerPixelPerFrame = 0.1
  const estimated = Math.round(pixels * fps * bitsPerPixelPerFrame)
  return Math.min(estimated, 25_000_000)
}

/** Trigger a download of the given blob from the browser. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Defer revoke so Safari has time to read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Download a string as a text file (for CSS / SVG export). */
export function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  downloadBlob(blob, filename)
}
