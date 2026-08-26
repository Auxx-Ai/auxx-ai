// packages/lib/src/files/core/__tests__/image-processing.test.ts

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  assertSharpSafeInput,
  detectImageType,
  isSvg,
  normalizeImageSource,
  UnsupportedImageError,
} from '../image-processing'

/** Build a minimal single-frame ICO wrapping an already-encoded frame buffer. */
function buildIco(frame: Buffer, size: number): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type = icon
  header.writeUInt16LE(1, 4) // frame count
  const entry = Buffer.alloc(16)
  entry.writeUInt8(size >= 256 ? 0 : size, 0) // width (0 == 256)
  entry.writeUInt8(size >= 256 ? 0 : size, 1) // height
  entry.writeUInt16LE(1, 4) // color planes
  entry.writeUInt16LE(32, 6) // bit depth
  entry.writeUInt32LE(frame.length, 8) // bytes in resource
  entry.writeUInt32LE(6 + 16, 12) // offset to image data
  return Buffer.concat([header, entry, frame])
}

const solidPng = (w: number, h: number) =>
  sharp({
    create: { width: w, height: h, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } },
  })
    .png()
    .toBuffer()

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#4f46e5"/></svg>'

describe('isSvg', () => {
  it('detects a bare <svg root', () => {
    expect(isSvg(Buffer.from(SVG))).toBe(true)
  })

  it('tolerates BOM, xml declaration, comments and doctype', () => {
    const withPreamble =
      '﻿<?xml version="1.0" encoding="UTF-8"?>\n<!-- a comment -->\n<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>'
    expect(isSvg(Buffer.from(withPreamble))).toBe(true)
  })

  it('rejects non-svg text and binary', async () => {
    expect(isSvg(Buffer.from('<html><body>nope</body></html>'))).toBe(false)
    expect(isSvg(await solidPng(4, 4))).toBe(false)
  })
})

describe('detectImageType', () => {
  it('detects raster formats via magic bytes', async () => {
    expect(await detectImageType(await solidPng(4, 4))).toBe('image/png')
  })

  it('falls back to the SVG sniff', async () => {
    expect(await detectImageType(Buffer.from(SVG))).toBe('image/svg+xml')
  })

  it('returns undefined for unknown content', async () => {
    expect(await detectImageType(Buffer.from('just plain text, no image'))).toBeUndefined()
  })
})

describe('normalizeImageSource', () => {
  it('passes raster formats through unchanged', async () => {
    const png = await solidPng(8, 8)
    const result = await normalizeImageSource(png)
    expect(result.normalizedFrom).toBeUndefined()
    expect(result.mime).toBe('image/png')
    expect(result.buffer).toBe(png)
  })

  it('rasterizes an SVG to a sharp-readable PNG (bounded to 512px)', async () => {
    const result = await normalizeImageSource(Buffer.from(SVG))
    expect(result.normalizedFrom).toBe('svg')
    expect(result.mime).toBe('image/png')
    const meta = await sharp(result.buffer).metadata()
    expect(meta.format).toBe('png')
    // 120x60 → larger side clamped to 512 → 512x256
    expect(meta.width).toBe(512)
    expect(meta.height).toBe(256)
  })

  it('neutralizes a malicious SVG but still renders safe content', async () => {
    const evil =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><script>fetch("http://evil")</script><image href="file:///etc/passwd"/><use xlink:href="http://evil/x"/><rect width="16" height="16" fill="green"/></svg>'
    const result = await normalizeImageSource(Buffer.from(evil))
    expect(result.normalizedFrom).toBe('svg')
    const meta = await sharp(result.buffer).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBeGreaterThan(0)
  })

  it('decodes an ICO (PNG frame) to a PNG raster', async () => {
    const ico = buildIco(await solidPng(64, 64), 64)
    expect(await detectImageType(ico)).toBe('image/x-icon')
    const result = await normalizeImageSource(ico)
    expect(result.normalizedFrom).toBe('ico')
    expect(result.mime).toBe('image/png')
    const meta = await sharp(result.buffer).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(64)
    expect(meta.height).toBe(64)
  })

  it('throws UnsupportedImageError for a corrupt ICO', async () => {
    // Valid ICO header claiming one frame, but the frame data is garbage.
    const corrupt = Buffer.from([
      0, 0, 1, 0, 1, 0, 255, 255, 0, 0, 0, 0, 4, 0, 0, 0, 22, 0, 0, 0, 1, 2, 3,
    ])
    await expect(normalizeImageSource(corrupt)).rejects.toBeInstanceOf(UnsupportedImageError)
  })

  it('throws UnsupportedImageError for undetectable content', async () => {
    await expect(normalizeImageSource(Buffer.from('not an image'))).rejects.toBeInstanceOf(
      UnsupportedImageError
    )
  })
})

describe('assertSharpSafeInput', () => {
  it('accepts the raster formats sharp decodes safely', async () => {
    await expect(assertSharpSafeInput(await solidPng(8, 8))).resolves.toBe('image/png')
    const jpeg = await sharp(await solidPng(8, 8))
      .jpeg()
      .toBuffer()
    await expect(assertSharpSafeInput(jpeg)).resolves.toBe('image/jpeg')
  })

  /**
   * The reason this guard exists: sharp bundles libheif, and every published
   * sharp (0.35.3 ships 1.23.1) predates the libheif 1.23.2 fix for the
   * heap overflow in GHSA-g89c-p67h-r497. If this test ever fails because AVIF
   * became acceptable, the overflow is reachable again from any raw
   * `sharp(untrustedBytes)` call.
   */
  it('refuses AVIF, which libheif cannot decode safely at any shipped version', async () => {
    const avif = await sharp(await solidPng(32, 32))
      .avif()
      .toBuffer()
    expect(await detectImageType(avif)).toBe('image/avif')
    await expect(assertSharpSafeInput(avif)).rejects.toThrow(UnsupportedImageError)
  })

  it('refuses SVG and ICO, which need normalizeImageSource first', async () => {
    await expect(assertSharpSafeInput(Buffer.from(SVG))).rejects.toThrow(UnsupportedImageError)
    const ico = buildIco(await solidPng(16, 16), 16)
    await expect(assertSharpSafeInput(ico)).rejects.toThrow(UnsupportedImageError)
  })

  it('refuses content it cannot identify', async () => {
    await expect(assertSharpSafeInput(Buffer.from('not an image'))).rejects.toThrow(
      UnsupportedImageError
    )
  })
})
