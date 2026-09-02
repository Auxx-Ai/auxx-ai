// packages/sdk/src/root/data-connectors/types.ts

/**
 * Author surface types for app-declared Data Connectors.
 *
 * A Data Connector is how an app declares *where structured records come from
 * and how they map onto the platform's entity model*. The app only **fetches +
 * normalizes to a source schema** — it never writes entities, never sees target
 * defs, and never gets DB access. The platform validates the source-shaped
 * records against the declared stream schema, then maps + sinks them (the
 * mapping layer + entity sink are platform-side).
 *
 * The SDK is published as a standalone npm package, so these types cannot import
 * from `@auxx/lib` / `@auxx/database`. They MUST stay structurally compatible
 * with the engine-side contract in `packages/lib/src/data-connectors/types.ts`
 * and the catalog projection in
 * `packages/database/src/db/schema/app-deployment.ts` (CatalogDataConnector).
 *
 * See docs/app-fields-and-entities-guide.md.
 */

import type { z } from 'zod/v4'
import type { FieldType } from '../fields/field-types.js'
import type { ActionInputHint, EntityRefKind } from '../tools/types.js'

/**
 * One normalized, SOURCE-shaped record produced by a connector's `execute`. Not
 * pre-mapped to target fields — the platform mapping layer maps + fans out.
 * `fields` is keyed by the stream's source field paths (e.g. `'customer.email'`,
 * `'line_items[].sku'`).
 */
export interface ConnectorRecord {
  /** Which stream (fetch) this record belongs to. */
  streamKey: string
  /** Provider stable id (→ DataConnectorItem.externalId). */
  externalId: string
  /** Denormalized display name for the landed entity instance. */
  displayName: string
  /** Raw source-shaped values keyed by source path (matches the mapped fields). */
  fields: Record<string, unknown>
  /** Tombstone — explicit delete signal. */
  deleted?: boolean
  /** Optional content hash; the platform computes a sorted-key hash if absent. */
  contentHash?: string
}

/**
 * Per-stream cursor an app returns from one page and reads back on the next. The
 * platform persists + restores it verbatim across runs and slices — the app never
 * sees the engine's internal cursor encoding.
 */
export interface ConnectorStreamState {
  /**
   * Opaque resume token. Any JSON-serializable value — a string token, or a
   * structured cursor like `{ after: 'x', page: 3 }`. Return it from one page to
   * fetch the next; the platform hands it straight back on `state.cursor`.
   */
  cursor?: unknown
  /** Steady-phase delta floor (watermark); return the max seen so the next steady run resumes from it. */
  updatedSince?: string
  /** Set `true` on the last page — the platform flips the stream to steady (incremental) or finishes the snapshot. */
  backfillComplete?: boolean
  [key: string]: unknown
}

/**
 * A connector fetch result — ONE page of records plus the cursor for the next
 * page. The platform re-invokes `execute` with `state.cursor = nextState.cursor`
 * until `nextState.backfillComplete` (or no cursor), so each `execute` call is a
 * single page; pagination is the loop the platform drives, not one the app does.
 */
export interface ConnectorFetchResult {
  /** Source-shaped records for this page. May be an array or an async iterable. */
  records: ConnectorRecord[] | AsyncIterable<ConnectorRecord>
  /** Cursor + watermark to persist; the next page / incremental run resumes from here. */
  nextState: ConnectorStreamState
  /**
   * Upstream throttle signal. When the source rate-limits a page (HTTP 429, or a
   * provider-specific 403/cost throttle), **return** this instead of throwing or
   * sleeping — the platform pauses the chain and re-enqueues the next slice after
   * `retryAfterMs`, so the connector never burns its sandbox budget waiting.
   *
   * Return the cursor you want to resume from in `nextState.cursor` alongside this
   * (typically the SAME page that was throttled). Records already collected this page
   * are still sinked; the throttled page is retried after the wait.
   */
  rateLimited?: {
    /** Server-hinted wait before the next attempt, in ms (`Retry-After` / reset header). */
    retryAfterMs?: number
  }
}

