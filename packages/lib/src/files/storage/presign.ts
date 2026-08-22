// packages/lib/src/files/storage/presign.ts

/**
 * Handing a client permission to write bytes — and the policy that bounds it.
 *
 * Four functions: the single-shot presign, the multipart trio's start / part /
 * complete, and the pure {@link enforceUploadPolicy} they are all built on.
 * Every one takes a {@link StoragePort} rather than constructing an adapter, so
 * a test supplies a plain object literal (`files/__tests__/support/storage.ts`)
 * and calls `vi.mock` zero times.
 *
 * ## The policy is enforced HERE, not on the port
 *
 * `StoragePort.presignUpload` and `StoragePort.startMultipart` are raw adapter
 * calls: they sign whatever they are handed. {@link presignUpload} and
 * {@link startMultipartUpload} are the sanctioned doors, because they call
 * {@link enforceUploadPolicy} first. Reaching for `deps.storage.presignUpload(...)`
 * directly from a route or a processor skips the key-prefix, TTL, size and MIME
 * checks — do not.
 *
 * ## Single uploads are re-enforced by S3. Multipart uploads are NOT.
 *
 * This asymmetry is the reason `validateCompletedUpload` exists, and it was
 * undocumented until now:
 *
 * - **Single.** `S3Adapter.presignUpload` signs a *presigned POST* whose policy
 *   document carries `['content-length-range', 0, size]` and a `Content-Type`
 *   condition. S3 itself rejects the upload if the client sends more bytes or a
 *   different type, so for this path {@link enforceUploadPolicy} is a real gate:
 *   whatever it allows is what S3 will accept, and nothing wider. (The
 *   zero-`size` branch signs a plain PUT instead, which carries no
 *   content-length condition — so even "single" is only as strong as the
 *   `expectedSize` the caller declared.)
 *
 * - **Multipart.** `CreateMultipartUpload` takes no policy document at all.
 *   `presignPart` signs `UploadPart` for one part number and S3 enforces only
 *   the 5 GiB per-part ceiling; nothing constrains the *total* size or the
 *   actual content type. A client that declares a 2 MB `image/png`, gets a
 *   multipart plan, and then pushes 4 GB of anything will succeed at every S3
 *   call. For this path {@link enforceUploadPolicy} is **advisory** — it bounds
 *   what we agreed to, not what can happen.
 *
 * The real gate for multipart is therefore the `headObject` the completion route
 * runs *after* the bytes land: `size` and `mimeType` come back from S3 itself,
 * and `validateCompletedUpload` is what makes the client's declaration binding —
 * `BaseUploadProcessor` fails the completion when the head disagrees with the
 * session's `expectedSize`/`mimeType`, and `BaseAssetProcessor` additionally
 * re-checks the processor's own size ceiling and MIME allow-list. Removing that
 * check does not lose a redundant validation; it loses the only one multipart
 * has.
 */

import type { Result } from 'neverthrow'
import { type AuxxError, BadRequestError } from '../../errors'
import type { MultipartUpload, PresignedUpload } from '../adapters/base-adapter'
import type { UploadPolicy } from '../upload/init-types'
import { storageGuard } from './errors'
import type {
  CompleteMultipartParams,
  PresignPartParams,
  PresignUploadParams,
  StoragePort,
} from './ports'

/**
 * The four facts {@link enforceUploadPolicy} judges.
 *
 * A structural subset of `UploadPreparedConfig`, so the prepared config passes
 * unchanged and no caller has to project it. Named separately because the policy
 * check must not be able to read anything else — it has no business knowing the
 * organization, the entity, or the bucket.
 */
export interface UploadCandidate {
  /** The full object key the client will write to. */
  storageKey: string
  /** Requested signature lifetime, in seconds. */
  ttlSec: number
  /** Size the client declared. For multipart this is a claim, not a constraint. */
  expectedSize: number
  /** Content type the client declared. Same caveat. */
  mimeType: string
}

/** What multipart completion reports back. S3 returns no size, hence the optional. */
export interface MultipartCompletion {
  etag: string
  size?: number
}

