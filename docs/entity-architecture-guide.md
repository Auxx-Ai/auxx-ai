# Entity Architecture Guide

**Last Updated:** 2026-06-17
**Scope:** The unified entity / field-value / custom-field system — backend data model, service/resolution layer, and frontend rendering.

> This is the living reference for how records, fields, and field values work end-to-end.
> It supersedes the older `plans/entity/unified-entity-architecture-v5.md` (Jan 2026), which predates
> the row-id canonical field-identity change (`#734`, 2026-06-03) and several schema additions.
>
> **Companion — the reactive layer.** How records/fields *react* to changes (record rules,
> field/entity triggers, conditions/actions, and sync-change events for connector/import writes)
> lives in **`entity-events-architecture-guide.md`**. This guide covers the data model + read/write
> path; that one covers "when X changes, do Y".

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Core Concepts & Vocabulary](#2-core-concepts--vocabulary)
3. [Backend: Data Model](#3-backend-data-model)
4. [Backend: Service & Resolution Layer](#4-backend-service--resolution-layer)
5. [Field-Reference Resolution (the canonical-id model)](#5-field-reference-resolution-the-canonical-id-model)
6. [tRPC Surface](#6-trpc-surface)
7. [Frontend: Stores & Hydration](#7-frontend-stores--hydration)
8. [Frontend: Rendering & Editing](#8-frontend-rendering--editing)
9. [End-to-End Data Flows](#9-end-to-end-data-flows)
10. [Field Types Reference](#10-field-types-reference)
11. [Gotchas & Invariants](#11-gotchas--invariants)

---

## 1. Executive Overview

Auxx.ai is moving away from rigid table-per-entity schemas (a `Contact` table, a `Ticket` table, …)
toward a **dynamic entity system**: one set of generic tables that can represent both **system entities**
(contact, ticket, thread, user, company) and **organization-defined custom entities** (deals, products,
tasks, …) without schema migrations.

Four tables carry the model:

| Table | Role |
| --- | --- |
| **EntityDefinition** | Defines an entity *type* (system or custom): labels, icon/color, display fields, api slug. |
| **EntityInstance** | A *record* of some entity type (one row per record). Carries denormalized display/search columns. |
| **CustomField** | A *field definition*: type, capabilities, options, system attribute, ordering. |
| **FieldValue** | A *typed value* — **one row per value** (multi-value fields = multiple rows). |

On top of the raw tables sits a **Resource registry** (`@auxx/lib/resources`) that merges a static
code-defined registry of system fields with the org's DB `CustomField` rows, producing a single unified
`Resource` (with `ResourceField[]`) that every read/write path and the frontend consume. The
**FieldValueService** (`@auxx/lib/field-values`) is the typed read/write engine, and the
**UnifiedCrudHandler** is the single entry point for create/update/delete across all entity types.

Everything is org-scoped and heavily cached per-org (`@auxx/lib/cache`); the frontend mirrors the same
shape into Zustand stores with fine-grained, per-cell subscriptions.

---

## 2. Core Concepts & Vocabulary

- **RecordId** — `"${entityDefinitionId}:${entityInstanceId}"`. Identifies one record. The
  `entityDefinitionId` half is *interchangeable*: a system type string (`contact`) or the EntityDefinition
  UUID both resolve to the same resource (see `findCachedResource`).
- **ResourceFieldId** — `"${entityDefinitionId}:${fieldId}"`. Identifies one field on one entity type.
- **FieldPath** — `ResourceFieldId[]`, e.g. `["product:vendor", "vendor:name"]`. A relationship traversal
  (read the vendor relationship on a product, then the vendor's name). Max depth 5 hops.
- **FieldReference** — union of `ResourceFieldId | FieldPath`. The unit the read path and the table cells
  speak in.
- **Canonical field id** — the **`CustomField` row UUID**. Since `#734` this is the single identity used to
  store and key all field values. Static keys (`firstName`) are accepted at the API boundary and resolved
  to the row id internally. See §5.
- **Resource** — the merged, unified view of an entity type (registry metadata + DB custom fields). What
  `resource.list` returns and what the frontend `resourceStore` holds.
- **systemAttribute** — a stable identifier on a `CustomField` (e.g. `primary_email`, `display_name`) that
  marks a field as backing hard-coded system behavior, independent of its display name or row id.

Type helpers live in `@auxx/types/field`: `buildFieldValueKey`, `parseRecordId`, `toResourceFieldId`,
`parseResourceFieldId`, `fieldRefToKey`, `keyToFieldRef`, `normalizeFieldRef`.

---

## 3. Backend: Data Model

Schema files: `packages/database/src/db/schema/`. Field-type enum: `packages/database/src/enums.ts` and the
`contactFieldType` pgEnum in `_shared.ts`.

### EntityDefinition — `entity-definition.ts`

Defines an entity type. Key columns:

- `id` (PK, cuid2), `organizationId` (FK, cascade), `createdAt`, `updatedAt`, `archivedAt` (soft-delete)
- `apiSlug` — URL-friendly id (`products`); unique per org where not archived
- `singular` / `plural` — display labels; `color` (default `blue`), `icon` (default `Box`)
- `entityType` — `'standard' | 'contact' | 'user' | 'thread' | 'ticket' | 'entity_group' | null`. System
  entity types are represented as EntityDefinition rows with the matching `entityType`.
- `standardType` — for `entityType='standard'`: `'company' | 'task' | 'deal' | 'custom' | null`
- `primaryDisplayFieldId`, `secondaryDisplayFieldId`, `avatarFieldId` — FKs → `CustomField.id` (set null).
  Drive the denormalized display columns on EntityInstance.
- `isVisible` — show in sidebar

### EntityInstance — `entity-instance.ts`

One row per record. Field values live in FieldValue; this table holds identity + denormalized hot columns:

- `id` (PK), `entityDefinitionId` (FK, cascade), `organizationId` (FK, cascade), `createdById`,
  `createdAt`, `updatedAt`, `archivedAt`
- `displayName`, `secondaryDisplayValue`, `avatarUrl` — denormalized from the EntityDefinition's display
  fields for fast list rendering/sorting (kept in sync on write)
- `searchText` — pre-concatenated full-text blob (GIN index via raw SQL)
- `metadata` (jsonb) — system-managed, shape varies by `entityType` (typed at the service layer)
- `lastActivityAt`, `lastSuggestionScanAt` — activity tracking + AI suggestion-scan suppression
- `integrationSource`, `externalId` — provenance for imported/synced records (indexed for lookup)

### CustomField — `custom-field.ts`

A field definition. Key columns:

- `id` (PK — **this is the canonical field id**), `organizationId` (FK), `entityDefinitionId` (FK, cascade)
- `name`, `type` (`contactFieldType` enum — see §10), `description`, `icon`
- `modelType` (default `contact`) — legacy/system grouping (`contact`, `ticket`, `thread`, `entity`, …)
- `required`, `active`, `defaultValue`, `sortOrder` (fractional index, collate C)
- `options` (jsonb) — for SINGLE_SELECT/MULTI_SELECT/TAGS: `[{ id, label, color }]`
- `displayOptions` (jsonb) — UI formatting config
- `isCustom` — user-created (true) vs system field (false)
- `systemAttribute` — stable system identity (`primary_email`, `display_name`, …)
- **Capability flags**: `isUnique`, `isCreatable`, `isUpdatable`, `isComputed`, `isSortable`, `isFilterable`
- **App ownership**: `appInstallationId` (FK), `connectionId` (FK → Credential, for connection-scoped
  fields), `appFieldKey` (stable id for idempotent provisioning), `isHidden` (readable by system, hidden
  from UI)

Uniqueness: user/system fields dedup on `(name, org, modelType, entityDefinitionId)` where no app owner;
app fields dedup on `(appInstallationId, connectionId, appFieldKey, modelType, entityDefinitionId)`.

### FieldValue — `field-value.ts`

**One row per value.** Multi-value fields produce multiple rows sharing `(entityId, fieldId)` with distinct
`sortKey`. Only one typed column is populated per row.

- `id` (PK), `organizationId` (FK, denormalized for fast queries), `createdAt`, `updatedAt`
- `fieldId` (FK → `CustomField.id`, cascade) — **always the row UUID**
- `entityId` — the record id (EntityInstance / contact / ticket / …)
- `entityDefinitionId` — the entity type (UUID or system string)
- **Typed value columns** (exactly one used per row):
  - `valueText` — TEXT, RICH_TEXT, NAME, EMAIL, URL, PHONE_INTL, ADDRESS
  - `valueNumber` — NUMBER, CURRENCY (amount)
  - `valueBoolean` — CHECKBOX
  - `valueDate` — DATE, DATETIME, TIME
  - `valueJson` — FILE, ADDRESS_STRUCT, CURRENCY (`{amount, code}`), CALC, JSON, AI metadata
  - `optionId` — SINGLE_SELECT / MULTI_SELECT / TAGS (refs `CustomField.options[].id`)
  - `relatedEntityId` + `relatedEntityDefinitionId` — RELATIONSHIP
  - `actorId` (FK → User) — ACTOR
- `sortKey` (collate C, fractional index) — ordering for multi-value rows; unique on
  `(entityId, fieldId, sortKey)` so rows can reorder
- `aiStatus` — `null | 'generating' | 'result' | 'error'`; `'stale'` is derived at read time

Per-type **partial indexes** (`lookup_text_idx`, `lookup_number_idx`, `lookup_option_idx`,
`lookup_related_idx`, `lookup_actor_idx`, `lookup_date_idx`) index only non-null rows of each column —
cheap writes, fast `findByField` lookups.

### Supporting tables

- **EntityGroupMember** (`entity-group-member.ts`) — membership in groups/teams (an EntityInstance with
  `entityType='entity_group'`). Polymorphic: `memberType` ∈ `entity | user`, `memberRefId` interpreted
  accordingly. Unique on `(groupInstanceId, memberType, memberRefId)`.
- **ResourceAccess** (`resource-access.ts`) — generic per-resource ACL. Resource = `entityDefinitionId`
  (UUID or built-in string like `inbox`/`workflow`/`document`) + optional `entityInstanceId`. Grantee =
  `granteeType` (`group | user | team | role`) + `granteeId`. `permission` ∈ `view | edit | admin`.
- **ThreadEntityLink** (`thread-entity-link.ts`) — secondary thread↔entity associations beyond
  `Thread.primaryEntityInstanceId`. Soft-deletable via `unlinkedAt` (re-link allowed; partial unique on
  active links).

---

## 4. Backend: Service & Resolution Layer

Code: `packages/lib/src/field-values/` and `packages/lib/src/resources/`.

### Resource registry — `resources/registry/`

- **Static registry** (`field-registry.ts`): `RESOURCE_TABLE_REGISTRY` (metadata for system tables —
  contact, ticket, thread, user, inbox, …) and `RESOURCE_FIELD_REGISTRY` (their built-in fields).
  `SYSTEM_FIELD_KEYS` is the set of all static keys.
- **ResourceRegistryService** (`resource-registry-service.ts`): merges the static registry with the org's
  DB `CustomField` rows into unified `Resource`s via `mergeSystemAndCustomFields`. After merge, a
  `ResourceField.id` is **always the DB row UUID** (even for system fields), and the EntityDefinition's
  display-field pointers are reconciled to the merged row ids.
- **`ResourceField`** (`registry/field-types.ts`): `{ id (row UUID), key (static key), label, type (base
  type for the workflow engine), fieldType (FieldType enum), resourceFieldId, options, capabilities,
  relationship/relationshipConfig, … }`.

### FieldValueService — `field-values/field-value-service.ts`

The orchestrator. Wraps a shared **`FieldValueContext`** (`field-value-helpers.ts`) carrying per-request
caches: `fieldCache` (memoized `CachedField` per fieldId), `entityDefIdCache` (system type → UUID),
relationship-validation cache, the validator, and `bypassFieldGuards` (trusted callers like the seeder skip
pre-hooks).

**Write path** (`field-value-mutations.ts`): `setValue` / `setValueWithBuiltIn` / `setValuesForEntity` /
`setBulkValues` / `applyBulk` (the unified set/add/remove bucketer) / `addValue` / `removeValue` /
relationship add/remove variants. A write:
1. Resolves the field via `getField` (org cache, no DB).
2. Validates + coerces via `FieldValueValidator` (Zod per type; normalizes email→lowercase,
   phone→E.164, etc.) and the `converters/` (one per type).
3. Fires per-field **pre-hooks** (transform or drop), unless bypassed.
4. Checks uniqueness (`checkUniqueValueTyped`) when `isUnique`.
5. Canonicalizes relationship ids (system type → EntityDefinition UUID).
6. Persists — UPDATE for single-value, DELETE+INSERT for multi-value.
7. Syncs inverse relationships (`relationship-sync.ts`), updates denormalized `displayName` if a display
   field changed, publishes field-trigger + realtime events (excluding the originating socket). The
   field-trigger step is the entry into the **record-rules engine** — see
   `entity-events-architecture-guide.md`. (Connector/import writes use `skipEvents` and instead feed
   the sync-change manifest; same guide, §8.)

**Read path** (`field-value-queries.ts`): `getValue` (single), `getValues` (multi-field, single JOIN to
avoid N+1, returns `Map<fieldId, …>`), and `batchGetValues` — the workhorse that powers `fieldValue.batchGet`.
It accepts a mix of `ResourceFieldId`s and `FieldPath`s, validates all references up front
(`validateFieldReferences`, max 5 hops, non-terminal hops must be RELATIONSHIP), then traverses in
**O(max path depth)** queries regardless of record count. DB rows → `TypedFieldValue` via the converters;
`formatter.ts` produces display-ready values.

**Supporting modules**: `relationship-queries.ts` (batch relationship + system-table fetches),
`display-field-service.ts` / `display-field-deps.ts` (recompute denormalized display columns when display
pointers change), `calc-resolver.ts` (server-side CALC computation, recursion depth-guarded),
`normalize-for-lookup.ts` (read-side normalization mirroring write validation, for `findByField` dedup),
`resolvers/` (system-table + system-relationship + thread virtual fields).

### UnifiedCrudHandler — `resources/crud/unified-handler.ts`

Single entry point for entity CRUD across system + custom: `create`, `update`, `delete`, plus
`findByField` / `findOrCreate` (priority-ordered equality matching with `normalizeForLookup`) and bulk
variants. Uses ResourceRegistryService + FieldValueService internally.

### Org cache — `packages/lib/src/cache/`

Per-org caches (see CLAUDE.md "Org Cache" rules): `resources`, `customFields`, `entityDefs`,
`entityDefSlugs`, plus members/groups/agents/etc. Helpers: `getCachedResource`,
`getCachedResourceFields`, `getCachedCustomFields`, `getCachedEntityDefId`, `getCachedFieldMap`. The field
read/write paths hit the cache, not the DB, for field metadata — **re-querying defeats invalidation.**

---

## 5. Field-Reference Resolution (the canonical-id model)

This is the part most likely to bite, and the part the old plan got wrong.

**Canonical id = the `CustomField` row UUID.** `FieldValue.fieldId` always stores the row UUID, so field
identity is aligned with storage. This landed in commit `53507b1a` / `#734` ("row-id canonical field
identity", 2026-06-03), with follow-up `b8fff9ea` adding static-key aliases + safe display formatting.

Why it matters: before `#734`, a system field's cached `id` could be its **static key** (`firstName`) while
values were stored under the **row id** — three independent keying sites (server value query, server
resolver via cache rehydration, client value-store key) had to translate static↔row and any miss left a
cell silently empty. Making the row id canonical removes that whole class of bugs.

How references resolve today:

- The **entity half** of a reference is interchangeable: `findCachedResource` matches by EntityDefinition
  UUID, `entityType` (`contact`), or `apiSlug` (`contacts`). So `contact:…` ≡ `mzxt…:…`.
- The **field half** accepts a static key *or* the row UUID at the boundary, but resolves to the row UUID.
  `getFieldInfoFromRegistry` returns `field.id` (the row UUID); callers key all FieldValue queries and the
  client value store by that id.
- `buildFieldValueKey(recordId, fieldRef)` (`@auxx/types/field`) builds the client cache key
  `entityDefId:entityInstId:fieldRefKey`, where the field portion is the row UUID.

**Rule of thumb:** when writing new read/write code, never key field values by static key — resolve to the
row id (via the registry/cache) first.

---

## 6. tRPC Surface

Routers: `apps/web/src/server/api/routers/`.

- **`resource.ts`** — `list` (all resources, system + custom, with embedded merged fields; hydrated once on
  app load), `getById`.
- **`fieldValue.ts`** — `batchGet` (`{ recordIds[], fieldReferences[] }`, supports FieldPath traversal;
  bounded per call), `set` (`{ recordId, fieldId, value?, ai?, mode }` where mode ∈ set/add/remove),
  `setBulk`, `add`, `remove` / `removeRelation`, `delete`.
- **`record.ts`** — `getById` / `getByIds`, `create`, `update`, `delete`, `search` / `globalSearch`,
  `lookupByField`.
- **`customField.ts`** — CRUD for `CustomField` rows + entity-definition mutations
  (`createEntityDefinition`, `updateEntityDefinition`, …).
- **`entityDefinition.ts`**, **`entityGroup.ts`**, **`resourceAccess.ts`** — entity-type, group-membership,
  and ACL management.

RecordId inputs are the `"${entityDefinitionId}:${entityInstanceId}"` string (entity half interchangeable).

---

## 7. Frontend: Stores & Hydration

Code under `apps/web/src/components/resources/` and `apps/web/src/components/dynamic-table/`.

**Hydration** — `resources/providers/resource-provider.tsx` runs once at app level:
`api.resource.list` → `resourceStore`; `api.actor.list` → `actorStore`; initializes the field-value fetch
queue with the `fieldValue.batchGet` mutation; relationship items fetched on demand via the relationship
store (`api.record.getByIds`).

**Stores (Zustand, always accessed via selectors):**

- **`resource-store.ts`** — `resources: Resource[]`, `resourceMap` (by id/apiSlug), `fieldMap`
  (`ResourceFieldId → ResourceField`), `systemAttributeMap`. Holds optimistic overlays for field/resource
  create/update/delete with rollback.
- **`field-value-store.ts`** (the primary value cache) — `values: Record<FieldValueKey, StoredFieldValue>`
  keyed by `buildFieldValueKey(recordId, fieldRef)`. Tracks `aiStates`, `fetchingKeys` (loading),
  `pendingUpdates` (optimistic rollback), `mutationVersions` (race handling). Invalidation:
  `invalidateResource(recordId)`, `invalidateField(fieldRef)`, `invalidateByDefinition(entityDefId)`.
- **`field-value-fetch-queue.ts`** — dedupes and batches value requests into `fieldValue.batchGet`,
  enqueued in `useLayoutEffect` (before paint) to avoid first-render flicker.
- **`dynamic-table/stores/dynamic-table-store.ts`** — view/column/sort/filter state (slice-based),
  hydrated from server + persisted to localStorage.
- **`dynamic-table/stores/selection-store.ts`** — Excel-style row/cell range selection, fill-drag, copy
  highlight, kanban selection (per-table).

**Hooks** (`resources/hooks/`):

- `useFieldValue(recordId, fieldRef, { autoFetch })` — subscribes to one value; re-renders only when that
  value/loading changes; auto-queues a fetch if missing.
- `useFieldValues(recordId, fieldRefs[])` — batched, `useShallow`-memoized.
- `useFieldAiState(recordId, fieldId)` — AI marker state for the AI overlay.
- `useResourceFields(entityDefIdOrApiSlug)` — effective field list (server + optimistic) split into
  filterable/sortable/creatable/updatable.
- `useField(resourceFieldId)` — one field's metadata; exposes `effectiveFieldType` (resolves CALC →
  `resultFieldType`).

---

## 8. Frontend: Rendering & Editing

**Table rendering** (`dynamic-table/`):

- `dynamic-view.tsx` — the table orchestrator (Config / Instance / Metadata contexts).
- `dynamic-resource-view.tsx` — loads resources and composes the view; `records-view.tsx` adds
  entity-specific dialogs, bulk actions, drawers.
- Columns are built from `ResourceField[]` by `custom-field-column-factory.tsx`
  (`createCustomFieldColumns`). Column ids encode the reference: a direct field id (`contact:email`) or a
  path joined by `::` (`product:vendor::vendor:name`) — decoded by `utils/column-id.ts`.
  `hooks/use-reconciled-columns.ts` reconciles persisted column order against current field defs.
- `components/custom-field-cell.tsx` decodes the column → `FieldReference`, subscribes via
  `useFieldValue`, fetches field metadata via `useField`, wraps in `AiCellOverlay` when AI-enabled, and
  delegates to `components/formatted-cell.tsx`, which routes to the per-type renderers in
  `utils/cell-renderers.tsx` (date, number, currency, phone, email/url, checkbox, relationship via
  `RecordBadge`, actor via `ActorBadge`, address, select/tags). All renderers wrap in `ExpandableCell` for
  consistent row height/padding.

**Custom-field & entity editing** (`components/custom-fields/ui/` and
`app/(protected)/app/settings/custom-fields/`):

- Settings page lists all entities (system + custom); `entity-definition-dialog.tsx` /
  `entity-template-dialog.tsx` create/edit entity types.
- `custom-field-dialog.tsx` + `field-form.tsx` create/edit fields (Zod-validated), with type-specific
  editors: `OptionsEditor` (select), `RelationshipFieldEditor`, `AddressComponentsEditor`,
  `FileOptionsEditor`, `ActorOptionsEditor`, `calc-editor/`, `ai-options-section.tsx`, and the
  `formatting-editors/` (date/number/currency/phone/boolean/time).

---

## 9. End-to-End Data Flows

**Render a records table (read):**
`resourceStore` already holds the Resource → `createCustomFieldColumns` builds columns from its
`ResourceField[]` → each `CustomFieldCell` calls `useFieldValue` → on miss, the fetch queue batches a
`fieldValue.batchGet` → server `batchGetValues` validates references, resolves field ids to row UUIDs,
fetches FieldValue rows (traversing FieldPaths in O(depth)), converts to typed/display values → results land
in `field-value-store` keyed by `buildFieldValueKey` → only the affected cells re-render.

**Edit a cell (write):**
Cell mutates → `field-value-store.setValueOptimistic` (instant UI) → `fieldValue.set` →
`setValueWithBuiltIn`: resolve field (cache) → validate/coerce → pre-hooks → uniqueness → canonicalize
relationships → UPDATE or DELETE+INSERT → inverse-relationship sync + displayName resync → field-trigger +
realtime events (other clients update, originating socket excluded) → on error the optimistic value rolls
back.

**Create a record:**
`record.create` → `UnifiedCrudHandler.create(resourceId, values)` → inserts EntityInstance, writes
FieldValues via the service, computes denormalized display/search columns.

---

## 10. Field Types Reference

`FieldType` enum (`packages/database/src/enums.ts`; pgEnum `contactFieldType` in `_shared.ts`). Storage
column in parentheses:

| Type | Column | Notes |
| --- | --- | --- |
| `TEXT` | valueText | |
| `RICH_TEXT` | valueText | HTML |
| `NAME` | valueText | |
| `EMAIL` | valueText | normalized lowercase |
| `URL` | valueText | |
| `PHONE_INTL` | valueText | E.164 normalized |
| `ADDRESS` | valueText | freeform |
| `ADDRESS_STRUCT` | valueJson | `{street, city, state, zip, country}` |
| `NUMBER` | valueNumber | |
| `CURRENCY` | valueNumber (+ valueJson) | amount + `{amount, code}` |
| `DATE` | valueDate | |
| `DATETIME` | valueDate | |
| `TIME` | valueDate | |
| `CHECKBOX` | valueBoolean | |
| `SINGLE_SELECT` | optionId | refs `CustomField.options[].id` |
| `MULTI_SELECT` | optionId | multiple rows, ordered by `sortKey` |
| `TAGS` | optionId | multi-value |
| `FILE` | valueJson | `{url, name, size, mimeType}` |
| `RELATIONSHIP` | relatedEntityId + relatedEntityDefinitionId | |
| `ACTOR` | actorId | FK → User |
| `CALC` | valueNumber / valueJson | computed; read-only |
| `JSON` | valueJson | arbitrary |

(`PHONE` exists in the pgEnum for legacy rows but is not in the active `FieldType` union; use `PHONE_INTL`.)

Converters: one per type in `field-values/converters/`. Each handles input coercion and row→typed-value
conversion.

---

## 11. Gotchas & Invariants

- **Always resolve to the row id.** `FieldValue.fieldId` and client cache keys are the `CustomField` row
  UUID. Never persist or key by static keys (`firstName`) — accept them at the boundary, resolve, then use
  the row id. (See §5; this is the lesson of `#734`.)
- **The entity half of a reference is interchangeable but the field half is canonical.** `contact:…` ≡
  `<uuid>:…`, but the field id must end up as the row UUID.
- **Multi-value = multiple rows.** Don't assume one FieldValue per `(entityId, fieldId)`; iterate and honor
  `sortKey`. Writes to multi-value fields are DELETE+INSERT.
- **Go through the cache for field metadata.** Field/resource metadata comes from the org cache
  (`getCachedResource`, `getCachedResourceFields`); a fresh DB query bypasses invalidation. Add new fields
  to the cache, not ad-hoc queries.
- **Denormalized display columns are derived, not source of truth.** `EntityInstance.displayName` /
  `secondaryDisplayValue` / `avatarUrl` / `searchText` are recomputed from display-field pointers — update
  them through the service, never by hand.
- **Inverse relationships sync automatically.** Setting a relationship triggers `relationship-sync`; don't
  write the inverse side yourself.
- **Client cells subscribe narrowly.** `useFieldValue` re-renders only on its own value change; if a cell
  isn't updating, check the `buildFieldValueKey` key and invalidation, not the component.
- **Client-safe imports:** import field/custom-field helpers from the `/client` subpaths
  (`@auxx/lib/custom-fields/client`, `@auxx/lib/field-values/client`) in browser code — the barrel pulls in
  server-only deps.
</content>
</invoke>
