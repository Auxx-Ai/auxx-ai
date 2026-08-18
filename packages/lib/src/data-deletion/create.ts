// packages/lib/src/data-deletion/create.ts
//
// Write path for `DataDeletionRequest`. Called synchronously from the callback
// routes (Meta `signed_request`, Shopify compliance HMAC) BEFORE the job is
// enqueued, because the confirmation code has to be in the 200 response body
// and has to stay resolvable afterwards.

import { type Database, schema } from '@auxx/database'
import type { Result } from 'neverthrow'
import { AuxxError } from '../errors'
import {
  type DataDeletionKind,
  type DataDeletionProvider,
  generateConfirmationCode,
} from './client'
import { guard } from './guard'

export interface CreateDeletionRequestInput {
  provider: DataDeletionProvider
  /** Meta app-scoped user id, or Shopify shop domain / customer id. */
  externalId: string
  kind: DataDeletionKind
}

export interface CreatedDeletionRequest {
  id: string
  confirmationCode: string
}

/**
 * Record one inbound deletion/deauthorize request and mint its public code.
 *
 * Deliberately NOT idempotent on `externalId`: Meta retries produce a second
 * row that resolves zero channels and completes cleanly, and a person may
 * connect → delete → reconnect → delete again, each of which is a real request
 * owed its own code (plan §7.7). Deduping here would silently swallow the
 * second one.
 */
export async function createDeletionRequest(
  db: Database,
  input: CreateDeletionRequestInput
): Promise<Result<CreatedDeletionRequest, Error>> {
  return guard(
    async () => {
      const confirmationCode = generateConfirmationCode()
      const [row] = await db
        .insert(schema.DataDeletionRequest)
        .values({
          confirmationCode,
          provider: input.provider,
          externalId: input.externalId,
          kind: input.kind,
          status: 'received',
          organizationIds: [],
          integrationIds: [],
        })
        .returning({ id: schema.DataDeletionRequest.id })

      if (!row) throw new AuxxError('Failed to record deletion request')
      return { id: row.id, confirmationCode }
    },
    'Failed to create deletion request',
    { provider: input.provider, kind: input.kind }
  )
}
