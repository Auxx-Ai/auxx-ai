// packages/lib/src/files/storage/objects.ts

/**
 * Server-side object I/O: put, get, stream, head, delete.
 *
 * Five functions over a {@link StoragePort}, and nothing else. No database, no
 * `FilesCtx`, no transaction — a function here cannot read a `StorageLocation`
 * row, and that is the property worth having: resolving a row into a bucket and
 * a key is the *caller's* job, on `ctx.db`, where the org scope is applied.
 * `StorageManager`'s equivalents (`getContent(locationId)`,
 * `streamFileContent(locationId)`, `deleteFile(locationId)`) each do their own
 * unscoped read behind the caller's back; these deliberately cannot.
 *
 * ## Every parameter type carries a required `bucket`
 *
 * Inherited from {@link ObjectRef} in `ports.ts`, and it is the whole point.
 * Bugs #1816/#1817/#1818 were one bug three times: `bucket` was optional, a call
 * site omitted it, the resolver fell back to `S3_PRIVATE_BUCKET`, and S3
 * answered `204 No Content` for a delete of a key that was never in the bucket
 * we named — so a PUBLIC upload's object leaked with no error and no log
 * anywhere. There is no bucket-less overload here and there must not be one.
 *
 * ## Errors keep their meaning
 *
 * These bodies do exactly one thing that can fail — call the port — and the
 * failure is always an adapter error. {@link storageGuard} maps
 * `StorageFileNotFoundError` to `NotFoundError`, `StorageAuthError` to
 * `UnauthorizedError` and the rest to `AuxxError`, preserving the message and
 * hanging the original off `cause`. The plain `files/guard.ts` would flatten all
 * three to `Internal error`; see `storage/errors.ts`.
 */

import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { storageGuard } from './errors'
import type {
  DeleteParams,
  GetObjectParams,
  HeadParams,
  HeadResult,
  PutObjectParams,
  PutResult,
  StoragePort,
} from './ports'

/**
 * Write content the server itself produced (a thumbnail, a rendered PDF, an
 * export) straight to storage.
 *
 * This writes **only the object**. It does not create a `StorageLocation` row —
 * `storage/locations.ts` does that, inside the caller's transaction, and the two
 * halves are separate because the object write must happen *before* the
 * transaction opens rather than inside it.
 *
 * @param p `bucket` is required. Pass the bucket the visibility routes to
 *   (`bucketForVisibility`), never a configured default.
 */
export async function putObject(
  port: StoragePort,
  p: PutObjectParams
): Promise<Result<PutResult, AuxxError>> {
  return storageGuard(async () => port.putObject(p), 'Failed to put object', {
    provider: p.provider,
    key: p.key,
    bucket: p.bucket,
    size: p.size,
  })
}

/**
 * Read a whole object into memory.
 *
 * Buffers the entire body, so it is for content the caller genuinely needs in
 * one piece (parsing, hashing, re-encoding). Use {@link streamObject} for
 * anything that is being forwarded to a response.
 */
export async function getObject(
  port: StoragePort,
  p: GetObjectParams
): Promise<Result<Buffer, AuxxError>> {
  return storageGuard(async () => port.getObject(p), 'Failed to get object', {
    provider: p.provider,
    key: p.key,
    bucket: p.bucket,
  })
}

/**
 * Open a read stream over an object.
 *
 * There is no range parameter, matching the port: `StorageManager.streamFileContent`
 * accepts one, logs `'Range support not yet implemented'` and returns the full
 * stream anyway. A parameter that is silently ignored is worse than one that
 * does not exist, so this signature does not offer it. Range support belongs on
 * the port and the adapter when something needs it.
 */
export async function streamObject(
  port: StoragePort,
  p: GetObjectParams
): Promise<Result<NodeJS.ReadableStream, AuxxError>> {
  return storageGuard(async () => port.streamObject(p), 'Failed to open object stream', {
    provider: p.provider,
    key: p.key,
    bucket: p.bucket,
  })
}

/**
 * Read an object's metadata without downloading it.
 *
 * This is the upload pipeline's real verification step: for a multipart upload
 * the presign-time policy is advisory (see `storage/presign.ts`), and the `size`
 * and `mimeType` that come back from here are the first numbers S3 itself
 * vouches for.
 */
export async function headObject(
  port: StoragePort,
  p: HeadParams
): Promise<Result<HeadResult, AuxxError>> {
  return storageGuard(async () => port.head(p), 'Failed to head object', {
    provider: p.provider,
    key: p.key,
    bucket: p.bucket,
  })
}

/**
 * Delete one object.
 *
 * Used for compensation (an upload whose transaction rolled back) and for
 * lifecycle sweeps. The `bucket` must be the bucket the object actually lives
 * in: S3 answers `204 No Content` for a delete of a key that is not in the
 * bucket you named, so a wrong-bucket delete looks exactly like a successful
 * one.
 *
 * Deleting the `StorageLocation` row is a separate step, and it comes second —
 * the row is the only pointer to the bytes, so dropping it first loses them.
 */
export async function deleteObject(
  port: StoragePort,
  p: DeleteParams
): Promise<Result<void, AuxxError>> {
  return storageGuard(async () => port.deleteObject(p), 'Failed to delete object', {
    provider: p.provider,
    key: p.key,
    bucket: p.bucket,
  })
}
