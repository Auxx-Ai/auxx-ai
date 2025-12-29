import { createMDX } from 'fumadocs-mdx/next'
import path from 'path'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  // Ensure Docker build produces .next/standalone
  output: 'standalone' as const,
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../../'),
}

export default withMDX(config)
