// packages/lib/src/files/attachments/ports.ts

/**
 * The dependency slice the attachment download path declares.
 *
 * One port lives here, and it exists for a reason worth stating plainly: a
 * **pinned** attachment addresses a `StorageLocation` by id, and the only thing
 * in the codebase that can turn a location id into a {@link DownloadRef} for an
 * arbitrary provider is `StorageManager.getDownloadRef`. `StoragePort` cannot:
 * it takes `(provider, bucket, key)`, which means the caller must already hold
 * the row.
 *
 * ## Why the pinned branch is not "fixed" onto the port
 *
 * The obvious cleanup — read the `StorageLocation` through
 * `storage/location-queries.ts` and presign it with `FilesDeps.storage` — is a
 * **live regression**, not a tidy-up. `location-queries.ts` filters on
 * `organizationId`, while `StorageLocation.organizationId` is nullable and every
 * pre-backfill row carries `NULL`. Routing the pinned branch through it would
 * make every one of those rows 404 on download. PR 5c recorded this decision;
 * it belongs to the Phase-6 backfill, not to an extraction.
 *
 * So the collaborator stays `StorageManager` — but it arrives as a
 * **parameter**, not as an `await import('../storage/storage-manager')` inside
 * the function body, which is the collaborator-by-`new` pattern `files/ctx.ts`
 * exists to delete. {@link LocationDownloadPort} names the single method the
 * download path uses, the same way `assets/ports.ts` narrows `ThumbnailService`
 * to one method.
 */

import type { DownloadRef } from '../adapters/base-adapter'
import { createStorageManager } from '../storage/storage-manager'

/**
 * What the pinned branch asks for.
 *
 * A structural subset of `StorageDownloadParams`, minus `range` — nothing on the
 * attachment path has ever asked for a byte range, and a port should name what
 * its caller uses.
 */
export interface LocationDownloadParams {
  /** The `StorageLocation.id` to serve. */
  locationId: string
  /** Overrides the filename the provider would infer from the key. */
  filename?: string
  /** Overrides the mime type stored on the location row. */
  mimeType?: string
  /** Presigned-URL lifetime. */
  ttlSec?: number
  /** How the browser should treat the response. */
  disposition?: 'inline' | 'attachment'
}

/** Resolve a `StorageLocation` id to something a browser can fetch. */
export interface LocationDownloadPort {
  getDownloadRef(params: LocationDownloadParams): Promise<DownloadRef>
}

/**
 * The production {@link LocationDownloadPort}, backed by `StorageManager`.
 *
 * Build one per request scope and reuse it: `StorageManager` caches its adapters
 * (and through them their `S3Client`s), so constructing one per call rebuilds a
 * client per download.
 *
 * @param organizationId The tenant whose credentials resolve the provider auth.
 */
export function createStorageManagerLocationPort(organizationId: string): LocationDownloadPort {
  const manager = createStorageManager(organizationId)
  return {
    getDownloadRef: (params) => manager.getDownloadRef(params),
  }
}
