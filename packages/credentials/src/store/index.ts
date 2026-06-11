// packages/credentials/src/store/index.ts
// Functional credential store — the only module that touches the Credential table.

export { deleteCredential } from './delete-credential'
export { type FindCredentialInput, findCredential } from './find-credential'
export { getCredential } from './get-credential'
export { type InsertCredentialInput, insertCredential } from './insert-credential'
export { type ListCredentialsInput, listCredentials } from './list-credentials'
export { mergeSecrets } from './merge-secrets'
export { recordRefreshFailure, recordRefreshSuccess } from './record-refresh'
export { revealSecrets } from './reveal-secrets'
export { rotateSecrets } from './rotate-secrets'
export { splitSensitiveFields } from './split-sensitive-fields'
export type {
  CredentialKind,
  CredentialRecord,
  CredentialRecordWithCreator,
  CredentialStoreError,
} from './types'
export { type UpdateCredentialInput, updateCredential } from './update-credential'
