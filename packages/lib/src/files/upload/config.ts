// packages/lib/src/files/upload/config.ts

/**
 * Turning an upload request into the config the rest of the pipeline runs on —
 * and checking, once, that a set of file facts satisfies a policy.
 *
 * ## The chain this replaces
 *
 * `processConfig` was a four-level `super` chain. `BaseProcessor` built a
 * permissive config and froze it; `BaseAssetProcessor` spread it, clamped the
 * policy, re-validated, and froze it again; `BaseAttachmentProcessor` spread it
 * and required an `entityId`; each concrete processor spread it once more to
 * change a bucket, a threshold or a MIME list. Reading four implementations
 * across three files was the only way to learn what an article cover's config
 * actually was, and every level could — and did — contradict the one below it.
 *
 * {@link buildUploadConfig} is that whole chain as one readable sequence:
 * normalize the request → normalize the MIME type → resolve visibility →
 * resolve the bucket → derive the storage key → clamp the TTL → build the
 * policy → enforce it → choose single or multipart.
 *
 * ## Pure, and why that is worth the parameter
 *
 * No `ctx`, no `deps`, no `Result`, and `now` arrives as an argument rather than
 * being read off `Date.now()` — the storage key embeds a timestamp, so a
 * function that reads the clock cannot have its key asserted without
 * process-global fake timers. It throws rather than returning a `Result`
 * because nothing in it can fail for an I/O reason; the only failure is "the
 * request breaks this entity's policy", which is the caller's 422.
 *
 * The one genuinely impure piece of configuration — `CUSTOM_FIELD` narrowing
 * its MIME list from the org cache — is `UploadHandler.refineConfig`, applied by
 * `prepareUpload` *after* this function. Keeping it out here is what makes the
 * policy decision a table of data.
 *
 * ## The policy rules live in exactly one place
 *
 * {@link enforceUploadPolicy} (`storage/presign.ts`) is the rule engine, and it
 * is called from here rather than reimplemented. That matters more than it
 * looks: `BaseAssetProcessor` had its own size comparison and its own
 * `isAllowedMimeType`, so the *declared* file was judged by one implementation
 * and the *delivered* file by another, against lists that could differ. Both
 * paths now go through the same function — {@link buildUploadConfig} passes the
 * declared facts, {@link validateCompletedUpload} passes what `headObject`
 * reported. That is the "one function, called twice" of the plan's §4.3.
 *
 * ## Why the post-upload check still exists
 *
 * Read the header of `storage/presign.ts`. A single-shot upload is signed as a
 * presigned POST whose policy document re-enforces size and content type, so S3
 * itself rejects a client that lies — except in the zero-`size` branch, which
 * signs a plain PUT with no condition at all. A multipart upload carries **no**
 * policy document: nothing bounds the total size or the true content type until
 * the `headObject` after the bytes land. For that path
 * {@link validateCompletedUpload} is not a redundant second opinion, it is the
 * only opinion.
 */

import { BadRequestError, UnprocessableEntityError } from '../../errors'
import { bucketForVisibility, type StorageVisibility } from '../storage/buckets'
import { enforceUploadPolicy } from '../storage/presign'
import type { UploadHandler } from './handlers/types'
import type { UploadInitConfig, UploadPlan, UploadPolicy, UploadPreparedConfig } from './init-types'
import type { PresignedUploadSession } from './session-types'
import { clamp, deriveStorageKey, getDefaultKeyPrefix, normalizeMimeType } from './util'

/** Size at or above which an upload is planned as multipart, absent a handler override. */
export const DEFAULT_MULTIPART_THRESHOLD_BYTES = 50 * 1024 * 1024

/** Signature lifetime used when the request does not ask for one. */
export const DEFAULT_TTL_SEC = 10 * 60

/** Floor on the signature lifetime. A signature too short to use is not a kindness. */
export const MIN_TTL_SEC = 60

/** The file facts a policy judges, once the bytes are either declared or delivered. */
export interface UploadFacts {
  /** Declared `expectedSize` before the upload; the `headObject` size after it. */
  size: number
  /**
   * Declared content type before the upload; what the provider reported after
   * it. Optional because not every provider returns a `Content-Type` on `HEAD`,
   * and an absent one is not a violation.
   */
  mimeType?: string
}

/**
 * Build the prepared config for one upload request.
 *
 * Pure. `now` is used for the timestamp embedded in the storage key and nothing
 * else.
 *
 * @param handler The entity type's declared upload rules.
 * @param init The client's request, already parsed and org-scoped.
 * @param now The clock, injected so the derived key is reproducible.
 * @throws {UnprocessableEntityError} when the request breaks the handler's policy.
 */
