// packages/sdk/src/root/data-connectors/define-data-connector.ts

import type { z } from 'zod/v4'
import type { DataConnectorDefinition } from './types.js'

/** Connector id regex — dotted lowercase segments, e.g. `shopify.core`. */
const CONNECTOR_ID_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/

/**
 * Declare an app-provided Data Connector with type inference and runtime
 * validation. Mirrors `defineTool` / `defineTrigger`.
 *
 * The connector declares its **source schema** (one `streams[]` entry per fetch)
 * + recommended **fan-out mappings**, and supplies an `execute` server handler
 * that fetches from the provider and yields source-shaped `ConnectorRecord`
 * batches. The platform validates those records against the stream schema, then
 * maps + sinks them — the app never sees target defs or writes entities.
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
 * See plans/data-connectors/claude/03-connectors-and-sources.md §4.
 *
 * @example
 * ```ts
 * import { defineDataConnector } from '@auxx/sdk/data-connectors'
 * import { z } from '@auxx/sdk/tools'
 * import { shopifyCoreSync } from './shopify-core.connector.server'
 *
 * export const shopifyCoreDataConnector = defineDataConnector({
 *   id: 'shopify.core',
 *   label: 'Shopify Core Data',
 *   description: 'Sync orders, products, and customers from your Shopify store.',
 *   requiresConnection: true,
 *   config: z.object({ includeDraftProducts: z.boolean().default(false) }),
 *   streams: [{ key: 'order', displayFieldKey: 'name', fields: { ... } }],
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

    if (!stream.fields[stream.displayFieldKey]) {
      throw new Error(
        `defineDataConnector: stream "${stream.key}" displayFieldKey "${stream.displayFieldKey}" is not a declared field`
      )
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
