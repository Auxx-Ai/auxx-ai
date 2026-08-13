// packages/credentials/src/store/types.ts

/**
 * Which credential family owns a row. The owner is decided by which FK is set
 * (`app ⟺ appId`, `mcp ⟺ mcpServerId`); `connection` covers everything else
 * (channels, AI keys, platform providers) — a ConnectionDefinition-backed credential
 * with no owner FK. Replaces the legacy `integration`/`workflow` split.
 */
export type CredentialKind = 'app' | 'mcp' | 'connection'

/**
 * Row shape minus `encryptedSecrets` — safe to return anywhere.
 * `metadata` holds the plaintext non-secret companion data (scopes, account email, …).
 */
export interface CredentialRecord {
  id: string
  organizationId: string
  kind: CredentialKind
  type: string | null
  userId: string | null
  appId: string | null
  appInstallationId: string | null
  mcpServerId: string | null
  connectionDefinitionId: string | null
  /** Primary org-scoped app connection used by unbound (record-action) resolution. */
  isDefault: boolean
  name: string
  label: string | null
  metadata: Record<string, unknown>
  expiresAt: Date | null
  lastRefreshAt: Date | null
  lastRefreshFailureAt: Date | null
  /** Raw provider text from the most recent failed refresh — recorded for every failure. */
  lastRefreshError: string | null
  consecutiveRefreshFailures: number
  createdById: string | null
  createdAt: Date
  updatedAt: Date
}

/** A `CredentialRecord` plus the name of whoever created it (for the credentials UI list). */
export interface CredentialRecordWithCreator extends CredentialRecord {
  createdByName: string | null
}

export type CredentialStoreError = {
  code: 'CREDENTIAL_NOT_FOUND' | 'DATABASE_ERROR' | 'DECRYPTION_ERROR' | 'ENCRYPTION_ERROR'
  message: string
}
