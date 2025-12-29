// apps/api/build-platform-runtime.ts

/**
 * Builds platform runtime and updates HTML template.
 * Delegates actual building to SDK package.
 */

import { buildPlatformRuntime } from '@auxx/sdk/build/platform-runtime'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function build() {
  const outputDir = join(__dirname, 'public', 'app-runtime')

  // Determine if we're in development mode
  const isDevelopment = process.env.NODE_ENV === 'development'

  // Build platform runtime (SDK handles it)
  const hash = await buildPlatformRuntime(outputDir, isDevelopment)

  // Update HTML template
  const htmlPath = join(outputDir, 'index.html')
  if (existsSync(htmlPath)) {
    let html = readFileSync(htmlPath, 'utf-8')
    html = html.replace(
      /\/api\/v1\/app-runtime\/platform\.\w+\.js/g,
      `/api/v1/app-runtime/platform.${hash}.js`
    )
    writeFileSync(htmlPath, html)
    console.log(`✅ Updated HTML template with hash: ${hash}`)
  }

  console.log(`\n🚀 Platform runtime ready for deployment!`)
  console.log(`   Hash: ${hash}`)
  console.log(`   Location: apps/api/public/app-runtime/`)
}

build()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('💥 Build failed:', error)
    process.exit(1)
  })