/**
 * Per-field write behavior once a contributing binding lands on the target.
 * Absent ⇒ `'overwrite'`.
 *
 * Mirrors the platform's `FieldMergeStrategy`
 * (`packages/lib/src/write-policy/types.ts`) — the SDK cannot import
 * `@auxx/lib`, so this is a structural duplicate. Keep the two in lock-step.
 *
 * - `overwrite`, the source value wins.
 * - `fill_blank`, write only when the TARGET is empty ("don't clobber what a
 *   human set").
 * - `connector_owned_only`, write only fields this connector already owns.
 * - `manual_review`, record a drift suggestion instead of writing.
 * - `ignore`, never write; the binding is projection-only (Layer A schema
 *   only).
 */
export type FieldMergeStrategy =
  | 'overwrite'
  | 'fill_blank'
  | 'connector_owned_only'
  | 'manual_review'
  | 'ignore'

/**
 * One field on an OWNED mapping (`target: { entityKey }`) — a source path
 * bound to a field already declared on that `defineEntity`. Type, name,
 * options and identity are inherited from the entity's own `FieldDecl`, so
 * nothing is declared twice; `key` is validated against the entity's declared
 * fields at catalog-extraction time (unknown key ⇒ build error).
 */
export interface ConnectorOwnedMappingField {
  /** Must name a field declared on the target `EntityDecl`. */
  readonly key: string
  /** Provider JSON path, relative to the mapping's `rootPath`. */
  readonly sourcePath: string
}

/** Fields common to every contributing mapping field. */
interface ConnectorContributingFieldBase {
  /** Provider JSON path, relative to the mapping's `rootPath`. */
  readonly sourcePath: string
  /**
   * Secondary identity-match key (today's `matchFieldKeys`) — merges an
   * incoming record into an existing entity on first link. The external id
   * (from `appField`, when that field is `identity: true`) is always the
   * primary key; more than one `match: true` field is an ANDed composite key.
   */
  readonly match?: boolean
  /** Per-field write behavior once bound. Default `'overwrite'`. */
  readonly mergeStrategy?: FieldMergeStrategy
}

/**
 * Binds the source value onto the target def's own attribute — resolves
 * against the target's `systemAttribute` or field name (today's `targetKey`).
 */
export interface ConnectorContributingFieldToTarget extends ConnectorContributingFieldBase {
  readonly target: string
  readonly appField?: never
  readonly type?: never
  readonly name?: never
}

/**
 * Binds the source value onto a `defineFields` field this app declares for
 * the same `entityKind` (today's `targetAppField`). When that field is
 * `identity: true`, the binding auto-stamps
 * `identityRole: { kind: 'externalId' }`.
 */
export interface ConnectorContributingFieldToAppField extends ConnectorContributingFieldBase {
  readonly appField: string
  readonly target?: never
  readonly type?: never
  readonly name?: never
}

/**
 * A source-only field with no target — projection only, needed for the
 * Layer A schema (e.g. a value the `execute` fetch cares about but the
 * mapping doesn't write anywhere). `type`/`name` are REQUIRED here since
 * there is no target field to inherit them from.
 */
export interface ConnectorContributingFieldSourceOnly extends ConnectorContributingFieldBase {
  readonly type: FieldType
  readonly name: string
  readonly target?: never
  readonly appField?: never
}

/** One field on a CONTRIBUTING mapping (`target: { entityKind }`). */
export type ConnectorContributingMappingField =
  | ConnectorContributingFieldToTarget
  | ConnectorContributingFieldToAppField
  | ConnectorContributingFieldSourceOnly

/**
 * Fills a plain (non-identity) `defineFields` field from the connector's
 * CONNECTION METADATA (e.g. Shopify `shopDomain`) rather than the source
 * record — the only synthetic write channel. `appField` must name a declared,
 * non-identity app field for the mapping's `entityKind` (identity-field target
 * is an extract-time error — connection metadata can't fill an identity cell);
 * `from` is the connection metadata key (`ConnectorConnection.metadata`).
 */
