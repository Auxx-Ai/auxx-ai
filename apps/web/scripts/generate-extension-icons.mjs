import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', 'public', 'logo_color.png')
const DST = join(here, '..', '..', 'extension', 'public', 'icons')
await mkdir(DST, { recursive: true })

for (const size of [16, 32, 48, 128]) {
  const out = join(DST, `icon${size}.png`)
  await sharp(SRC)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 9 })
    .toFile(out)
  const meta = await sharp(out).metadata()
  console.log(`icon${size}.png  ${meta.width}x${meta.height}`)
}
