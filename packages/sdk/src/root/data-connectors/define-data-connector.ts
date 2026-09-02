// packages/sdk/src/root/data-connectors/define-data-connector.ts

import type { z } from 'zod/v4'
import type { ConnectorMapping, DataConnectorDefinition } from './types.js'

/** Connector id regex — dotted lowercase segments, e.g. `shopify.core`. */
const CONNECTOR_ID_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/

/**
 * Validate one mapping's local shape — everything a single connector module
 * can check without seeing the app's other modules. Cross-module checks
 * (does `entityKey` resolve to a declared `defineEntity`? does an owned
 * field's `key` exist on that entity? does `appField` name a declared
 * `defineFields` field?) are the catalog extractor's job, where the whole
 * app is visible at once — see `compile-and-extract-catalog.ts`.
 */
function assertValidMapping(
  connectorId: string,
  streamKey: string,
  mapping: ConnectorMapping
): void {
  // Read through `unknown` — authors call this from plain JS too, so the
  // runtime shape isn't guaranteed to match the TS discriminated union.
  const target = mapping.target as { entityKey?: unknown; entityKind?: unknown }
  const hasEntityKey = 'entityKey' in target
  const hasEntityKind = 'entityKind' in target
  if (hasEntityKey === hasEntityKind) {
    throw new Error(
      `defineDataConnector: connector "${connectorId}" stream "${streamKey}" mapping "${mapping.rootPath}": target must name exactly one of entityKey or entityKind`
    )
  }

  if (hasEntityKey) {
    if ((mapping as { connectionFields?: unknown }).connectionFields) {
      throw new Error(
        `defineDataConnector: connector "${connectorId}" stream "${streamKey}" mapping "${mapping.rootPath}": connectionFields is only valid on a contributing (entityKind) mapping`
      )
    }
    for (const field of mapping.fields ?? []) {
      const owned = field as { key?: unknown; sourcePath?: unknown }
      if (!owned.key || !owned.sourcePath) {
        throw new Error(
          `defineDataConnector: connector "${connectorId}" stream "${streamKey}" mapping "${mapping.rootPath}": every owned field needs a key and a sourcePath`
        )
      }
    }
    return
  }

  const contributing = mapping as {
    fields?: Array<{
      sourcePath?: unknown
      target?: unknown
      appField?: unknown
      type?: unknown
      name?: unknown
    }>
    connectionFields?: Array<{ appField?: unknown; from?: unknown }>
  }
  for (const field of contributing.fields ?? []) {
    if (!field.sourcePath) {
      throw new Error(
        `defineDataConnector: connector "${connectorId}" stream "${streamKey}" mapping "${mapping.rootPath}": every contributing field needs a sourcePath`
      )
    }
    if (field.target && field.appField) {
      throw new Error(
        `defineDataConnector: connector "${connectorId}" stream "${streamKey}" mapping "${mapping.rootPath}": field "${field.sourcePath}" cannot set both target and appField`
      )
    }
    if (!field.target && !field.appField && !(field.type && field.name)) {
      throw new Error(
        `defineDataConnector: connector "${connectorId}" stream "${streamKey}" mapping "${mapping.rootPath}": field "${field.sourcePath}" needs a target, an appField, or both type and name (source-only projection)`
      )
    }
  }
  for (const conn of contributing.connectionFields ?? []) {
    if (!conn.appField || !conn.from) {
      throw new Error(
        `defineDataConnector: connector "${connectorId}" stream "${streamKey}" mapping "${mapping.rootPath}": every connectionFields entry needs appField and from`
      )
    }
  }
}