export interface ConnectorConnectionField {
  readonly appField: string
  readonly from: string
}

/** Fields common to every mapping, owned or contributing. */
interface ConnectorMappingBase {
  /** `''` = root record, else a subtree path (`'customer'` / `'line_items[]'`). */
  readonly rootPath: string
  /**
   * Explicitly name the PARENT mapping's `rootPath` (payload-absolute, like
   * every rootPath here) when prefix nesting cannot derive it — a flat
   * drilled child: a SECOND mapping over the same subtree as its parent. Must
   * be a boundary prefix of — or equal to — `rootPath`. Omit for ordinary
   * nesting: the platform derives the parent from the longest boundary-prefix
   * mapping (owned or contributing).
   */
  readonly parentRootPath?: string
  /** Default: `upsert` for embedded data, `reference` for id-only branches. */
  readonly linkMode?: 'upsert' | 'reference'
  /**
   * Runtime pointer the fan-out reads to find the edge field at write time. A
   * bare key names a `RELATIONSHIP` field declared on the parent entity
   * (owned) — provisioning creates it (+ inverse) from that field's own
   * `relationship` config, nothing is declared again here. A
   * `'system:<systemAttribute>'` value names a pre-existing SYSTEM
   * relationship field on a contributing parent def; nothing is provisioned
   * for it.
   */
  readonly relationshipFieldKey?: string
}

/**
 * A mapping whose target is an entity THIS APP OWNS (declared via
 * `defineEntity`, resolved by `entityKey` against `app.entities` at
 * catalog-extraction time). Its `fields` bind source paths onto fields
 * already declared on that entity — type/name/options/identity are inherited,
 * never redeclared.
 */
export interface OwnedConnectorMapping extends ConnectorMappingBase {
  readonly target: { readonly entityKey: string }
  readonly fields?: readonly ConnectorOwnedMappingField[]
  readonly connectionFields?: never
}

/**
 * A mapping whose target is a PLATFORM kind (`entityKind`) this app does not
 * own — the mapping contributes to an existing (possibly shared) def. Its
 * `fields` bind source paths onto the target's own attributes or onto
 * `defineFields` app fields.
 */
export interface ContributingConnectorMapping extends ConnectorMappingBase {
  readonly target: { readonly entityKind: EntityRefKind }
  readonly fields?: readonly ConnectorContributingMappingField[]
  readonly connectionFields?: readonly ConnectorConnectionField[]
}

/**
 * One fan-out mapping — the unit that carries source paths (§2.4). Replaces
 * the old stream-wide `fields` map + `defaultMappings` + the three parallel
 * contributing binding lists (`fieldBindings`, `matchFieldKeys`,
 * `connectionAppFields`), which collapse into `fields` + `connectionFields`
 * here. The user confirms/overrides at setup; branches not declared here are
 * inferred from the schema tree.
 */
export type ConnectorMapping = OwnedConnectorMapping | ContributingConnectorMapping

/** One stream (fetch) declaration. */
export interface ConnectorStreamDecl {
  /** Provider resource id / endpoint key, e.g. `'order'`. */
  key: string
  /**
   * How the platform schedules this stream. `incremental` runs the backfill once
   * then steady `updatedSince`-floored delta runs; `snapshot` (default) re-crawls
   * in full every run. Drives the `mode` handed to `execute`.
   */
  syncMode?: 'snapshot' | 'incremental'
  /**
   * Fan-out mappings — root + embedded branches + id-only refs. The Layer A
   * source schema is built platform-side from the union of every mapping's
   * absolute source paths (`rootPath` + `sourcePath`) plus `exampleRecord`,
   * with declared types overlaid from the resolved target field.
   */
  mappings: ConnectorMapping[]
  /** Canonical sample → schema preview + dry-run before the first live fetch. */
  exampleRecord?: Record<string, unknown>
  /**
   * Per-stream webhook STEERING. `filter` matches against the delivery's triggerData
   * (e.g. { topic: 'inventory_levels/update' }); `paths` name triggerData fields exposed
   * to the app's execute as `triggerContext`; `debounceMs` coalesces same-record bursts.
   * A stream with `filter` but empty `paths` causes a FULL connector sync per delivery —
   * never ship that for high-volume topics.
   */
  webhookTrigger?: {
    filter?: Record<string, unknown>
    paths: string[]
    debounceMs?: number
  }
}

