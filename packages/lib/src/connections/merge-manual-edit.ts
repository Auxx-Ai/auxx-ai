// packages/lib/src/connections/merge-manual-edit.ts

import {
  getCredential,
  mergeSecretFields,
  mergeSecrets,
  updateCredential,
} from '@auxx/credentials/store'
import { err, ok, type Result } from 'neverthrow'

/**
 * Apply a manual secret edit to an existing connection by MERGING, never replacing — so editing
 * one field never clobbers the others. Shared by the platform (`saveConnection`) and app
 * (`saveAppConnection`) reconnect paths.
 *
 * - Multi-field secrets merge into the nested `secrets.fields` bag (`mergeSecretFields`).
 * - A bare API key merges at `secrets.secret` (`mergeSecrets`).
 * - Plain variables merge into `metadata.connectionVariables` (read-modify-write).
 *
 * Each merge keeps the existing value for any key the form left blank/sentinel-resolved (the caller
 * is expected to have already dropped the `HIDDEN_VALUE` sentinel via `resolveForWrite`).
 */
export async function mergeManualConnectionEdit(
  connectionId: string,
  organizationId: string,
  edit: {
    secretFields?: Record<string, string>
    secret?: string
    plainVariables?: Record<string, unknown>
  }
): Promise<Result<void, Error>> {
  if (edit.secretFields && Object.keys(edit.secretFields).length > 0) {
    const merged = await mergeSecretFields(connectionId, organizationId, edit.secretFields)
    if (merged.isErr()) return err(merged.error)
  }

  if (edit.secret !== undefined) {
    const merged = await mergeSecrets(connectionId, organizationId, { secret: edit.secret })
    if (merged.isErr()) return err(merged.error)
  }

  const plainVariables = edit.plainVariables ?? {}
  if (Object.keys(plainVariables).length > 0) {
    const current = await getCredential(connectionId, organizationId)
    if (current.isErr()) return err(current.error)

    const existingMeta = (current.value.metadata ?? {}) as Record<string, unknown>
    const existingVars = (existingMeta.connectionVariables ?? {}) as Record<string, unknown>
    const metadata = {
      ...existingMeta,
      connectionVariables: { ...existingVars, ...plainVariables },
    }

    const updated = await updateCredential(connectionId, organizationId, { metadata })
    if (updated.isErr()) return err(updated.error)
  }

  return ok(undefined)
}
