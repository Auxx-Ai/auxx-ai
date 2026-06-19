// packages/credentials/src/store/insert-credential.ts

import { database, schema } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { encryptSecrets } from '../crypto'
import { encryptionError, fromDb, toRecord } from './internal'
import type { CredentialKind, CredentialRecord, CredentialStoreError } from './types'

export interface InsertCredentialInput {
  organizationId: string
  createdById?: string | null
  kind: CredentialKind
  type?: string | null
  userId?: string | null
  appId?: string | null
  appInstallationId?: string | null
  mcpServerId?: string | null
  /** Direct FK to the provider blueprint (platform/app/mcp); null when resolved by owner instead. */
  connectionDefinitionId?: string | null
  /** Mark this the primary org-scoped app connection (record-action resolution). Default false. */
  isDefault?: boolean
  name: string
  label?: string | null
  /** Secret values — encrypted (v2) before storage. */
  secrets: Record<string, unknown>
  /** Plaintext non-secret companion data. */
  metadata?: Record<string, unknown>
  expiresAt?: Date | null
}

/**
 * Insert a new credential row. The ONLY INSERT into the Credential table.
 * Encrypts `secrets` with the v2 secret box; `metadata` is stored as plaintext jsonb.
 */
export async function insertCredential(
  input: InsertCredentialInput
): Promise<Result<CredentialRecord, CredentialStoreError>> {
  let encryptedSecrets: string
  try {
    encryptedSecrets = encryptSecrets(input.secrets)
  } catch {
    return err(encryptionError())
  }

  const now = new Date()
  const insertResult = await fromDb(
    database
      .insert(schema.Credential)
      .values({
        organizationId: input.organizationId,
        createdById: input.createdById ?? null,
        kind: input.kind,
        type: input.type ?? null,
        userId: input.userId ?? null,
        appId: input.appId ?? null,
        appInstallationId: input.appInstallationId ?? null,
        mcpServerId: input.mcpServerId ?? null,
        connectionDefinitionId: input.connectionDefinitionId ?? null,
        isDefault: input.isDefault ?? false,
        name: input.name,
        label: input.label ?? null,
        encryptedSecrets,
        metadata: input.metadata ?? {},
        expiresAt: input.expiresAt ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    'insert-credential'
  )

  if (insertResult.isErr()) return err(insertResult.error)
  return ok(toRecord(insertResult.value[0] as never))
}
