// apps/web/src/components/files/utils/convert-heic.ts

/**
 * Best-effort client-side HEIC/HEIF → JPEG re-encode (37b-scouting-quote-photos.md §4).
 *
 * The 'image' file category excludes HEIC (`packages/lib/src/files/file-type-constants.ts`
 * `IMAGE_EXTENSIONS`), so a HEIC photo must become JPEG before it reaches an images-only
 * FILE field. The primary defense is a constrained `accept` list on the file input (no
 * `image/heic` in the list — see `use-field-file-upload.ts`), which makes iOS Safari
 * transcode HEIC → JPEG itself at selection/capture time in most cases. This module is
 * the backstop for whatever slips through that (older iOS, browsers that hand back a
 * `.heic` file despite the accept list).
 *
 * `createImageBitmap` + `<canvas>` can only decode HEIC in Safari (the only engine with
 * native HEIC image support) — that's the exact case we need to cover, and it needs no
 * new dependency. Everywhere else `createImageBitmap` throws on a HEIC blob and this
 * quietly returns the original file, so existing server-side validation still rejects it
 * the same as before this module existed.
 */

const HEIC_EXTENSION_PATTERN = /\.(heic|heif)$/i

/** True when a `File` is (or looks like) HEIC/HEIF — by MIME type or filename extension,
 * since some devices hand over a `.heic` file with an empty/generic `mimeType`. */
export function isHeicFile(file: File): boolean {
  const type = file.type.toLowerCase()
  if (type === 'image/heic' || type === 'image/heif') return true
  return HEIC_EXTENSION_PATTERN.test(file.name)
}

/** Re-encode a single HEIC/HEIF file to JPEG via canvas. Returns the original file
 * untouched if it isn't HEIC, or if this browser can't decode HEIC client-side. */
export async function convertHeicToJpeg(file: File): Promise<File> {
  if (!isHeicFile(file)) return file

  try {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file

    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9)
    )
    if (!blob) return file

    const newName = file.name.replace(HEIC_EXTENSION_PATTERN, '.jpg')
    return new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    // Can't decode HEIC client-side outside Safari — leave untouched.
    return file
  }
}

/** Run `convertHeicToJpeg` over a file list — only HEIC/HEIF entries are re-encoded. */
export async function convertHeicFiles(files: File[]): Promise<File[]> {
  return Promise.all(files.map(convertHeicToJpeg))
}
