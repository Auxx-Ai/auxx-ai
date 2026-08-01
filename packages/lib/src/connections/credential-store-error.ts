// packages/lib/src/connections/credential-store-error.ts

import type { CredentialStoreError } from '@auxx/credentials/store'
import { AuxxError, NotFoundError } from '../errors'

/**
 * `@auxx/credentials/store` fails with a plain `{ code, message }` object rather than an `Error`,
 * so every caller that declares `Result<T, Error>` has to convert at the boundary. Passing the raw
 * object through is not merely a type mismatch: callers do `throw result.error` (see
 * `ai/providers/config/mutations.ts`), and throwing a non-Error loses the stack and makes tRPC
 * report a generic "Internal server error" instead of the store's message.
 */
export function toCredentialError(error: CredentialStoreError): AuxxError {
  return error.code === 'CREDENTIAL_NOT_FOUND'
    ? new NotFoundError(error.message)
    : new AuxxError(error.message)
}
