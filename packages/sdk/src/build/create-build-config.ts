// packages/sdk/src/build/create-build-config.ts

/**
 * @file Creates esbuild configuration for building Auxx apps as ESM modules for Node.js runtime.
 * Handles bundling, minification, sourcemaps, and external dependencies.
 */

import type { BuildOptions } from 'esbuild'

/**
 * Configuration options for creating an esbuild build config.
 */
export interface BuildConfigOptions {
  /** The entry point file path to start the build from */
  entryPoint: string
  /** The output file path where the bundle will be written */
  outfile: string
  /** Whether to minify the output bundle (default: false) */
  minify?: boolean
  /** Whether to generate sourcemaps (default: true) */
  sourcemap?: boolean
  /** Additional packages to mark as external and not bundle (default: []) */
  external?: string[]
}

/**
 * Creates an esbuild configuration for building Auxx apps as ESM modules targeting Node.js 18+.
 *
 * The configuration:
 * - Bundles the app into a single file
 * - Outputs ESM format for Node.js platform
 * - Excludes node_modules from bundling (packages: 'external')
 * - Always marks @auxx/sdk as external
 * - Sets NODE_ENV based on minify flag (production if minified, development otherwise)
 * - Generates metafile for bundle analysis
 * - Uses silent logging (errors handled by caller)
 *
 * @param options - Build configuration options
 * @param options.entryPoint - The entry point file path to start the build from
 * @param options.outfile - The output file path where the bundle will be written
 * @param options.minify - Whether to minify the output (default: false)
 * @param options.sourcemap - Whether to generate sourcemaps (default: true)
 * @param options.external - Additional packages to exclude from bundling (default: [])
 * @returns esbuild BuildOptions configuration object
 *
 * @example
 * ```typescript
 * const config = createBuildConfig({
 *   entryPoint: './src/index.ts',
 *   outfile: './dist/bundle.js',
 *   minify: true,
 *   sourcemap: true,
 *   external: ['some-package']
 * })
 *
 * const result = await esbuild.build(config)
 * ```
 */
export function createBuildConfig({
  entryPoint,
  outfile,
  minify = false,
  sourcemap = true,
  external = [],
}: BuildConfigOptions): BuildOptions {
  return {
    entryPoints: [entryPoint],
    bundle: true,
    outfile,
    format: 'esm',
    platform: 'node',
    target: ['node18'],
    minify,
    sourcemap,
    packages: 'external', // Don't bundle node_modules
    external: ['@auxx/sdk', ...external],
    define: {
      'process.env.NODE_ENV': minify ? '"production"' : '"development"',
    },
    logLevel: 'silent', // We'll handle errors ourselves
    metafile: true, // For bundle analysis
  }
}
