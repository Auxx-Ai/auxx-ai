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
  /**
   * The scope FLOOR — always requested, never removable. Carried so the picker can render
   * the full resulting scope string a BYO user must mirror in their own OAuth app
   * (`plans/connections/optional-oauth-scopes.md` §4.2).
   */
  oauth2Scopes: string[]
  /**
   * ADDITIVE scopes a connect attempt may request on top of the floor, disjoint from it.
   * Never requested unless named via `scope_add`; the server re-intersects against this
   * same list at authorize, so the picker is a hint, never the authority.
   */
  oauth2OptionalScopes: string[]
}

const METHOD_COLUMNS = {
  id: true,
  key: true,
  label: true,
  description: true,
  connectionType: true,
  global: true,
  connectionVariables: true,
  oauth2Scopes: true,
  oauth2OptionalScopes: true,
} as const

function toMethod(row: {
  id: string
  key: string | null
  label: string
  description: string | null
  connectionType: string
  global: boolean | null
  connectionVariables: ConnectionVariable[] | null
  oauth2Scopes: string[] | null
  oauth2OptionalScopes: string[] | null
}): ConnectionMethod {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    connectionType: row.connectionType,
    global: row.global ?? false,
    connectionVariables: row.connectionVariables ?? [],
    oauth2Scopes: row.oauth2Scopes ?? [],
    oauth2OptionalScopes: row.oauth2OptionalScopes ?? [],
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
