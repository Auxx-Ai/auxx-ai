// packages/services/src/app-connections/list-app-connection-definitions.ts

import { type ConnectionVariable, database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * One connection method an app exposes — a single `ConnectionDefinition` row. An app may
 * expose several (e.g. Stripe: API key OR OAuth2), and the org chooses among them at connect
 * time (the picker appears only when >1). `id` is the row id threaded to the credential FK so
 * the runtime resolves the exact method; `key` is the method's stable per-app identity.
 */
export interface ConnectionMethod {
  id: string
  key: string | null
  label: string
  description: string | null
  connectionType: string
  /** true = organization-wide, false = user-specific. A property of the method. */
  global: boolean
  connectionVariables: ConnectionVariable[]
}

const METHOD_COLUMNS = {
  id: true,
  key: true,
  label: true,
  description: true,
  connectionType: true,
  global: true,
  connectionVariables: true,
} as const

function toMethod(row: {
  id: string
  key: string | null
  label: string
  description: string | null
  connectionType: string
  global: boolean | null
  connectionVariables: ConnectionVariable[] | null
}): ConnectionMethod {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    connectionType: row.connectionType,
    global: row.global ?? false,
    connectionVariables: row.connectionVariables ?? [],
  }
}

/**
 * List every connection method an app exposes (one per `ConnectionDefinition` row).
 * Replaces the per-scope `getAppConnectionDefinition(appId, global)` two-slot lookup — the
 * consume side now renders a flat list of methods and resolves by method id, not by scope.
 */
export async function listAppConnectionDefinitions(appId: string) {
  const result = await fromDatabase(
    database.query.ConnectionDefinition.findMany({
      where: (d, { eq }) => eq(d.appId, appId),
      columns: METHOD_COLUMNS,
    }),
    'list-app-connection-definitions'
  )
  if (result.isErr()) return result
  return ok(result.value.map(toMethod))
}

/**
 * Load a single connection method by its row id, scoped to the app it belongs to.
 * The connect flow passes the picked method's id; this is the authoritative lookup
 * for validating connection variables and deriving scope on save.
 */
export async function getConnectionDefinitionById(appId: string, connectionDefinitionId: string) {
  const result = await fromDatabase(
    database.query.ConnectionDefinition.findFirst({
      where: (d, { eq, and }) => and(eq(d.id, connectionDefinitionId), eq(d.appId, appId)),
      columns: METHOD_COLUMNS,
    }),
    'get-connection-definition-by-id'
  )
  if (result.isErr()) return result
  if (!result.value) {
    return err({
      code: 'CONNECTION_DEFINITION_NOT_FOUND',
      message: 'Connection definition not found',
      appId,
      connectionDefinitionId,
    })
  }
  return ok(toMethod(result.value))
}
