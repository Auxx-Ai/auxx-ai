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