/**
 * Declare an app-provided Data Connector with type inference and runtime
 * validation. Mirrors `defineTool` / `defineTrigger`.
 *
 * The connector declares its **source schema** implicitly — through the union
 * of every mapping's source paths (Layer A) — plus the **fan-out mappings**
 * (`streams[].mappings`) that route those source values onto the platform's
 * entity model, and supplies an `execute` server handler that fetches from the
 * provider and yields source-shaped `ConnectorRecord` batches. The platform
 * validates those records against the derived stream schema, then maps + sinks
 * them — the app never sees target defs or writes entities.
 *
 * A mapping's `target` is either `{ entityKey }` — an entity THIS APP OWNS,
 * declared via `defineEntity` and registered on `app.entities` — whose fields
 * bind by `key` onto fields already declared there, or `{ entityKind }` — a
 * platform kind the app merely contributes to, whose fields bind by `target` /
 * `appField` onto the def's own attributes or a `defineFields` field.
 *
 * `execute` infers its config argument type from `z.output<config>`.
 *
 * **Pagination — one page per `execute`.** The platform loops `execute`, not the
 * app: return ONE page of records plus `nextState.cursor`, and the platform
 * re-invokes with `state.cursor` set to it until you return
 * `nextState.backfillComplete: true` (or omit the cursor). The cursor is any
 * JSON-serializable value the platform persists + restores verbatim.
 *
 * **Connection — use `args.connection`, never ambient helpers.** A connector
 * receives its bound connection explicitly on `args.connection` (`{ value, fields,
 * metadata }`). Do NOT reuse a tool/agent ambient `getConnection()` helper — that
 * resolves from a different (tool) context and is not the connector contract.
 * Pure helpers over `args.connection` (e.g. reading a shop domain off `metadata`)
 * are fine.
 *
 * See docs/app-fields-and-entities-guide.md.
 *
 * @example
 * ```ts
 * import { defineDataConnector } from '@auxx/sdk/data-connectors'
 * import { z } from '@auxx/sdk/tools'
 * import { orders } from './entities'
 * import { shopifyCoreSync } from './shopify-core.connector.server'
 *
 * export const shopifyCoreDataConnector = defineDataConnector({
 *   id: 'shopify.core',
 *   label: 'Shopify Core Data',
 *   description: 'Sync orders, products, and customers from your Shopify store.',
 *   requiresConnection: true,
 *   config: z.object({ includeDraftProducts: z.boolean().default(false) }),
 *   streams: [{
 *     key: 'order',
 *     mappings: [
 *       { rootPath: '', target: { entityKey: orders.key },
 *         fields: [{ key: 'shopifyId', sourcePath: 'id' }, { key: 'name', sourcePath: 'name' }] },
 *       { rootPath: 'customer', target: { entityKind: 'contact' },
 *         fields: [{ sourcePath: 'email', target: 'primary_email', match: true }] },
 *     ],
 *   }],
 *   execute: shopifyCoreSync,
 * })
 *
 * // execute pages by returning a cursor until the last page:
 * async function shopifyCoreSync({ state, connection }) {
 *   const page = await fetchPage(connection.value, state.cursor)
 *   return page.hasNext
 *     ? { records: page.records, nextState: { cursor: page.nextCursor } }
 *     : { records: page.records, nextState: { backfillComplete: true, updatedSince: page.maxUpdatedAt } }
 * }
 * ```
 */
export function defineDataConnector<TConfigSchema extends z.ZodTypeAny>(
  connector: DataConnectorDefinition<TConfigSchema>
): DataConnectorDefinition<TConfigSchema> {
  if (!CONNECTOR_ID_RE.test(connector.id)) {
    throw new Error(
      `defineDataConnector: invalid id "${connector.id}" — must match ${CONNECTOR_ID_RE.source}`
    )
  }
  if (!connector.streams.length) {
    throw new Error(`defineDataConnector: connector "${connector.id}" declares no streams`)
  }

  const seenStreamKeys = new Set<string>()
  for (const stream of connector.streams) {
    if (!stream.key) {
      throw new Error(`defineDataConnector: connector "${connector.id}" has a stream with no key`)
    }
    if (seenStreamKeys.has(stream.key)) {
      throw new Error(
        `defineDataConnector: connector "${connector.id}" has duplicate stream key "${stream.key}"`
      )
    }
    seenStreamKeys.add(stream.key)

    for (const mapping of stream.mappings ?? []) {
      assertValidMapping(connector.id, stream.key, mapping)
    }

    // exampleRecord must be JSON-serializable — it rides the catalog jsonb.
    if (stream.exampleRecord !== undefined) {
      try {
        if (JSON.stringify(stream.exampleRecord) === undefined) {
          throw new Error('serializes to undefined')
        }
      } catch (err) {
        throw new Error(
          `defineDataConnector: stream "${stream.key}" exampleRecord is not JSON-serializable — ${
            err instanceof Error ? err.message : String(err)
          }`
        )
      }
    }
  }

  return connector
}
