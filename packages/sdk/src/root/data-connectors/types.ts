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

/** What one fetch is asked for. Honoured exactly; nothing in it is a hint. */
export interface ConnectorQuery {
  /** Fetch exactly these ids. Absent `idKind` ⇒ the stream's own external ids. */
  ids?: string[]
  /** Set with `ids` on a webhook-steered fetch when the delivery carries a foreign id (declared `webhookTrigger.idKind`). */
  idKind?: string
  /** UTC ISO bounds on the stream's declared `period` path; `from` inclusive, `to` exclusive. */
  period?: { from?: string; to?: string }
  /** The marker the app returned as `since` on the last page of the previous run. Opaque. */
  since?: unknown
}

/** What a stream can be queried by. Absent key ⇒ unsupported; the platform refuses before the run. */
export interface ConnectorStreamQueryDecl {
  ids?: true
  /** Source path of the date that says when a record happened (`created_at`, `issued_at`). */
  period?: string
  since?: true
}

/**
 * ONE page of records for the query. The platform re-invokes `execute` with
 * `cursor` set to the one returned here until a page returns no cursor.
 */
export interface ConnectorFetchResult {
  /** Source-shaped records for this page. May be an array or an async iterable. */
  records: ConnectorRecord[] | AsyncIterable<ConnectorRecord>
  /** Next page of this query. Absent ⇒ the query is exhausted. */
  cursor?: unknown
  /** Last page of a `since` stream only: the marker the next run's `query.since` gets back. */
  since?: unknown
  /**
   * Return this instead of throwing or sleeping when the source throttles a page; the
   * platform re-invokes with the same `cursor` after `retryAfterMs`. Records returned
   * alongside are still sunk.
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

/** Fields common to every contributing mapping field, source-bound or constant. */
interface ConnectorContributingFieldCommon {
  /** Per-field write behavior once bound. Default `'overwrite'`. */
  readonly mergeStrategy?: FieldMergeStrategy
}

/** Fields common to every SOURCE-BOUND contributing mapping field. */
interface ConnectorContributingFieldBase extends ConnectorContributingFieldCommon {
  /** Provider JSON path, relative to the mapping's `rootPath`. */
  readonly sourcePath: string
  readonly constant?: never
  /**
   * Secondary identity-match key (today's `matchFieldKeys`) — merges an
   * incoming record into an existing entity on first link. The external id
   * (from `appField`, when that field is `identity: true`) is always the
   * primary key.
   *
   * 🛑 **Candidates are OR'd, not ANDed, so each extra `match: true` field
   * WIDENS the match.** The intuition most authors bring to this is backwards.
   * A connector's lookup runs `lookupByField`, which never passes the opt-in
   * `matchAll` flag, so the first candidate that hits wins. Worked example,
   * Shopify's contact mapping with `primary_email` and `phone` both
   * `match: true`, against an existing contact `jane@example.com` /
   * `+19998888` receiving `jane@example.com` / `+15550001`: the email hits, so
   * the record merges into the existing Jane. It does NOT create a second Jane
   * because the phone disagrees. Declare a second match key only when you want
   * another independent chance to merge.
   *
   * The corollary is that **a composite key is unavailable to a connector.**
   * Guarding a match on an id that a provider reuses (a carrier tracking
   * number, say) with a second field such as a date is not possible: adding
   * that candidate only widens the match. If a value is not unique enough to
   * carry a match on its own, do not declare `match` on it at all.
   *
   * Ambiguity is not an error on this path: the lookup runs under
   * `onAmbiguous: 'first'`, because a sync must not fail on data the user can
   * only fix by merging. Two matches take the first and file a
   * `DuplicateSuggestion`.
   *
   * `'exclusive'` is a match key whose hits are different things colliding, not
   * one thing seen twice: when a second source record of this mapping resolves
   * to a record a sibling already binds, the sink skips it with a reason and
   * never binds it (two Shopify variants sharing one SKU). Plain `true` binds
   * both (a guest checkout and a customer sharing one email are one contact).
   */
  readonly match?: boolean | 'exclusive'
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

/**
 * Writes a FIXED value onto the target def's own attribute, no source path,
 * so the value is the app's own statement about every record this mapping
 * produces ("a Shopify product variant is always a `material`"), not something
 * read off the payload.
 *
 * Use it for a target the provider has no column for and no free-text column
 * can safely fill: a closed enum whose options the provider does not speak. The
 * platform's per-field `defaultValue` is the wrong lever there, because it is
 * one value shared by every writer of that field, a constant binding is scoped
 * to this connector's mapping.
 *
 * `match` is deliberately absent: a constant is identical on every record, so
 * matching on it would collapse the whole stream onto one entity.
 */
export interface ConnectorContributingFieldConstant extends ConnectorContributingFieldCommon {
  /** The literal written on every record this mapping projects. */
  readonly constant: string | number | boolean
  /** Resolves against the target def's `systemAttribute` or field name. */
  readonly target: string
  readonly sourcePath?: never
  readonly appField?: never
  readonly match?: never
  readonly type?: never
  readonly name?: never
}

/** One field on a CONTRIBUTING mapping (`target: { entityKind }`). */
export type ConnectorContributingMappingField =
  | ConnectorContributingFieldToTarget
  | ConnectorContributingFieldToAppField
  | ConnectorContributingFieldSourceOnly
  | ConnectorContributingFieldConstant

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
   *
   * ⚠️ **A `system:` key that does not resolve is dropped, not rejected.**
   * `resolveRelationshipFieldKeyFromFields` looks the `systemAttribute` up on
   * the PARENT def's fields at install time; a typo, or a parent that is owned
   * rather than contributing, logs a warning and returns null. The mapping
   * still lands and still writes its fields, edge-less, so the child records
   * appear with nothing linking them to their parent and no error anywhere the
   * author will see. Check the attribute against the parent's registry field
   * file before shipping.
   *
   * Note the direction: the key resolves against the PARENT, so a parcel hung
   * off a shipment is `'system:shipment_parcels'` (the has_many on the parent),
   * never `'system:parcel_shipment'` (the belongs_to on the child).
   */
  readonly relationshipFieldKey?: string
  /**
   * What crawl reconciliation does with a record this stream's crawl did NOT see.
   * Absent ⇒ `'ignore'`, which is the safe default: nothing happens, and a record
   * deleted upstream simply stays as it was.
   *
   * ⚠️ Only consulted after an unbounded fetch (`query` sent as `{}`: no `since`, no
   * `period` floor), where the fetch saw everything and absence therefore means
   * deletion. After any bounded fetch absence means "not asked for", so this is ignored.
   * Exception: on a child array mapping (`rootPath: 'tax_lines[]'`) it also applies,
   * on every sync, to children missing from their parent's array, so declare it there
   * only when the payload always carries the complete, unpaged array.
   *
   * - `'mark_deleted'` flags the record as gone upstream and leaves it LIVE for a
   *   person to act on. Declare this when the record has a life of its own beyond
   *   the sync (inventory movements, ledger history, hand-entered edits).
   * - `'archive'` archives it. Declare this ONLY when the crawl is UNFILTERED, since
   *   a filtered crawl makes "not returned" mean "filtered out", not "deleted". The
   *   platform still refuses to archive a record this connector did not create, and
   *   refuses the whole pass when an implausible number of records vanish at once.
   */
  readonly orphanBehavior?: 'archive' | 'mark_deleted' | 'ignore'
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

/** One AND'd clause of a stream's `recordFilter`. */
export interface ConnectorRecordFilterCondition {
  /** A source path into the raw record: `orders_count`, `customer.email`. */
  fieldId: string
  /** A platform condition operator key: `'>'`, `'equals'`, `'is_not_empty'`. */
  operator: string
  value?: unknown
}

/** One stream (fetch) declaration. */
export interface ConnectorStreamDecl {
  /** Provider resource id / endpoint key, e.g. `'order'`. */
  key: string
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
   * What `execute` can be queried by. A stream with `since` runs incremental deltas after
   * its backfill; without it every run re-reads (floored by `period` when declared).
   */
  query?: ConnectorStreamQueryDecl
  /**
   * Per-stream webhook steering. `filter` matches the delivery's triggerData
   * (e.g. `{ topic: 'inventory_levels/update' }`); the platform then fetches
   * `{ ids: [triggerData[idPath]], idKind }`, so the stream must declare `query.ids`.
   * `debounceMs` coalesces same-record bursts.
   */
  webhookTrigger?: {
    filter?: Record<string, unknown>
    idPath: string
    idKind?: string
    debounceMs?: number
  }
  /**
   * Per-record filter over the RAW payload, AND'd: a record that fails is skipped
   * before mapping and counts as `skipped`. Seeded onto the stream at install, so a
   * merchant can loosen it later. A repeated path (`line_items[].sku`) is refused.
   */
  recordFilter?: readonly ConnectorRecordFilterCondition[]
}

/**
 * Arguments the platform hands to a connector's `execute` for one stream fetch.
 * The app receives the decrypted connection (the OAuth credential it minted) but
 * NEVER target defs, mappings, or entity write access.
 */
export interface ConnectorExecuteArgs<TConfig = Record<string, unknown>> {
  /** Which stream to fetch. */
  streamKey: string
  query: ConnectorQuery
  /** Paging within this query only; the value you returned from the previous page. */
  cursor?: unknown
  /**
   * The borrowed connection (decrypted), or null when none is bound. This is the
   * connector's ONLY connection handle — resolve auth from here, not from a
   * tool/agent ambient `getConnection()` helper.
   */
  connection: ConnectorConnection | null
  /** The connector's validated config (from the `config` zod schema). */
  config: TConfig
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
