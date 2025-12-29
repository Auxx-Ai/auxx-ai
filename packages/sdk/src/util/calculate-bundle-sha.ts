// packages/sdk/src/util/calculate-bundle-sha.ts

import { createHash } from 'crypto'

/**
 * Calculate SHA-256 hash of bundle content
 * @param bundleContent - The bundle content as a string
 * @returns SHA-256 hash as hex string
 */
export function calculateBundleSha(bundleContent: string): string {
  return createHash('sha256').update(bundleContent).digest('hex')
}

/**
 * Calculate combined SHA-256 hash for both client and server bundles
 * @param clientBundle - Client bundle content
 * @param serverBundle - Server bundle content
 * @returns Combined SHA-256 hash as hex string
 */
export function calculateBundleShas(clientBundle: string, serverBundle: string): string {
  // Combine both bundles with a delimiter and hash together
  const combined = `${clientBundle}\n---BUNDLE_SEPARATOR---\n${serverBundle}`
  return calculateBundleSha(combined)
}
