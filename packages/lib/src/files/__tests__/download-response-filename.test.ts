// packages/lib/src/files/__tests__/download-response-filename.test.ts

import { describe, expect, it } from 'vitest'
import { createFileDownloadResponse, encodeContentDisposition } from '../utils/download-response'

/**
 * HTTP header values are ByteStrings. One code point above U+00FF makes
 * `new Response(..., { headers })` throw, and the download route's catch turns that
 * into a bare 500 — so a filename the user never chose could make their own upload
 * permanently unreachable. macOS is the common case: every screenshot since macOS 13
 * carries U+202F NARROW NO-BREAK SPACE before AM/PM.
 */

const MACOS_SCREENSHOT = 'Screenshot 2026-02-09 at 12.55.35 PM.JPEG'

/** The real check — does the header survive Response construction? */
function headerSurvivesResponse(value: string): boolean {
  try {
    new Response('x', { headers: { 'Content-Disposition': value } })
    return true
  } catch {
    return false
  }
}

describe('encodeContentDisposition', () => {
  it('survives a macOS screenshot name (U+202F)', () => {
    const value = encodeContentDisposition('inline', MACOS_SCREENSHOT)

    expect(headerSurvivesResponse(value)).toBe(true)
    // The raw interpolation this replaced does NOT — that was the 500.
    expect(headerSurvivesResponse(`inline; filename="${MACOS_SCREENSHOT}"`)).toBe(false)
  })

  it('keeps the true name in filename* and an ASCII fallback in filename', () => {
    const value = encodeContentDisposition('attachment', MACOS_SCREENSHOT)

    expect(value).toContain(`filename*=UTF-8''${encodeURIComponent(MACOS_SCREENSHOT)}`)
    expect(value).toContain('filename="Screenshot 2026-02-09 at 12.55.35_PM.JPEG"')
  })

  it.each([
    ['emoji', 'holiday 🏖️ photo.png'],
    ['CJK', '請求書.pdf'],
    ['accents beyond Latin-1', 'Łódź-plan.pdf'],
    ['curly quotes', '“quoted”.txt'],
  ])('survives %s', (_label, name) => {
    expect(headerSurvivesResponse(encodeContentDisposition('inline', name))).toBe(true)
  })

  it('strips quotes and backslashes so a name cannot inject a parameter', () => {
    const value = encodeContentDisposition('attachment', 'evil"; download; x="a.txt')

    // Exactly one quoted filename parameter, and no injected `download` token
    // sitting outside the quotes.
    expect(value.match(/filename="/g)).toHaveLength(1)
    expect(value).toBe(
      `attachment; filename="evil; download; x=a.txt"; filename*=UTF-8''${encodeURIComponent(
        'evil"; download; x="a.txt'
      )}`
    )
  })

  it('sanitizes an all-non-ASCII name rather than emptying it', () => {
    // Each replaced code UNIT becomes one underscore, so a surrogate pair yields
    // two. Ugly but harmless — `filename*` carries the real name, and the fallback
    // only has to be a legal quoted-string.
    const value = encodeContentDisposition('inline', '🎉🎉')
    expect(value).toContain('filename="____"')
    expect(headerSurvivesResponse(value)).toBe(true)
  })

  it('falls back to a placeholder only when the name is empty', () => {
    expect(encodeContentDisposition('inline', '')).toContain('filename="download"')
  })

  it("percent-encodes RFC 5987 non-attr-chars (!'()*) in filename*", () => {
    // encodeURIComponent leaves all five bare; `'` is the ext-value delimiter
    // itself, so strict parsers truncate the parameter at the stray quote.
    const value = encodeContentDisposition('attachment', "it's report (v2)!*.pdf")

    expect(value).toContain("filename*=UTF-8''it%27s%20report%20%28v2%29%21%2A.pdf")
    const extValue = value.split("filename*=UTF-8''")[1]!
    expect(extValue).not.toMatch(/[!'()*]/)
  })
})

describe('createFileDownloadResponse disposition', () => {
  const body = Buffer.from('x')

  it('produces a header a Response accepts, for any filename', () => {
    const res = createFileDownloadResponse(
      body,
      { name: MACOS_SCREENSHOT, mimeType: 'image/jpeg', size: 1 },
      { inline: true }
    )

    expect(res.headers['Content-Disposition']).toMatch(/^inline;/)
    expect(headerSurvivesResponse(res.headers['Content-Disposition']!)).toBe(true)
  })

  it('still defaults to attachment when inline is not requested', () => {
    const res = createFileDownloadResponse(body, { name: 'plain.pdf', mimeType: 'application/pdf' })
    expect(res.headers['Content-Disposition']).toMatch(/^attachment;/)
  })
})
