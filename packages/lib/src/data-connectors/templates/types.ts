// packages/lib/src/data-connectors/templates/types.ts
// First-party connector templates (05c) — open presets that seed a normal,
// fully-editable `generic-rest` connector. A template is just a JSON bundle of
// the engine's own shapes (config + streams), so installing one is pure
// composition over the existing `createConnector` / `addStream` helpers. Mirrors
// `entity-templates/` one-to-one.

import type { FieldType } from '@auxx/database/types'
import type {
  DataConnectorConfig,
  IdentityNormalize,
  LinkMode,
  OrphanBehavior,
  StreamRequestConfig,
  SyncMode,
} from '../types'

/**
 * Connection hint surfaced at setup (05c §8). The template only *declares* that
 * it needs a credential and biases the picker — it never auto-mints or
 * auto-binds one. `providerKey` points at a seeded platform ConnectionDefinition
 * (the unification refactor is live, so OAuth-with-refresh + every auth scheme
 * resolve through `resolveConnectionForRuntime` + `applyAuth`); `appSlug` borrows
 * an installed app's credential as an alternative.
 */
export interface ConnectorTemplateConnection {
  providerKey?: string
  appSlug?: string
  authScheme?: 'bearer' | 'basic' | 'header' | 'query' | 'oauth2'
  docsUrl?: string
}

/**
 * One stream the template seeds. The fields below map directly onto `addStream`
 * input — `sourceSchema` is a plain JSON-Schema object (the same shape a
 * test-fetch infers and the mapping pickers read), pre-filled so the user sees
 * the source shape before fetching.
 */
export interface ConnectorTemplateStream {
  /** Stream key (e.g. 'customers'). */
  streamKey: string
  /** Pre-filled source (Layer A) JSON-Schema. Omit to let the user infer it. */
  sourceSchema?: Record<string, unknown>
  /** Per-stream generic-rest request: path/method/params/pagination. */
  requestConfig: StreamRequestConfig
  syncMode?: SyncMode
  /**
   * Layer B (05d) — where this stream lands + how source fields map onto target
   * fields. Omit to leave the stream untargeted (05c behaviour: the user authors
   * the mapping in the editor). v1 supports `contributing` targets only.
   */
  mappings?: ConnectorTemplateMapping[]
}

/**
 * One target a stream's records land in (05d). Materialized into a real
 * `DataConnectorMapping` row by the installer — the same row the manual mapping
 * editor produces, so the runtime treats a template instance identically to a
 * hand-built connector.
 */
export interface ConnectorTemplateMapping {
  /** '' = whole record, else a path into the response (e.g. 'data[]' for a Stripe list). */
  rootPath: string
  /** 'upsert' (default) projects records; 'reference' wires a relationship only. */
  linkMode?: LinkMode
  /** Orphan handling. Defaults to 'ignore' (contributing never archives a co-owned def). */
  orphanBehavior?: OrphanBehavior
  /** Where the records land. v1: contributing into an existing def. */
  target: ConnectorTemplateTarget
  /** Target field key → binding. Identity (`match`) is derived from these. */
  fields: ConnectorTemplateFieldMapping[]
}

/**
 * Target for a template mapping. v1 ships `contributing` only — owned-mode def
 * creation is deferred (05d §9). Kept a discriminated union so the owned variant
 * slots in without touching call sites.
 */
export type ConnectorTemplateTarget = {
  mode: 'contributing'
  /**
   * Symbolic reference to an existing def, resolved to a real `entityDefinitionId`
   * at install time. v1 supports `@system:<entityType>` (e.g. '@system:contact',
   * '@system:company') — every org has its system defs.
   */
  entityRef: string
}

/** One target-field binding in a template mapping (05d). */
export interface ConnectorTemplateFieldMapping {
  /**
   * Target field identifier — what the connector writes into. For a field reused
   * from an existing def this is its `systemAttribute` (e.g. 'primary_email',
   * 'full_name', 'phone'). For a connector-introduced field (carrying `provision`)
   * this is the field's display name (provisioned fields have no systemAttribute,
   * so the crud layer resolves the write by name). The runtime resolves writes by
   * `systemAttribute ?? name`, so `key` must equal one of those on the target def.
   */
  key: string
  /** Source path in the record. Sugar for an identity CALC expression. */
  source?: string
  /** Full CALC expression for transforms (epoch→ms, cents→units). Use with `sourceFields`. */
  expression?: string
  /** Token → source path map for `expression`. */
  sourceFields?: Record<string, string>
  /**
   * Flag this bound field a secondary identity-match key (first-link dedup), e.g.
   * email. `true` = match with no normalization; pass `{ normalize: 'email' }` to
   * canonicalize before lookup (recommended for email/phone/domain match keys).
   */
  match?: boolean | { normalize?: IdentityNormalize }
  /**
   * Provisioning hint for a connector-introduced field — set the type/icon/hidden
   * of the field the connector creates (its name = `key`). Omit for fields already
   * present on the target def (email/name/phone): those are reused as-is and never
   * re-created.
   */
  provision?: { type: FieldType; icon?: string; isHidden?: boolean }
}

/** A first-party connector template — a pre-filled `generic-rest` preset. */
export interface ConnectorTemplate {
  /** Stable id (e.g. 'stripe'); stamped as `DataConnector.templateId` provenance. */
  id: string
  /** Display name for the catalog card. */
  name: string
  description: string
  /** Categories drive the connect-dialog grouping/filter (e.g. 'payments'). */
  categories: string[]
  iconKey?: string
  /** Does this preset need a bound credential to fetch? */
  requiresConnection: boolean
  /** Connection hint surfaced at setup (not auto-bound). See §8. */
  connection?: ConnectorTemplateConnection
  /** Seeds `DataConnector.config` — base URL + shared headers + pagination. */
  config: DataConnectorConfig
  /** Seeds the connector's streams (source schema + request). */
  streams: ConnectorTemplateStream[]
}

/** Lightweight projection for the connect-dialog catalog (no stream/config blobs). */
export interface ConnectorTemplateSummary {
  id: string
  name: string
  description: string
  categories: string[]
  iconKey?: string
  requiresConnection: boolean
}
