// packages/services/src/app-bundles/s3-key.ts

/**
 * Derive S3 key for a content-addressed bundle.
 * Used everywhere — API, Lambda, services. Single source of truth.
 *
 * Key format: apps/{appId}/bundles/{bundleType}/{sha256}.js
 */
export function getBundleS3Key(appId: string, bundleType: string, sha256: string): string {
  return `apps/${appId}/bundles/${bundleType}/${sha256}.js`
}
