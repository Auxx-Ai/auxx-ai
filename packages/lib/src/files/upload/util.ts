// packages/lib/src/files/upload/util.ts

/**
 * Utility functions for the unified processor system
 * Pure functions with no side effects for configuration processing
 *
 * Bucket routing and public-URL formatting used to live here too
 * (`getBucketForVisibility`, `getPublicCdnUrl`). They moved to
 * `files/storage/buckets.ts` in PR 3b, next to `buildExternalUrl` and
 * `assertBucket`, so there is one place that decides which bucket an object
 * belongs in.
 */

/**
 * Clamp a number between min and max values
 */
export const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n))

/**
 * Sanitize filename to remove potentially problematic characters
 * Replaces non-alphanumeric characters (except . and -) with underscores
 */
export const sanitizeFileName = (name: string): string => name.replace(/[^a-zA-Z0-9.-]/g, '_')

/**
 * Normalize entity type to kebab-case for use in storage keys
 * Examples: USER_PROFILE → user-profile, WORKFLOW_RUN → workflow-run
 */
export const normalizeEntityType = (entityType: string): string => {
  return entityType.toLowerCase().replace(/_/g, '-')
}

/**
 * Generate storage key based on entity type
 * Format: {orgId}/{entity-type}/{entityId}/{timestamp}_{keySeed}{filename}
 *
 * orgId comes FIRST for easy org deletion and data isolation:
 * - Delete all org data: aws s3 rm s3://bucket/{orgId}/ --recursive
 * - Per-org lifecycle rules, cost tracking, access control
 *
 * The entity processor determines the folder structure via entityType.
 * No special casing - simple, consistent paths for all entity types.
 *
 * `nowMs` exists so a caller that has a clock can stay pure. `buildUploadConfig`
 * threads `FilesDeps.now` in, which is what lets a test assert on the whole key
 * — including the timestamp — without `vi.useFakeTimers()` leaking into every
 * other assertion in the process. Callers that omit it read the wall clock,
 * exactly as before.
 */
export const deriveStorageKey = (
  orgId: string,
  fileName: string,
  options: {
    entityType: string
    entityId: string
    keySeed?: string
    nowMs?: number
  }
): string => {
  const ts = options.nowMs ?? Date.now()
  const seed = options.keySeed ? `${options.keySeed}_` : ''
  const sanitized = sanitizeFileName(fileName)
  const entityPrefix = normalizeEntityType(options.entityType)

  // Simple, consistent format for all entity types:
  // {orgId}/{entity-type}/{entityId}/{timestamp}_{seed}{filename}
  return `${orgId}/${entityPrefix}/${options.entityId}/${ts}_${seed}${sanitized}`
}

/**
 * Normalize MIME type by converting to lowercase and removing parameters
 */
export const normalizeMimeType = (mimeType: string): string => {
  return (mimeType.toLowerCase().split(';')[0] ?? '').trim()
}

/**
 * Check if a file size qualifies for multipart upload
 */
export const shouldUseMultipart = (size: number, threshold = 50 * 1024 * 1024): boolean => {
  return size >= threshold
}

/**
 * Generate default key prefix for organization
 */
export const getDefaultKeyPrefix = (organizationId: string): string => {
  const normalized = organizationId?.trim() ?? ''
  if (!normalized) return ''
  return `${normalized}/`
}
