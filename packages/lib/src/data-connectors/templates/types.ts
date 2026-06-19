// packages/lib/src/data-connectors/templates/types.ts
// First-party connector templates (05c) — open presets that seed a normal,
// fully-editable `generic-rest` connector. A template is just a JSON bundle of
// the engine's own shapes (config + streams), so installing one is pure
// composition over the existing `createConnector` / `addStream` helpers. Mirrors
// `entity-templates/` one-to-one.

import type { DataConnectorConfig, StreamRequestConfig, SyncMode } from '../types'

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
