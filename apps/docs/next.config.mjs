// apps/docs/next.config.mjs
import { createMDX } from 'fumadocs-mdx/next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  // Ensure Docker build produces .next/standalone
  output: 'standalone',
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../../'),
}

export default withMDX(config)
