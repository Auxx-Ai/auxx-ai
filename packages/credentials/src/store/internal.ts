// packages/credentials/src/store/internal.ts
// Shared internals for the credential store. NOT exported from store/index.ts.

import { ResultAsync } from 'neverthrow'
import type { CredentialKind, CredentialRecord, CredentialStoreError } from './types'

/** Wrap a DB promise, mapping any throw to a DATABASE_ERROR store error. */
export function fromDb<T>(promise: Promise<T>, op: string): ResultAsync<T, CredentialStoreError> {
  return ResultAsync.fromPromise(
    promise,
    (cause): CredentialStoreError => ({
      code: 'DATABASE_ERROR',
      message: `Credential store operation "${op}" failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    })
  )
}

export const notFound = (id: string): CredentialStoreError => ({
  code: 'CREDENTIAL_NOT_FOUND',
  message: `Credential ${id} not found`,
})

export const decryptionError = (): CredentialStoreError => ({
  code: 'DECRYPTION_ERROR',
  message: 'Failed to decrypt credential secrets',
})

export const encryptionError = (): CredentialStoreError => ({
  code: 'ENCRYPTION_ERROR',
  message: 'Failed to encrypt credential secrets',
})

/** Row shape returned by a `SELECT *` on the Credential table. */
type CredentialRow = CredentialRecord & { encryptedSecrets: string }

/** Drop `encryptedSecrets` and normalize `kind`/`metadata` into a safe-to-return record. */
export function toRecord(row: CredentialRow): CredentialRecord {
  const { encryptedSecrets: _omit, ...rest } = row
  return {
    ...rest,
    kind: rest.kind as CredentialKind,
    metadata: (rest.metadata ?? {}) as Record<string, unknown>,
  }
}
