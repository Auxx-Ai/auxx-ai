// packages/lib/src/files/storage/auth.ts

/**
 * Provider credential resolution — the single implementation.
 *
 * There were two. `StorageManager.getProviderAuth` was `private`, so
 * `createS3StoragePort` in `ports.ts` could not reach it and reimplemented the
 * same twenty lines with different error classes and a different bucket policy.
 * Two copies of "which credential does this object use" is exactly the drift
 * `plans/attachments/03-storage-layer.md` §3.0.1 flagged: the port pinned
 * `auth.bucket` to the caller's bucket, the manager did not, and which one you
 * got depended on which door you came through.
 *
 * ## `bucket` is pinned, not resolved
 *
 * `S3Adapter.parseS3Location`, `createS3Client` and `buildExternalUrl` all read
 * `auth.bucket`. Leaving it to come from the credential record (or from
 * `S3_PRIVATE_BUCKET` via `resolvePlatformAuth`) is how a PUBLIC upload's
 * object ended up addressed against the private bucket. Callers that know the
 * bucket — which after Phase 1 is all of them on the object paths — pass it and
 * it overwrites whatever the credential said.
 *
 * ## Errors are `AuxxError`, not `StorageAuthError`
 *
 * `StorageAuthError` extends `StorageAdapterError extends Error`, so a router
 * seeing one produces a generic 500. Per `docs/lib-module-guide.md` lib throws
 * `AuxxError` subclasses; `StorageManager.handleStorageError` still re-wraps
 * these into `StorageAdapterError` for its own legacy callers, so the facade's
 * throw shape is unchanged.
 */

import { revealSecrets } from '@auxx/credentials/store'
import { BadRequestError, UnauthorizedError } from '../../errors'
import type { ProviderAuth, ProviderId } from '../adapters/base-adapter'
import { getStorageAdapter } from './providers'

export interface ResolveProviderAuthParams {
  provider: ProviderId
  /** Required only when `credentialId` is set — platform storage has no org. */
  organizationId?: string
  /** A user-connected credential. Absent means platform storage. */
  credentialId?: string
  /**
   * Overwrites `auth.bucket` on the resolved credential. Pass it whenever the
   * bucket is known: see the file header for why.
   */
  bucket?: string
}

/**
 * Resolve the credential a storage operation should run under.
 *
 * 1. `credentialId` → the org's own connected provider, via the credential store.
 * 2. otherwise → platform storage, via `adapter.resolvePlatformAuth()`.
 *
 * @throws {BadRequestError} when a `credentialId` is supplied without an
 *   organization, or when neither a credential nor platform config is available.
 * @throws {UnauthorizedError} when the credential exists but cannot be revealed.
 */
export async function resolveProviderAuth(
  params: ResolveProviderAuthParams
): Promise<ProviderAuth> {
  const { provider, organizationId, credentialId, bucket } = params

  if (credentialId) {
    if (!organizationId) {
      throw new BadRequestError(
        `credentialId '${credentialId}' was supplied for ${provider} but no organizationId was`
      )
    }

    const revealed = await revealSecrets(credentialId, organizationId)
    if (revealed.isErr()) {
      throw new UnauthorizedError(
        `Failed to load ${provider} credential '${credentialId}': ${revealed.error.message}`
      )
    }

    const { record, secrets } = revealed.value
    return {
      ...(record.metadata as Record<string, unknown>),
      ...secrets,
      ...(bucket && { bucket }),
    } as ProviderAuth
  }

  const adapter = await getStorageAdapter(provider)
  const platformAuth = adapter.resolvePlatformAuth?.()
  if (!platformAuth) {
    throw new BadRequestError(
      `No credentials available for ${provider}. Configure platform storage ` +
        '(for S3: S3_REGION and S3_PRIVATE_BUCKET) or supply a credentialId.'
    )
  }

  return { ...platformAuth, ...(bucket && { bucket }) }
}
