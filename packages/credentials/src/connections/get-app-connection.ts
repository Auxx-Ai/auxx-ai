// packages/credentials/src/connections/get-app-connection.ts

import { err, ok } from 'neverthrow'
import { findCredential, revealSecrets } from '../store'
import {
  type CredentialLockProvider,
  ensureFreshCredentialToken,
} from './ensure-fresh-credential-token'
import type { DecryptedConnectionData } from './types'

/** The secret keys this module reads directly; the rest pass through untyped. */
interface AppConnectionSecrets {
  accessToken?: string
  refreshToken?: string
  secret?: string
  fields?: Record<string, string>
}

/**
 * Get connection for app (used when executing app functions).
 *
 * Retrieves and decrypts the app connection credentials for a specific user and organization,
 * with a fallback hierarchy: a user-scoped connection first, then the org-scoped one. This
 * supports both personal user connections (e.g. a personal Gmail account) and shared
 * organization connections (e.g. a company Gmail account).
 *
 * **Refresh-on-use.** Before returning, the credential is passed through
 * {@link ensureFreshCredentialToken}, so a token at or near expiry is renewed rather than handed
 * out dead. This matters for providers with short-lived tokens — Shopify's expiring offline
 * access tokens live 60 minutes — where the scheduled refresh scanner alone leaves a window in
 * which the stored token has expired but has not yet been refreshed.
 *
 * Pass `options.lock` (see `createCredentialLockProvider` in `@auxx/redis`) to make concurrent
 * refreshes single-flight. Omitting it still refreshes, just unserialised.
 *
 * @param appId - The app that needs credentials.
 * @param organizationId - Required for access control and credential decryption.
 * @param userId - Used to look up user-scoped connections first. Pass `''` for no user context.
 * @param options.lock - Optional single-flight lock for the refresh.
 *
 * @returns A Result with the decrypted connection data, or `CONNECTION_NOT_FOUND` /
 *          a store error.
 *
 * @example
 * const result = await getAppConnection('gmail-app-id', 'org-123', 'user-456')
 * if (result.isOk()) await sendEmail(result.value.accessToken, emailData)
 */
export async function getAppConnection(
  appId: string,
  organizationId: string,
  userId: string,
  options?: { lock?: CredentialLockProvider | null }
) {
  // Try user-scoped connection first, then fall back to the org-scoped one. Newest wins —
  // duplicates can accumulate (e.g. an OAuth provider that issues a fresh token per
  // (re)connect), and an older row's token is typically revoked once a newer one is issued.
  const userResult = await findCredential({ organizationId, kind: 'app', appId, userId })
  if (userResult.isErr()) return err(userResult.error)

  let record = userResult.value
  if (!record) {
    const orgResult = await findCredential({ organizationId, kind: 'app', appId, userId: null })
    if (orgResult.isErr()) return err(orgResult.error)
    record = orgResult.value
  }

  if (!record) {
    return err({
      code: 'CONNECTION_NOT_FOUND',
      message: 'Connection not found',
      appId,
      organizationId,
      userId,
    })
  }

  let revealed = await revealSecrets<AppConnectionSecrets>(record.id, organizationId)
  if (revealed.isErr()) return err(revealed.error)

  // Renew at/near expiry, then re-read whatever the refresh persisted. Never throws — on failure
  // the stored token is returned unchanged and the caller's 401 path owns it.
  const changed = await ensureFreshCredentialToken({
    credentialId: revealed.value.record.id,
    organizationId,
    expiresAt: revealed.value.record.expiresAt,
    lastRefreshAt: revealed.value.record.lastRefreshAt,
    createdAt: revealed.value.record.createdAt,
    hasRefreshToken: !!revealed.value.secrets.refreshToken,
    lock: options?.lock,
  })
  if (changed) {
    const refreshed = await revealSecrets<AppConnectionSecrets>(record.id, organizationId)
    if (refreshed.isOk()) revealed = refreshed
  }

  // Preserve the legacy "full data" shape: non-secret companion fields flattened to the top
  // level, secrets layered on top (secrets win on key collisions). Spreading two
  // index-signature types erases every named key, so the shape is asserted once here
  // rather than at each call site.
  return ok({
    ...revealed.value.record.metadata,
    ...revealed.value.secrets,
  } as DecryptedConnectionData)
}
