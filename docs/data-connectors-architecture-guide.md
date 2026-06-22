# Data Connectors Architecture Guide

**Last Updated:** 2026-06-22
**Scope:** The `DataConnector` system — how external structured records (Shopify, generic REST/JSON endpoints, apps) are pulled on a schedule and materialized as **EntityInstances + FieldValues**, idempotently and reconcilably, into either a connector-owned definition or an existing one (including system `contact`/`ticket`). Covers backend (schema, connectors, mapping layer, entity sink, orchestrator, queues) and frontend (tRPC, detail view).

> The engine lives in `packages/lib/src/data-connectors` (server-only barrel `@auxx/lib/data-connectors`). This is the controlling module — everything a connector does flows through it. Entity definitions, instances, and field values are downstream and documented here only where connectors touch them.
>
> **History & rationale** (locked design decisions, phasing, alternatives considered) live in the planning docs under `plans/data-connectors/` — the master index is `plans/data-connectors/claude-data-connectors-plan.md`, and `plans/data-connectors/claude/HANDOFF.md` records what landed. This guide is the durable as-built overview; the plans are the deeper "why".

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [The Mental Model](#2-the-mental-model)
3. [Backend: Data Model](#3-backend-data-model)
4. [Backend: Connectors (the fetch contract)](#4-backend-connectors-the-fetch-contract)
5. [Backend: The Mapping Layer](#5-backend-the-mapping-layer)
6. [Backend: The Entity Sink](#6-backend-the-entity-sink)
7. [Backend: The Sync Orchestrator](#7-backend-the-sync-orchestrator)
8. [Backend: Queues, Scheduling & Workers](#8-backend-queues-scheduling--workers)
9. [Write Semantics: Modes, Identity, Merge](#9-write-semantics-modes-identity-merge)
10. [tRPC Surface](#10-trpc-surface)
11. [Frontend: Pages, Components & Flows](#11-frontend-pages-components--flows)
12. [Cross-Cutting: Flags, Tiers, App Wiring](#12-cross-cutting-flags-tiers-app-wiring)
13. [End-to-End Flows](#13-end-to-end-flows)
14. [Invariants & Gotchas](#14-invariants--gotchas)
15. [Known Gaps](#15-known-gaps)

---

## 1. Executive Overview

A **DataConnector** is an org-owned definition of *where structured records come from and how to keep them in sync as entity records*. It runs on a schedule/trigger, pulls records from an external provider, and writes them as **EntityInstances + FieldValues** — create-or-update, idempotent, reconcilable.

It is the structured-data sibling of **Knowledge Sources**: where a `KnowledgeSource` files external *content* as Articles in a hidden KB, a `DataConnector` files external *records* as entities in a normal, sidebar-visible definition. The two share a deliberately connector/sink-agnostic spine — `runDataConnectorSync` never branches on provider.

**Positioning — sync-to-store, not fetch-live.** This feature deliberately *replicates* external records into the entity tables on a schedule, so they can be filtered, segmented, related, reported on, and retrieved by agents with low latency. It is complementary to, not a replacement for, the live app-tool path (an agent calling `get_order` mid-conversation). Rule of thumb: **sync** when data is browsed/filtered/related/reported on; **live tool** when it's a one-off real-time lookup.

Three defining decisions:
- **Target is a choice, not forced.** A mapping either provisions and owns a definition ("Shopify Orders") or contributes into an existing one (including system `contact`/`ticket`).
- **One fetch fans out to N mappings.** A connector yields one source schema per stream; the org configures N `DataConnectorMapping` rows that each extract a subtree onto a target def, with relationships derived from the schema tree.
- **The entity sink is the only writer.** Whether a connector runs as built-in lib code or in an app sandbox, all entity writes happen platform-side through `UnifiedCrudHandler`, firing entity events so workflows/agents react.

---

## 2. The Mental Model

```
DataConnector ──references──▶ Credential (the same connection an app's OAuth flow minted)
      │ sync run (scheduled / manual)  →  DataConnectorRun (health ledger)
      ▼
 connectorFor(type) ──┬─ built-in lib connector (generic-rest, fixture) ──▶ fetch directly
                      └─ app connector (defineDataConnector — Shopify) ──▶ sandbox fetch
      │   ConnectorRecord { streamKey, fields (RAW payload), externalId?, displayName? }
      ▼
 mapping layer (mapRecord) — one fetch fans out to N DataConnectorMapping rows
      │  per mapping: extract rootPath subtree → eval CALC field mappings → upsert | reference
      ▼
 entitySink (platform-side — the ONLY entity writer)
      │  resolve identity:  DataConnectorItem exact bind (per mapping)  →  else identityStrategy bootstrap  →  create + bind
      │  per-field merge strategy; content-hash skip; fire entity events
      ▼
 EntityInstance + FieldValue              DataConnectorItem (durable upstream↔instance binding, per mapping)
      │  owned        → connector-provisioned def, row provenance set, orphan-archive OK
      │  contributing → existing def (contact/ticket/custom), per-field ownership, never archive
      └─ relationship pass: pendingRelations (targetMappingId, externalId) → real RELATIONSHIP
```

Key distinctions:
- A **connector** says only how to *fetch + normalize to a source schema*.
- A **`DataConnectorMapping`** is org config mapping a subtree of that schema onto a target def (the fan-out).
- An **EntityDefinition** is the target — owned, or merely contributed-to.
- An **EntityInstance** is one synced record (in contributing mode, co-owned field-by-field by several connectors + the helpdesk).
- A **`DataConnectorItem`** binds one upstream record (per mapping) to one instance and is the authoritative match key in steady state.

---

## 3. Backend: Data Model

**Location:** `packages/database/src/db/schema/data-connector*.ts`. Canonical TS types for the jsonb columns live in `packages/lib/src/data-connectors/types.ts`; the DB package carries structural mirrors in `data-connector-types.ts` (tier 1 can't import `@auxx/lib`) — kept in sync by hand.

Five control tables:

| Table | File | Role |
|-------|------|------|
| `DataConnector` | `data-connector.ts` | The connector definition: `type`, `config` (jsonb — generic-rest `endpoint` + filters), bound `credentialId`, schedule, status. One per type per org (v1). |
| `DataConnectorStream` | `data-connector-stream.ts` | One fetch = one source schema. Holds `streamKey` (nullable — a draft is created blank and named inline), `requestConfig` (jsonb), `sourceSchema` + `schemaSource`, `syncMode`. |
| `DataConnectorMapping` | `data-connector-mapping.ts` | The fan-out. Self-FK `parentMappingId` for nested subtrees; `rootPath`, `targetMode` (owned/contributing), `linkMode` (upsert/reference), `entityDefinitionId`, `fieldMappings` (jsonb array of entries), identity config. |
| `DataConnectorItem` | `data-connector-item.ts` | Durable upstream↔instance binding, **per mapping**. Unique `(dataConnectorId, mappingId, externalId)`. Carries content hash + cursor state off the entity row. |
| `DataConnectorRun` | `data-connector-run.ts` | Health/run ledger (counts, status, errors). |

Plus: `dataConnectorStatus` + `dataConnectorSyncBehavior` pgEnums in `_shared.ts`; a nullable `dataConnectorId` FK on `custom-field.ts` and `entity-definition.ts` (marks connector-provisioned schema).

**Provenance.** Owned mode sets `integrationSource = connectorId` on created instances; contributing mode leaves `integrationSource` untouched (so it never collides with another integration or breaks `findByIntegrationId`). The authoritative match key is always the `DataConnectorItem` row, not `integrationSource`.

**`requestConfig` (per stream, generic-rest):** `{ path?, method?, params?, body?, headers?, pagination? }`. **`config.endpoint` (per connector, generic-rest):** `{ baseUrl, auth?, pagination?, headers? }`. At fetch time headers merge low→high: `Accept` < `endpoint.headers` (shared) < `requestConfig.headers` (per-stream) < credential auth (applied by the HTTP transport).

---

## 4. Backend: Connectors (the fetch contract)

**Location:** `packages/lib/src/data-connectors/connectors/`.

A connector's only job is to fetch and yield records normalized to a source schema. The contract (`connectors/types.ts`):

```ts
interface ConnectorRecord {
  streamKey: string
  fields: unknown          // the RAW payload (array OR object) — the source schema mirrors this
  externalId?: string      // optional hint, used only for a whole-record root the subtree can't self-identify
  displayName?: string
}
```

`connectorFor(type, context?)` (`connectors/registry.ts`) is the single resolution point. Connector flavors:

- **Built-in lib connectors** read the resolved credential directly, no sandbox:
  - `generic-rest.ts` — no-code HTTP/JSON connector. Reads `config.endpoint` (baseUrl/auth/pagination/headers) + per-stream `requestConfig` (path/method/params/body/headers/pagination), paginates (cursor / link-header / page / offset), and **yields the raw response body per page** (`fields: body`). The root mapping's `rootPath` selects the records within it — there is no separate envelope-stripping step.
  - `fixture.ts` — dependency-free fixture used to prove the spine in tests.
- **App connectors** (`app-connector-adapter.ts`) — declared in an app's SDK via `defineDataConnector` (`@auxx/sdk/data-connectors`). The adapter resolves the installed app's catalog connector and, inside `fetch()`, **lazy-imports** the app-runtime cluster (`@auxx/lib/apps`), resolves the borrowed connection (with lazy-refresh), and invokes the sandbox via the lambda executor (`apps/lambda/src/executors/data-connector-executor.ts`). App connectors declare their schema in the catalog and yield per-record (`rootPath ''`).
- **Templates** (`templates/`) — `connector-template-registry.ts` + `defs/` seed a generic-rest connector pre-wired with an endpoint, streams, and recommended field mappings (target entity def + field refs). Contributing-only in v1.

**Source schema invariant:** `sourceSchema` describes `ConnectorRecord.fields` (the raw payload). For a collection response (`[ {…} ]`) the root is an `array`; the root mapping's `rootPath` (`[]`, `data.orders[]`, or `''` for a single record) selects record subtrees. Child mappings extract relative to their parent subtree.

---

## 5. Backend: The Mapping Layer

**Location:** `packages/lib/src/data-connectors/map-record.ts` (`mapRecord`).

`mapRecord` is a recursive tree walk over the connector record + the mapping tree:
- The **root mapping** extracts its `rootPath` subtree(s) from the raw payload.
- Each **child mapping** extracts relative to its parent subtree (`parentMappingId` drives nesting).
- For each subtree it evaluates the mapping's `fieldMappings` — each entry is `{ id, targetFieldRef, expression, sourceFields, match?, mergeStrategy? }`. `targetFieldRef` is a canonical `ResourceFieldId` (`${entityDefinitionId}:${fieldId}`), nullable for an unassigned draft formula the runtime skips. CALC expressions evaluate against the subtree-relative `sourceFields`.
- Identity candidates are resolved **from the source subtree** (`connectorFieldKey` is subtree-relative) and stamped on the projected record, so the sink matches on real source values.
- `linkMode` decides upsert (write the instance) vs reference (id-only — wired later as a relationship). Cross-record references produce `pendingRelations { targetMappingId, externalId }`.

Path contract (enforced): `rootPath` is record-absolute; `sourceFields` paths and identity `connectorFieldKey` are subtree-relative to the mapping's `rootPath`; `externalId`/`displayName` are connector-derived sync-time lineage, never surfaced in the editor.

---

## 6. Backend: The Entity Sink

**Location:** `packages/lib/src/data-connectors/sinks/entity-sink.ts`. This is the **only** code path that writes entities for connectors.

Per projected record, the sink:
1. **Resolves identity.** First an exact `DataConnectorItem` bind (per mapping) → else runs the mapping's `identityStrategy` to bootstrap (`crud.lookupByField`, column-aware + normalizing) → else creates and binds a new `DataConnectorItem`.
2. **Content-hash skips.** Computes a sorted-key `stableHash` (`@auxx/utils/hash`) of the mapped values; if unchanged vs the bound item, it skips the write (idempotent re-sync). jsonb reorders keys, so naive `JSON.stringify` would false-stale — always the sorted-key hash.
3. **Applies per-field merge strategy** and writes through `UnifiedCrudHandler.create/update` (which coerces every value through the typed FieldValueService converters). Writes fire `entity.created/updated` events — connectors deliberately do **not** `skipEvents` (unlike the CSV importer) so workflows/agents react.

Owned vs contributing behavior is enforced here (see §9).

---

## 7. Backend: The Sync Orchestrator

**Location:** `run-data-connector-sync.ts` (`runDataConnectorSync`), with `relationship-pass.ts` and `reconciliation.ts`.

A run, provider-agnostic:
1. Open a `DataConnectorRun`, resolve the connector + bound credential (refreshed).
2. For each enabled (named) stream: `connectorFor(type)` → `fetch(args)` (passing `requestConfig`, mode, cursor state) → stream pages lazily.
3. Each record → `mapRecord` → `entitySink`. Parent lookups are keyed by `(mappingId, externalId)` so fan-out children wire to the right parent instance.
4. **Relationship two-pass:** after the upsert pass, `pendingRelations` are resolved against `DataConnectorItem` bindings into real `RELATIONSHIP` field values.
5. **Reconciliation:** for owned + snapshot + upsert mappings, records absent from the snapshot are archived (`archivedAt`); incremental mode never archives on absence. Real deletes come only from explicit delete signals (`handleConnectorDelete`).
6. Persist cursor state + close the run with counts.

The `sampleConnectorFetch` helper (`connector-runtime.ts`) reuses the exact fetch path for the UI test-fetch, stopping at the first raw page — so test-fetch and scheduled sync can't diverge on auth or shape. (Generic-rest is fully live; `app:` sample-fetch is still gated — see §15.)

---

## 8. Backend: Queues, Scheduling & Workers

- **Queue:** `data-connector-queue.ts` — `dataConnectorQueue` + `enqueueConnectorSync`.
- **Scheduler:** `data-connector-scheduler.ts` — `reconcileConnectorSchedulers` / `syncConnectorScheduler` / `removeConnectorScheduler`, driven by the connector's `ScheduledTriggerConfig` (shared agent/workflow frequency model; minutes floor is coarse).
- **Worker:** `apps/worker/src/workers/worker-definitions/data-connector-worker.ts`, bound to the queue (concurrency 2, cancellable). `reconcileConnectorSchedulers` runs on worker boot (`apps/worker/src/workers/index.ts`).
- **Webhook** sync behavior is modeled (`dataConnectorSyncBehavior = 'webhook'`) but the URL + signing-secret panel is a placeholder.

---

## 9. Write Semantics: Modes, Identity, Merge

**Two write modes, per mapping:**
- **Owned** — provision and own a definition (custom fields default to `FieldType.TEXT`, `isUpdatable:false` so users can't hand-edit synced fields). Row provenance set; orphan archive allowed.
- **Contributing** — write into an existing def (system `contact`/`company`/`ticket` or any custom def). Per-**field** ownership; never archives the instance (other owners share it). Editable shared fields are protected per-record by the `fill_blank` merge strategy. "Detach" is an explicit settings action — there's no separate freeze mechanism; it's all field capabilities.

**Identity strategies** (first-class union, bootstrap-only — `DataConnectorItem` is steady state): `connectorExternalId` | `matchField` | `composite` | `manualReview`. `matchField`/`composite` carry `connectorFieldKey` (subtree-relative source path) → `targetFieldId`.

**Merge strategies** (first-class per-field): `overwrite` | `fill_blank` | `connector_owned_only` | `manual_review` | `ignore`. Conservative defaults on shared CRM data; these govern only how the *connector* writes — user read-only is the `isUpdatable` field capability.

**Schema provisioning:** `provisioning.ts` provisions owned defs/fields and lazily provisions contributing targets. Field mappings are stored as a jsonb **array of entries** (stable `id` per entry) — not a Record keyed by target — because jsonb reorders keys.

---

## 10. tRPC Surface

**Router:** `apps/web/src/server/api/routers/data-connectors.ts`, registered as `dataConnector` in `root.ts`. All procedures are `adminProcedure`. Highlights:

- Connector CRUD: `list`, `getById`, `create`, `update`, `remove`, plus `connectorSchema` (app/template config JSON-schema).
- Streams: `listStreams`, `addStream`, `updateStream`, `setStreamRequestConfig`, `setStreamSchema`, `removeStream`.
- Mappings: `addMapping`, `updateMapping`, `removeMapping` (the single mapping write surface).
- `sampleFetch` — runs the real fetch path for one page (the test-fetch); returns `{ response, recordCount }` (the raw first-page body). Generic-rest only for now.
- Sync control: enqueue a manual sync; runs are read for the docked Runs panel.

Write helpers live in `packages/lib/src/data-connectors/mutations.ts`; reads/CRUD in `service.ts` (functional Drizzle + neverthrow, no model classes).

---

## 11. Frontend: Pages, Components & Flows

**Routes:** `apps/web/src/app/(protected)/app/connectors/page.tsx` (list) + `[connectorId]/page.tsx` (detail). Menu entry: Connectors in the Resources group (`adminOnly`, `featureKey: 'dataConnectors'`, `Cable` icon).

**Components:** `apps/web/src/components/data-connectors/{ui,hooks}`. Single setup-and-edit detail view (no wizard), modeled on the agent detail page — NavStack scroll-spy sections + a connector-wide save bar.

Key UI files (`ui/`):
- `connector-list.tsx`, `connector-card.tsx`, `connector-detail-view.tsx`, `connector-detail-tabs.tsx` (NavStack + `useScrollSpy`).
- `connection-section.tsx` — the bound `Credential` (a `ConnectionRow` + connection picker); resolves the connection's brand icon + name.
- `source-config-panel.tsx` — connector-level config: generic-rest endpoint (base URL + shared headers, via the reveal-chip pattern) or an app/template schema-driven form.
- `streams-section.tsx`, `stream-detail-bar.tsx`, `stream-config-panel.tsx` — the per-stream drill: Layer A (source schema) + Layer B (fan-out mappings). Request sub-editors (headers/query params/JSON body) are in `request-editors.tsx`.
- `mapping-tree.tsx`, `mapping-node.tsx`, `branch-row.tsx`, `mapping-field-picker.tsx`, `source-leaf-row.tsx`, `source-path-badge.tsx` — the fan-out tree + humanized field picker.
- `field-calc-dialog.tsx` — the `ƒ` calc drill (focused editor over `@auxx/utils/calc-expression`, decoupled from the entity TipTap field picker).
- `merge-strategy-toggle.tsx`, `field-type-compat.ts`, `mapping-columns.ts`.
- `schedule-section.tsx`, `connector-runs-panel.tsx`, `connector-status.tsx`, `stream-sample.tsx`, `connector-save-bar.tsx`.

Key hooks (`hooks/`): `use-connector-mutations.ts`, `use-stream-mutations.ts` (optimistic stream/mapping mutations), `use-buffered-config.ts` (manual/auto-commit draft buffer), `use-connector-edits.tsx` (the save-bar registry), `use-source-paths.ts` (`flattenSourceSchema` + subtree-relative `leafPathsUnder`).

**Shared extractions** (used by workflow/MCP/connectors): the HTTP request builder (`components/global/http-request/` — KeyValue/body editors behind an injectable `FieldEditor` context seam; the connector surface injects a plain input, the workflow node injects TipTap), the schedule editors (`components/global/schedule/`), the schema form (`components/global/schema-form/`), the shared schema editor (`components/schema-editor/`), and `useScrollSpy`.

---

## 12. Cross-Cutting: Flags, Tiers, App Wiring

- **Feature flag:** `dataConnectors` in `FeatureKey` + `FEATURE_REGISTRY` (`packages/lib/src/permissions/types.ts`) and seeded as a boolean gate (all tiers).
- **Package tiers:** the engine is entirely in `@auxx/lib` (tier 3). The app-connector adapter invokes the lambda via the app-runtime cluster (`@auxx/lib/apps`) — **lazy-imported** to keep billing/dist out of vitest. The `@auxx/lib/data-connectors` barrel is server-only — never import it from client code.
- **SDK:** `packages/sdk/src/root/data-connectors/` (`defineDataConnector`), exported at `@auxx/sdk/data-connectors`. App catalogs serialize `app.dataConnectors` → `AppDeployment.catalog.dataConnectors`, projected onto the `installedApps` org-cache key for bundle-free discovery.
- **App-token refresh:** a connector borrowing an app's OAuth credential relies on lazy-refresh on the shared `Credential` (resolve → refresh if expired → 401-retry).

---

## 13. End-to-End Flows

**Generic-REST, owned mode (the spine):**
1. Create a generic-rest connector; set `endpoint.baseUrl` (+ optional shared headers) in `source-config-panel`.
2. Add a stream; in the stream drill set `requestConfig` (path/params/headers), run **test-fetch** (`sampleFetch`) → infer the source schema from the raw response.
3. Add a root mapping with `rootPath` selecting the records; one-click map source leaves onto an owned def (or `ƒ` calc). Set identity (default `connectorExternalId`).
4. Sync now → `runDataConnectorSync` → `mapRecord` → `entitySink` creates `EntityInstance`s + `DataConnectorItem` binds + a `DataConnectorRun`. Re-sync is idempotent (content-hash skip).

**Contributing into `contact`:** point a mapping at the system `contact` def, `targetMode: contributing`, identity `matchField` (`customer.email` → `email`, normalized). The sink upserts onto existing contacts per-field, never archiving them.

**App connector (Shopify):** the Shopify app (in the separate `auxxai-apps` repo) declares streams/targets via `defineDataConnector`; the adapter runs its `fetch` in the sandbox and returns source-shaped records that ride the exact same mapping → sink path. Orders/line-items as owned defs, customers contributing into `contact`.

---

## 14. Invariants & Gotchas

- **The sink is the only entity writer.** Connectors fetch; the platform writes. Never write entities from a connector/sandbox.
- **`runDataConnectorSync` never branches on provider.** Provider-specific logic belongs in the connector's `fetch`, nowhere downstream.
- **Source schema mirrors the raw payload**, and `rootPath` selects records within it. `sourceFields`/`connectorFieldKey` are subtree-relative; `rootPath` is record-absolute.
- **Content hash uses sorted-key `stableHash`.** Never `JSON.stringify` for hashing — jsonb reorders keys and you'll false-stale (compare-and-set churn).
- **Field mappings are a jsonb array of entries with stable ids**, not a Record keyed by target (same jsonb-reordering reason).
- **`integrationSource` namespace:** owned sets it to `connectorId`; contributing leaves it alone. Don't overload it with compound strings.
- **`targetFieldRef` is a canonical `ResourceFieldId`** (`entityDefinitionId:fieldId`), nullable for an unassigned draft (skipped at runtime).
- **DB mirror types vs canonical lib types** (`data-connector-types.ts` ↔ `types.ts`) are hand-synced — update both on any column/type change.
- **PII at rest:** synced records are stored and agent-retrievable; default-drop + PII flags are a governance requirement.
- **Don't revive the deprecated `shopify_products`/`shopify_customers`/`shopify_addresses` tables** — superseded by the generic entity model.
- **`ExternalKnowledgeSource` is unrelated** — a dormant table; don't wire connectors against it.

---

## 15. Known Gaps

Tracked in `plans/data-connectors/claude/HANDOFF.md` §3 (none block the spine):
- **App `sampleFetch`** is gated — app connectors don't yet exercise the test-fetch/inference path (they declare schema in catalog and yield per-record, which the model handles). Generic-rest is fully live.
- **App-connector discovery over tRPC** (the catalog branch of the connect-source flow) is not fully exposed.
- **Webhook** schedule segment is a placeholder (the URL + signing-secret panel isn't built).
- **Per-mapping dry-run** (create/update/skip/archive + identity/relationship preview) isn't a procedure yet — the UI shows the raw test-fetch sample only.
- **`mark_deleted`** orphan behavior stamps `archivedAt` only (a canonical connector-status field isn't provisioned); `archive`/`ignore` are fully wired.
- **Multi-connector-per-type / multi-connection** is v1-deferred (one connector per type per org; unique index on the connector, not the target def).
