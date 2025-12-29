// packages/sdk/src/build/platform-runtime/build.ts

import * as esbuild from 'esbuild'
import { createHash } from 'crypto'
import { readFileSync, renameSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Builds the platform runtime bundle
 * @param outputDir - Directory to output the built files
 * @param isDevelopment - Whether to build for development (no minification)
 * @returns Hash of the built bundle for cache busting
 */
export async function buildPlatformRuntime(
  outputDir: string,
  isDevelopment: boolean = process.env.NODE_ENV === 'development'
): Promise<string> {
  console.log(
    `📦 Building platform runtime bundle (${isDevelopment ? 'development' : 'production'})...\n`
  )

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  // Clean up old platform.*.js and platform.*.js.map files
  console.log('🧹 Cleaning up old platform bundles...')
  const files = readdirSync(outputDir)
  const oldBundles = files.filter(
    (file) => file.startsWith('platform.') && (file.endsWith('.js') || file.endsWith('.js.map'))
  )

  for (const file of oldBundles) {
    const filePath = join(outputDir, file)
    unlinkSync(filePath)
    console.log(`   Deleted: ${file}`)
  }

  if (oldBundles.length === 0) {
    console.log('   No old bundles to clean up')
  }
  console.log('')

  // Determine entry point - handle both when running from src/ and lib/
  // When compiled, this will be in lib/build/platform-runtime/build.js
  // We need to point to src/runtime/index.ts (merged entry point)
  const sdkRoot = join(__dirname, '..', '..', '..')
  const entryPoint = join(sdkRoot, 'src', 'runtime', 'index.ts')
  const tempOutput = join(outputDir, 'platform.js')

  try {
    // Build with esbuild
    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      format: 'iife',
      outfile: tempOutput,
      platform: 'browser',
      target: ['es2020'],
      minify: !isDevelopment, // Only minify in production
      sourcemap: true,
      metafile: true,
      logLevel: 'info',
      external: [], // Bundle everything
      define: {
        'process.env.NODE_ENV': isDevelopment ? '"development"' : '"production"',
      },
    })

    // Generate content hash for cache busting
    let bundleContent = readFileSync(tempOutput, 'utf-8')
    const hash = createHash('sha1').update(bundleContent).digest('hex').substring(0, 8)

    // Update sourceMappingURL to reference the hashed filename
    bundleContent = bundleContent.replace(
      /\/\/# sourceMappingURL=platform\.js\.map/,
      `//# sourceMappingURL=platform.${hash}.js.map`
    )

    // Rename files with hash
    const hashedOutput = join(outputDir, `platform.${hash}.js`)
    const hashedSourceMap = join(outputDir, `platform.${hash}.js.map`)

    // Write updated content and rename source map
    writeFileSync(hashedOutput, bundleContent)
    unlinkSync(tempOutput)
    renameSync(`${tempOutput}.map`, hashedSourceMap)

    // Print bundle info
    const sizeKB = (bundleContent.length / 1024).toFixed(2)
    console.log(`\n✅ Platform runtime built successfully!: ${new Date().toLocaleString()}`)
    console.log(`📄 File: platform.${hash}.js`)
    console.log(`📦 Size: ${sizeKB} KB (uncompressed)`)

    // Analyze bundle
    if (result.metafile) {
      // console.log('\n📊 Bundle Analysis:')
      // const analysis = await esbuild.analyzeMetafile(result.metafile, {
      //   verbose: false,
      // })
      // console.log(analysis)
    }

    return hash
  } catch (error) {
    console.error('❌ Build failed:', error)
    throw error
  }
}

// Allow running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const outputDir = process.argv[2] || './dist'
  buildPlatformRuntime(outputDir)
    .then((hash) => {
      console.log(`\n🚀 Platform runtime ready! Hash: ${hash}`)
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n💥 Build failed:', error)
      process.exit(1)
    })
}