export function buildUploadConfig(
  handler: UploadHandler,
  init: UploadInitConfig,
  now: () => Date
): UploadPreparedConfig {
  // 1. The handler's own pure rewrite of the request, first — the storage key,
  //    the visibility function and the policy all read what it produces.
  const request = handler.normalizeInit ? handler.normalizeInit(init) : init

  // 2. Normalize the MIME type once, and judge the normalized value.
  //    `BaseAssetProcessor` checked its allow-list against the RAW `init.mimeType`
  //    while the policy it emitted carried the normalized one, so `Image/PNG`
  //    was refused at the front door and accepted by the policy behind it.
  const mimeType = normalizeMimeType(request.mimeType)

  // 3. Visibility, then the bucket it implies.
  const visibility: StorageVisibility =
    typeof handler.visibility === 'function' ? handler.visibility(request) : handler.visibility

  // `bucketForVisibility` answers '' when the bucket is not configured. That is
  // not an error here: this is a *pre-storage* config, and `StorageManager`
  // still resolves a bucket from the provider's credential for BYO-credential
  // organizations that never set `S3_PUBLIC_BUCKET`. The rule that a bucket is
  // never optional binds at the storage call itself, where `assertBucket` runs.
  const bucket = bucketForVisibility(visibility)

  // 4. The storage key: {orgId}/{entity-type}/{entityId}/{ts}_{seed}{filename}.
  const storageKey = deriveStorageKey(request.organizationId, request.fileName, {
    entityType: request.entityType,
    entityId: request.entityId || 'temp',
    keySeed: request.keySeed,
    nowMs: now().getTime(),
  })

  // 5. Clamp the TTL to the handler's own ceiling.
  //    The chain clamped to a fixed [60, 3600] and then wrote `maxTtl: 600` into
  //    the policy, so any request asking for more than ten minutes on an
  //    asset-backed entity produced a config that failed its own policy check at
  //    presign time. Clamping to `maxTtlSec` makes that unrepresentable.
  const ttlSec = clamp(request.ttlSec ?? DEFAULT_TTL_SEC, MIN_TTL_SEC, handler.maxTtlSec)

  // 6. The policy, straight off the handler's declarative fields.
  const policy: UploadPolicy = {
    keyPrefix: getDefaultKeyPrefix(request.organizationId),
    contentLengthRange: [0, handler.maxFileSize],
    maxTtl: handler.maxTtlSec,
    allowedMimeTypes: [...handler.allowedMimeTypes],
  }

  // 7. Enforce it against what was declared, using the same function the signer
  //    will use. A prepared config that survives this cannot be refused later.
  asUnprocessable(() =>
    enforceUploadPolicy(policy, {
      storageKey,
      ttlSec,
      expectedSize: request.expectedSize,
      mimeType,
    })
  )

  // 8. Single or multipart.
  const threshold = handler.multipartThresholdBytes ?? DEFAULT_MULTIPART_THRESHOLD_BYTES
  const uploadPlan: UploadPlan =
    request.expectedSize >= threshold ? { strategy: 'multipart' } : { strategy: 'single' }

  return Object.freeze({
    ...request,
    mimeType,
    provider: request.provider ?? 'S3',
    storageKey,
    ttlSec,
    policy,
    uploadPlan,
    visibility,
    bucket,
  })
}

/**
 * Check a completed upload against what was promised for it.
 *
 * Two questions, in this order:
 *
 * 1. **Did we get the file we were told about?** An exact size match and a
 *    parameter-insensitive MIME match against the session's own declaration.
 * 2. **Is that file allowed at all?** The session's persisted `policy`, judged
 *    by the same {@link enforceUploadPolicy} that judged the declaration.
 *
 * The second question used to be `BaseAssetProcessor`'s own re-implementation of
 * the size and MIME rules, comparing against the *processor's* fields rather
 * than the session's policy. Reading the policy instead is what makes a
 * `CUSTOM_FIELD` upload's per-field MIME narrowing survive to the end of the
 * upload rather than applying only to the presign.
 *
 * Pure, and deliberately not `async`: it has never had anything to await.
 *
 * @throws {UnprocessableEntityError} when the delivered file breaks either rule.
 */
export function validateCompletedUpload(
  session: Pick<PresignedUploadSession, 'expectedSize' | 'mimeType' | 'policy'>,
  head: UploadFacts
): void {
  if (typeof session.expectedSize === 'number' && head.size !== session.expectedSize) {
    throw new UnprocessableEntityError(
      `Size mismatch: expected ${session.expectedSize}, got ${head.size}`
    )
  }

  const delivered = head.mimeType ? normalizeMimeType(head.mimeType) : undefined
  const declared = session.mimeType ? normalizeMimeType(session.mimeType) : undefined
  if (declared && delivered && declared !== delivered) {
    throw new UnprocessableEntityError(`MIME mismatch: expected ${declared}, got ${delivered}`)
  }

  // Only the size and MIME rules describe the delivered bytes. The key was
  // chosen by us and the TTL bounded the signature, so both are neutralised
  // rather than re-judged — re-judging the TTL in particular would fail every
  // session signed before the ceiling that produced it changed.
  //
  // A provider that reports no `Content-Type` on HEAD makes the allow-list
  // unanswerable, not violated, so it is neutralised too. That matches what
  // `BaseAssetProcessor` did: `if (head.mimeType && !isAllowedMimeType(...))`.
  asUnprocessable(() =>
    enforceUploadPolicy(
      {
        ...session.policy,
        keyPrefix: '',
        maxTtl: Number.MAX_SAFE_INTEGER,
        allowedMimeTypes: delivered ? session.policy.allowedMimeTypes : ['*/*'],
      },
      { storageKey: '', ttlSec: 0, expectedSize: head.size, mimeType: delivered ?? '' }
    )
  )
}

/**
 * Run a policy check and restate its refusal as a 422.
 *
 * The rules are not reimplemented here — the whole point is that there is one
 * implementation — but the status differs by who is asking. `enforceUploadPolicy`
 * answers a signer, for whom a bad request is a 400. These two functions answer
 * an upload door, where the request is well-formed and the *file* is what cannot
 * be processed, which is a 422 (plan §4.3).
 */
function asUnprocessable(check: () => void): void {
  try {
    check()
  } catch (error) {
    if (error instanceof BadRequestError) {
      throw new UnprocessableEntityError(error.message)
    }
    throw error
  }
}