/**
 * Check an upload against its policy. Pure: no `ctx`, no `deps`, no clock, no
 * `Result` — there is nothing here that can fail for any reason other than the
 * data it was handed.
 *
 * Throws on the first violation rather than collecting them, matching the
 * `StorageManager.enforcePolicy` it replaces: the client gets one reason, and
 * the checks are ordered cheapest-first.
 *
 * The key check is a plain `startsWith`, **not** a canonicalised path compare.
 * `org123/../../../etc/passwd` passes it. That is deliberate and defence in
 * depth lives at the adapter/S3 layer, where the key is an opaque object name
 * and `..` has no meaning — but it means this function must never be described
 * as path containment.
 *
 * MIME matching supports `type/subtype`, a `type/*` family wildcard, and `*​/*`.
 *
 * @throws {BadRequestError} on the first rule the candidate breaks.
 */
export function enforceUploadPolicy(policy: UploadPolicy, candidate: UploadCandidate): void {
  if (!candidate.storageKey.startsWith(policy.keyPrefix)) {
    throw new BadRequestError(`Key must start with '${policy.keyPrefix}'`)
  }

  if (candidate.ttlSec > policy.maxTtl) {
    throw new BadRequestError(`TTL exceeds ${policy.maxTtl}s`)
  }

  const [min, max] = policy.contentLengthRange
  if (candidate.expectedSize < min || candidate.expectedSize > max) {
    throw new BadRequestError(`Size ${candidate.expectedSize} outside [${min}, ${max}]`)
  }

  const allowed = policy.allowedMimeTypes.some((entry) => {
    if (entry === '*/*') return true
    if (entry.endsWith('/*')) return candidate.mimeType.startsWith(entry.slice(0, -2))
    return candidate.mimeType === entry
  })

  if (!allowed) {
    throw new BadRequestError(`MIME '${candidate.mimeType}' not allowed`)
  }
}

/**
 * Presign a single-shot upload, after enforcing the plan's own policy.
 *
 * @param port Storage. The port signs; it does not judge — see the file header.
 * @param plan The prepared upload config. It carries its `policy`, so there is
 *   no way to presign against a policy other than the one the processor chose.
 */
export async function presignUpload(
  port: StoragePort,
  plan: PresignUploadParams
): Promise<Result<PresignedUpload, AuxxError>> {
  return storageGuard(
    async () => {
      enforceUploadPolicy(plan.policy, plan)
      return port.presignUpload(plan)
    },
    'Failed to presign upload',
    { provider: plan.provider, storageKey: plan.storageKey, bucket: plan.bucket }
  )
}

/**
 * Open a multipart upload, after enforcing the plan's own policy.
 *
 * The policy is advisory from here on — see the file header. The bucket this
 * starts in is the bucket every later {@link presignPart} and
 * {@link completeMultipart} must name, or S3 answers `NoSuchUpload`.
 */
export async function startMultipartUpload(
  port: StoragePort,
  plan: PresignUploadParams
): Promise<Result<MultipartUpload, AuxxError>> {
  return storageGuard(
    async () => {
      enforceUploadPolicy(plan.policy, plan)
      return port.startMultipart(plan)
    },
    'Failed to start multipart upload',
    { provider: plan.provider, storageKey: plan.storageKey, bucket: plan.bucket }
  )
}

/**
 * Presign one part of an in-flight multipart upload.
 *
 * No policy check: there is no policy on this call. The part's size is bounded
 * only by S3's own 5 GiB per-part limit, and the upload's total size is bounded
 * by nothing until `headObject` after completion.
 *
 * @param p `bucket` must be the bucket the upload was started in.
 */
export async function presignPart(
  port: StoragePort,
  p: PresignPartParams
): Promise<Result<PresignedUpload, AuxxError>> {
  return storageGuard(async () => port.presignPart(p), 'Failed to presign upload part', {
    provider: p.provider,
    key: p.key,
    bucket: p.bucket,
    partNumber: p.partNumber,
  })
}

/**
 * Finalise a multipart upload. Writes no database row — the caller does that
 * inside its own transaction, from the `headObject` that follows.
 *
 * @param p `bucket` must be the bucket the upload was started in.
 */
export async function completeMultipart(
  port: StoragePort,
  p: CompleteMultipartParams
): Promise<Result<MultipartCompletion, AuxxError>> {
  return storageGuard(
    async () => port.completeMultipart(p),
    'Failed to complete multipart upload',
    { provider: p.provider, key: p.key, bucket: p.bucket, parts: p.parts.length }
  )
}
