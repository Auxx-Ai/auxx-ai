// packages/lib/src/files/core/decode-ico.d.ts
// Ambient declaration for `decode-ico` (ships no bundled types).

declare module 'decode-ico' {
  /** A single decoded ICO/CUR frame. */
  interface DecodedIcoFrame {
    width: number
    height: number
    /** `png` frames carry raw PNG file bytes; `bmp` frames carry decoded RGBA. */
    type: 'png' | 'bmp'
    /** Source bit depth. */
    bpp: number
    /** PNG bytes (`type: 'png'`) or raw RGBA pixels (`type: 'bmp'`). */
    data: Uint8ClampedArray
    hotspot?: { x: number; y: number } | null
  }

  /** Decode an ICO/CUR container into its constituent frames. */
  export default function decodeIco(buffer: Buffer | Uint8Array): DecodedIcoFrame[]
}