/**
 * Arguments the platform hands to a connector's `execute` for one stream fetch.
 * The app receives the decrypted connection (the OAuth credential it minted) but
 * NEVER target defs, mappings, or entity write access.
 */
export interface ConnectorExecuteArgs<TConfig = Record<string, unknown>> {
  /** Which stream to fetch. */
  streamKey: string
  /** `snapshot` (full) or `incremental` (delta from the cursor). */
  mode: 'snapshot' | 'incremental'
  /** The persisted cursor for this stream (the platform's last `nextState`). */
  state: ConnectorStreamState
  /**
   * The borrowed connection (decrypted), or null when none is bound. This is the
   * connector's ONLY connection handle — resolve auth from here, not from a
   * tool/agent ambient `getConnection()` helper.
   */
  connection: ConnectorConnection | null
  /** The connector's validated config (from the `config` zod schema). */
  config: TConfig
  /**
   * Webhook steering tokens (present only on a webhook-steered partial fetch).
   * Keys are the paths declared in the stream's `webhookTrigger.paths`; values are the
   * corresponding values from the delivery payload. When set, fetch ONLY the affected
   * record(s) and return `nextState: { backfillComplete: true }`.
   */
  triggerContext?: Record<string, string>
}

/**
 * The decrypted connection handed to `execute`. Same shape the polling-trigger /
 * tool runtime receives — `value` is the access token, `fields` carries
 * multi-field secrets, `metadata` carries non-sensitive connection variables
 * (shop domain, region, …).
 */
export interface ConnectorConnection {
  value: string
  fields?: Record<string, string>
  metadata?: Record<string, unknown>
}

/** The server handler an app supplies to fetch + yield source-shaped records. */
export type ConnectorExecute<TConfig = Record<string, unknown>> = (
  args: ConnectorExecuteArgs<TConfig>
) => Promise<ConnectorFetchResult>

/**
 * A full app-declared data connector. Passed to `defineDataConnector`. `config`
 * is a zod schema validated at setup; `streams` declare the source schemas +
 * recommended mappings; `execute` is the server handler.
 */
export interface DataConnectorDefinition<TConfigSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Stable connector id, e.g. `'shopify.core'`. */
  id: string
  /** Human label shown in the connector picker. */
  label: string
  /** One-line description shown in the connect-a-source picker. */
  description?: string
  /** Whether the connector needs the app's OAuth connection to fetch. */
  requiresConnection: boolean
  /** Connector-level config schema (filters, toggles). */
  config: TConfigSchema
  /**
   * Per-config-field presentation overrides keyed by config field, reusing the
   * quick-action `ActionInputHint` shape. A `dynamic-select` hint renders the
   * field as a live dropdown whose options come from an app tool
   * (`optionsFrom`) invoked through the connector's own connection — e.g. a
   * repo picker backed by a `list_repos` tool. `optionsFrom` must name a tool in
   * the same app. Absent fields render from the JSON Schema as usual.
   */
  configOptions?: Record<string, ActionInputHint>
  /** Stream (fetch) declarations. */
  streams: ConnectorStreamDecl[]
  /** Optional icon key for the connector card. */
  iconKey?: string
  /**
   * Connector-level webhook SIGNAL: which app trigger drives webhook-sync for this
   * connector (one per connector). E.g. { triggerId: 'shopify.shopify-trigger' }.
   */
  webhookTrigger?: { triggerId: string }
  /**
   * Server handler — fetches from the provider and yields source-shaped
   * `ConnectorRecord` batches. Lives in a `.connector.server.ts(x)` module so
   * the catalog extractor can stub it.
   */
  execute: ConnectorExecute<z.output<TConfigSchema>>
}
