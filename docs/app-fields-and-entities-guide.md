<!-- docs/app-fields-and-entities-guide.md -->

# App Fields and Entities Guide

**Status:** written 2026-09-02 against `plans/apps/app-fields-and-entities-plan.md`. Phase 1 (SDK) is
in progress; Phase 2 (platform provisioning), Phase 3 (server-side read-only guard) and Phase 4
(sister-repo apps) are pending. This guide describes the **target author surface** the plan's §2
defines, not the code that ships today. Sections 2 through 6 and the connector examples in section 5
describe unbuilt behavior: the `key` rename, `defineEntity`, per-mapping `fields`/`appField`/`match`/
`mergeStrategy`, the `line_item` entity kind, the `appSlug`/`isIdentity` stamps on owned columns, and
the server-side read-only guard all await their phases. Section 9's file map marks, file by file,
which paths exist today and which are new. Statements about the *current* code (field-shape gaps, DB
columns, the reference grammar) were checked against the tree on 2026-09-02 and cited with a path.

**Companion reading:** `plans/apps/app-fields-and-entities-plan.md` (the plan this guide implements),
`plans/money/tasks/37-shopify-native-retarget.md` (the Shopify connector's retarget onto native
entities, worked out in the SDK shape this guide describes), `docs/data-connectors-architecture-guide.md`
(the sync engine underneath connector mappings), `docs/entity-architecture-guide.md` (the field-value
data model underneath everything an app writes into).

---

## Table of Contents

1. [The Three Questions an Author Answers](#1-the-three-questions-an-author-answers)
2. [The Field Shape](#2-the-field-shape)
3. [`defineFields`: Fields on an Existing Entity](#3-definefields-fields-on-an-existing-entity)
4. [`defineEntity`: An Entity the App Owns](#4-defineentity-an-entity-the-app-owns)
5. [Connector Mappings](#5-connector-mappings)
6. [What Lands in the Database](#6-what-lands-in-the-database)
7. [Write Authority and Lifecycle](#7-write-authority-and-lifecycle)
8. [Gotchas](#8-gotchas)
9. [File Map](#9-file-map)

---

## 1. The Three Questions an Author Answers

An app touches the platform's entity system in exactly three ways, and each has one SDK entry point.
The question an author asks decides which one to reach for:

- **"I want to add fields to an entity that already exists"** (a system entity like `contact` or
  `order`, or another app's entity) → `defineFields`.
- **"I want to declare a whole entity my app owns"** (no existing entity fits: GitHub issues, for
  example) → `defineEntity`.
- **"I want to bring in records that arrive from outside"** (an external API, on a sync schedule) →
  `defineDataConnector`, whose mappings write onto either of the first two: an **owned** mapping
  writes onto a `defineEntity` entity, a **contributing** mapping writes onto an existing entity via
  `defineFields`-declared app fields and/or native target fields.

```
  "add fields to an        "declare an entity        "bring in records
   entity that exists"      my app owns"               from outside"
          |                        |                          |
          v                        v                          v
    defineFields()           defineEntity()          defineDataConnector()
          |                        |                          |
          |                        |               each mapping's `target`:
          |                        |                          |
          |                        |            +-------------+-------------+
          |                        |            |                           |
          |                        |      owned (entityKey):         contributing (entityKind,
          |                        |      writes the entity          or an existing field):
          |                        |      declared to the left       via `target` (native) or
          |                        |            |                    `appField` (defineFields)
          |                        v            v                           |
          +----------> an existing EntityDefinition <-----------------------+
                        (system def, or another app's)
```

All three speak the same field shape (`FieldDecl`, §2). A `defineFields` field and a `defineEntity`
field are the identical TypeScript interface; only where they are declared, and their capability
defaults, differ. A connector mapping's field either **names** a field already declared on the target
entity (owned) or **declares one inline** if it is source-only with no target (contributing, when
`target`/`appField` is absent: see §5).

---

## 2. The Field Shape

Every field an app declares, in any of the three places, is one `FieldDecl` (`@auxx/sdk/fields`,
target shape):

```ts
interface FieldDecl {
  key: string                       // ^[a-zA-Z][a-zA-Z0-9_]{0,63}$, unique per entity
  type: FieldType                   // the platform list, PHONE removed
  name: string
  description?: string
  capabilities?: FieldCapabilities  // filterable, sortable, creatable, updatable, required, unique, computed, hidden
  identity?: boolean                // this value IS the external-system id of the record
  options?: FieldSelectOption[]     // REQUIRED for SINGLE_SELECT / MULTI_SELECT / TAGS
  addressComponents?: string[]      // ADDRESS_STRUCT only
  relationship?: {                  // RELATIONSHIP only
    target: { entityKey: string } | { entityKind: EntityRefKind }
    cardinality: 'has_many' | 'has_one' | 'belongs_to' | 'many_to_many'
    inverseName?: string
  }
  calc?: { expression: string }     // CALC only
  pii?: boolean                     // carried into the catalog; no platform consumer yet
}
```

It is discriminated over `type` exactly as today's `AppFieldDefinition` is (`packages/sdk/src/root/fields/define-field.ts`):
"select without options" and "relationship without target" are compile errors, not runtime
surprises. `appFieldKey` is renamed to `key` on the author side only; the DB column stays
`appFieldKey`.

### Type list

The platform's `FieldType` union, `PHONE` removed (verified current list, `field-types.ts`):

`TEXT · EMAIL · URL · RICH_TEXT · PHONE_INTL · ADDRESS · ADDRESS_STRUCT · FILE · DATE · DATETIME ·
TIME · NUMBER · CURRENCY · CHECKBOX · JSON · NAME · SINGLE_SELECT · MULTI_SELECT · TAGS ·
RELATIONSHIP · CALC · ACTOR`

`PHONE` still exists in the SDK's `FIELD_TYPES` today and in the database's `contactFieldType` pgEnum
for legacy rows, but the platform's active `FieldType` union does not include it
(`docs/entity-architecture-guide.md` §10). Removing it from the SDK list is one line in Phase 1.

`NAME` and `CALC` store nothing of their own at the database layer (`docs/entity-architecture-guide.md`
§10): an app can declare them, but neither is a useful `identity` target and `CALC` cannot be
written by a connector at all (its converter refuses to store a raw write).

### Capabilities and their defaults

`FieldCapabilities` is the same interface everywhere; only the **default profile** differs by
surface:

| Capability | Meaning | Default on `defineFields` / a connector's `defineFields`-bound app field | Default on a `defineEntity` field |
| --- | --- | --- | --- |
| `filterable` | usable in Find-node filters | `true` | `true` |
| `sortable` | usable for ordering | `true` | `true` |
| `creatable` | settable on create | `true` | **`false`** |
| `updatable` | settable on update by users | `true` (author usually sets `false` for a field the owning app writes) | **`false`** |
| `required` | required on create | `false` | `false` |
| `unique` | unique within scope | `false` | `false` |
| `computed` | derived, not directly settable | `false` | `false` |
| `hidden` | invisible in every user-facing surface | `false` | `false` |

The reasoning for the `defineEntity` default flip (plan §2.3): a field on an entity the app owns is
normally written by the app or its connector, not typed in by a user, so `creatable`/`updatable`
default to `false`. An author sets `updatable: true` deliberately for a column users should be able
to edit (`order_note`-style fields, though that particular one is a system field: see the Shopify
worked example in §5).

### `identity`

`identity: true` means this value **is** the external-system id of the record. It is scalar-only:
`defineField`'s existing validation (`define-field.ts`, `NON_IDENTITY_FIELD_TYPES`) already refuses
`identity: true` on `RELATIONSHIP`, `CALC`, `SINGLE_SELECT`, `MULTI_SELECT`, `TAGS`, `FILE`, `JSON`
and `ACTOR`, because `RecordIdentity` stores one scalar `externalId` per
`(record, source, connection, appFieldKey)` (§6). On a `defineEntity` entity, at most one field may
be `identity: true`: it is the record's external id, full stop. `defineFields` does not have an
equivalent "at most one per entity" rule stated in the plan; an app is still expected to declare at
most one identity field per target entity in practice.

### Select options, address components, relationships, calc

- `options: FieldSelectOption[]` (`{ value, label?, color? }`) is required for `SINGLE_SELECT`,
  `MULTI_SELECT` and `TAGS`. There is no partial-options mode (see §8).
- `addressComponents: string[]` is `ADDRESS_STRUCT`-only, naming the sub-fields the struct carries.
- `relationship` is `RELATIONSHIP`-only: `target` is `{ entityKey }` (another entity the same app
  declares) or `{ entityKind }` (a platform `EntityRefKind`, §3); `cardinality` is one of
  `has_many | has_one | belongs_to | many_to_many`; `inverseName` names the field created on the
  target. On `defineFields` today, RELATIONSHIP fields are silently skipped at provisioning
  (`app-field-provisioning.ts:94-101`): Phase 2 §4.2 makes them real, provisioned through
  `createRelationshipFieldWithInverse` the same way owned relationships are.
- `calc: { expression: string }` is `CALC`-only. A `CALC` field is declarable but a connector can
  never write into it (§2, above).

### `pii`

`pii?: boolean` is carried into the catalog and stored, but **nothing reads it yet**. It is inert by
design in this plan (explicitly v2: plan §8): "a consumer for `pii` (default-exclude from agent
context and export)" is future work. Declare it now if a field genuinely carries personal data: the
flag will start doing something once a consumer lands, but do not rely on it to protect anything
today.

---

## 3. `defineFields`: Fields on an Existing Entity

```ts
export const shopifyFields = defineFields([
  { key: 'customerId', type: 'TEXT', name: 'Shopify customer ID', targetEntity: 'contact',
    scope: 'connection', identity: true, capabilities: { hidden: true, updatable: false, creatable: false } },
])
```

Each field carries:

- **`scope`**: `'installation'` (one value per app install, shared across every connection) or
  `'connection'` (one value per connected account: the common case for an identity field like a
  per-store customer id).
- **`targetEntity`**: an `EntityRefKind`: the entity the field attaches to. It is resolved to the
  org's concrete `EntityDefinition` at provisioning time.

### `targetEntity` kinds

`EntityRefKind` (`packages/sdk/src/root/tools/types.ts`), verified 2026-09-02, is today:

```
contact · company · ticket · article · thread · order · invoice · catalog_item ·
part · product · build · purchase_order · vendor_bill · gl_account
```

The apps plan's Phase 1 item 3.10 adds **`line_item`** to this union: the Shopify brief's line
columns (§5 there) need it. This guide's worked examples in §5 already use `line_item` as the target
state.

One correction to the plan text: it frames a `gl_posting` kind as still to be decided ("add it or
drop the QuickBooks field, decide in the same edit"). Verified against `tools/types.ts` on
2026-09-02: `gl_posting` was **already removed** on 2026-08-28, before this plan was written.
Money decision `G6` replaced the entity with dedicated `GlPosting` / `GlPostingLine` Drizzle tables,
because the ledger's uniqueness constraint spans two columns of one row, which `FieldValue` cannot
express. So the decision is already "drop": QuickBooks' `qboJournalEntryId` field, which targets
`gl_posting` today and is silently skipped at provisioning, should be repointed at
`GlPosting.providerEntryId` (a plain column, not a `RecordIdentity` mirror) or dropped, not
re-admitted into `EntityRefKind`. Re-verify against the file at implementation time; it may have
moved again.

Admission to `EntityRefKind` is deliberately narrow: the union's own doc comment states the rule as
"an entity a user thinks about and could open," and warns that a kind with no seeded
`EntityDefinition` in an org silently drops every field an app declares against it
(`provisionAppField` warns-and-skips when `getCachedEntityDefId` finds nothing). `deal`, `task` and
`user` were removed for exactly this reason on the same day `gl_posting` was.

### What the user sees

A hidden field (`capabilities.hidden: true`) never appears in any user-facing surface: no field
panel, no picker, no import/export, no agent context. A non-hidden field renders like any custom
field: in the record panel, the grid, filters (if `filterable`), sorts (if `sortable`).

### How the app writes them

Three ways, none of which is `ctx.entities` (a stale JSDoc reference the plan retires: see §9):

1. **`setFieldValues`** from `@auxx/sdk/server`, called from a tool, workflow block, or webhook
   handler running in the app's sandbox.
2. **Platform code**, for the handful of fields a connector's own sync writes through the entity
   sink (owned or contributing: see §5).
3. **A connector**, via `appField` on a contributing mapping field, or by being the entity a
   `defineEntity` connector mapping owns.

The generated **`.auxx/app-fields.d.ts`** file (built by
`packages/sdk/src/util/generate-app-fields-types.ts`, kept current by `ensure-app-fields-types.ts`)
types `setFieldValues` calls against the app's own declared fields, keyed by `key`. There is **no
`ctx.entities`** object anywhere in the runtime: `define-field.ts`'s current JSDoc still describes
one (a holdover the plan's Phase 1 item 7 fixes), and three API route headers repeat the same stale
description. If you find `ctx.entities` referenced in a comment, treat it as leftover language for a
mechanism that was replaced by the codegen file plus `setFieldValues`.

---

## 4. `defineEntity`: An Entity the App Owns

```ts
export const orders = defineEntity({
  key: 'orders',                    // stable, becomes EntityDefinition.sourceKey; adopt key on reinstall
  apiSlug: 'shopify_orders',        // cosmetic, collision-suffixed by the installer
  singular: 'Shopify Order', plural: 'Shopify Orders',
  primaryDisplayField: 'name',
  fields: [
    { key: 'shopifyId', type: 'TEXT', name: 'Shopify Order ID', identity: true },
    { key: 'name', type: 'TEXT', name: 'Order Name' },
    { key: 'customer', type: 'RELATIONSHIP', name: 'Customer',
      relationship: { target: { entityKind: 'contact' }, cardinality: 'belongs_to', inverseName: 'Orders' } },
  ],
})
```

There is no live third-party `defineEntity` user today. After Phase 4, GitHub Issues becomes the one
live example (Shopify moves the other way, retargeting *off* an owned entity onto native ones: see
§5). The GitHub app's `entities.ts` does not exist yet; here is the target shape, built from the
app's current owned connector (`~/Sites/auxxai-apps/apps/github/src/github-issues.connector.ts`),
which today declares its fields inline on the stream instead:

```ts
// src/entities.ts (target shape, not yet written)
import { defineEntity } from '@auxx/sdk/entities'

export const issues = defineEntity({
  key: 'issues',
  apiSlug: 'github_issues',
  singular: 'GitHub Issue',
  plural: 'GitHub Issues',
  primaryDisplayField: 'title',
  fields: [
    { key: 'githubId', type: 'TEXT', name: 'GitHub Issue ID', identity: true,
      capabilities: { hidden: true } },
    { key: 'number', type: 'NUMBER', name: 'Number' },
    { key: 'title', type: 'TEXT', name: 'Title' },
    { key: 'state', type: 'TEXT', name: 'State' },
    { key: 'body', type: 'RICH_TEXT', name: 'Body' },
    { key: 'author', type: 'TEXT', name: 'Author' },
    { key: 'comments', type: 'NUMBER', name: 'Comments' },
    { key: 'url', type: 'URL', name: 'URL' },
  ],
})
```

registered as `app.entities: [issues]`, with the connector's stream carrying an **owned mapping**
(§5) whose fields name these keys instead of declaring types inline.

### Keys and `sourceKey` adoption

`key` is stable across republishes and becomes `EntityDefinition.sourceKey`. On reinstall (or a
second org install), the installer adopts the existing def by matching
`(appInstallationId, sourceKey)` rather than creating a duplicate: `adoptSharedOwnedDefId`, ordered
by `createdAt` for determinism (plan §4.3.2). Renaming `key` after a def has shipped orphans the old
def; there is no rename-tracking.

### `apiSlug` collision suffixing

`apiSlug` is cosmetic: it drives the URL slug, not identity. If it collides with an existing def's
slug in the org, the installer suffixes it. Never key anything off `apiSlug` in app code; use `key`.

### Display fields

`primaryDisplayField` (required), `secondaryDisplayField` and `avatarField` (both optional) must name
fields declared in the same `fields` array. The extractor validates this at compile time (plan §3
item 2).

### Relationships and inverses

A relationship field's `target` is `{ entityKey }` for another entity the **same app** declares
(resolved to `@template:app:<slug>:<key>`) or `{ entityKind }` for a platform kind (resolved to
`@system:<kind>`). Either way, the installer creates the **inverse** field on the target
automatically, named by `inverseName`: the same mechanism owned connector relationships use today.

### Consent at install

If `catalog.entities` is non-empty, the app-install flow shows the existing entity-install dialog
(`single-entity-install-dialog.tsx`, `entity-requirements-step.tsx`), listing the declared entities;
the user confirms which to create, defaulting to all. A skipped entity is offered again at connector
setup (today's path for the owned-connector flow) and via an "Install entities" action on the app
detail page. **Verify during implementation** whether the marketplace install dialog actually has a
step seam to host `entity-requirements-step` at install time. If it does not, entities install
lazily at connector setup only, and that fallback should be documented here once confirmed.

### Roll-forward: added and removed fields

Roll-forward re-runs the projector (`app-template-projector.ts`) and reconciles the entity's field
list against what is already installed, reusing `computeAppFieldReconcileActions` (the same
create / drift-update / orphan-hide reconciler `defineFields` fields already use): a field newly
added to the entity's declaration is created on every already-installed instance of that entity; a
field removed from the declaration is orphan-hidden, not deleted, matching how a `defineFields`
field's removal is handled today.

---

## 5. Connector Mappings

`ConnectorStreamDecl` loses `fields`, `displayFieldKey` and the owned `entity` inline declaration.
`defaultMappings` becomes `mappings`, and each mapping carries its own field list, relative to its
own `rootPath`.

### Owned vs contributing

A mapping is **owned** when its `target` is `{ entityKey }` naming one of the app's own
`defineEntity` entities and its fields are `{ key, sourcePath }` pairs: `key` must already exist on
the target entity (an extract-time error if not), so type, name, options and identity are inherited
from the entity and never declared twice.

A mapping is **contributing** when its `target` is `{ entityKind }` (a platform kind) or it writes
onto fields of an existing def by name. Its fields are `{ sourcePath, target?, appField?, match?,
mergeStrategy?, type?, name? }`:

- **`target`** resolves against the target def's `systemAttribute` or name (today's `targetKey`):
  a native field on an existing entity (`order_total`, `primary_email`).
- **`appField`** names a `defineFields`-declared field on the app (today's `targetAppField`).
  Identity is auto-stamped when that app field is `identity: true`.
- **`match: true`** is today's `matchFieldKeys`: a secondary identity key used to adopt an existing
  record on first contact (`match.email` → `primary_email`, for example). **`match: 'exclusive'`**
  is the same key with one extra rule: when a second source record of the mapping resolves to a
  record a sibling already binds, the sink skips it with a reason instead of binding it (money plan
  39 §6.1). Two Shopify customers sharing an email (a guest checkout and a registered customer) are
  one contact, so `primary_email` stays `match: true` and both bind; two variants sharing a SKU are
  different things colliding, so `part_sku` is `match: 'exclusive'` and the second is skipped.
  Uniqueness cannot separate the two cases (both fields are unique), so the author has to say.
- **`mergeStrategy`** is the sink's `FieldMergeStrategy` (`overwrite` default, `fill_blank`,
  `connector_owned_only`, `manual_review`, `ignore`), now declared by the author instead of set as a
  per-merchant click in the mapping editor.
- **`type`/`name`** are required only for a source-only field with no `target`/`appField` (needed to
  build the Layer A source schema, since nothing downstream declares its shape).

The three parallel lists a contributing mapping carries today: `fieldBindings`, `matchFieldKeys`,
`connectionAppFields`: collapse into one `fields` list plus `connectionFields`.

### `relationshipFieldKey`

Keeps its name and meaning: a `RELATIONSHIP` field declared on the parent entity (owned) or
`system:<attr>` on a contributing parent (`resolveContributingRelationshipFieldKey`,
`mutations.ts:987`, already accepts the `system:` prefix today). `ConnectorRelationshipDecl` on the
mapping itself is gone: the edge is declared once, on the entity.

### `linkMode: 'reference'`

A mapping with `linkMode: 'reference'` does not write a record; it resolves a relationship by
finding an already-bound `DataConnectorItem` for `(connector, target def, external id)`:
**whichever mapping wrote that target**, so a contributing identity app field is enough. The
resolution code (`relationship-pass.ts:78-81`) has always worked this way, by its own comment
("whichever mapping wrote it"); what makes it reachable is that some earlier mapping in the stream
designated an `identity: true` app field for the same target def, which stamps
`identityRole: externalId` and lets `map-record.ts`'s `designatedExternalId` pick up the source's
external id. The Shopify order stream's line-to-part reference (§5.2 below) is the worked trace: it
resolves because the product stream's `variants[]` mapping earlier bound `variantId` (identity)
onto `part`. One open item, not yet verified: what happens to a reference whose target has not
synced yet: `relationship-pass.ts:57` suggests a relation is tried once with no retry. **Verify
during implementation**, and if there is no retry, sequence the dependent stream's first sync after
the target stream's backfill completes.

### `parentRootPath`

Unchanged: it lets a mapping declare a sibling under the same `rootPath` as another mapping (a "flat
drilled child") without re-nesting the source tree: used when one subtree fans out to two different
target entities (§5.2's `variants[]` → `part` and `variants[]` → `catalog_item` mappings both read
the same source subtree).

### Reserved targets

A contributing `target` that resolves to a computed field, or to a small reserved set of system
attributes (`record_id`, the created/updated stamps, `quote_number`, `part_quantity_on_hand`), is
an **extract-time error** in the target design. Today the explicit binder
(`buildContributingFieldBindings`, `app-catalog.ts:187-247`) does not check this; only the automap
fallback does, via `isWritableTarget`, so a manifest can bind a source field straight onto a record
id today with no error. The totals fields (`order_total` and its siblings) are **deliberately not
reserved**: a connector that transcribes a vendor's own totals, the way `vendor_bill` already does,
needs to write them (§7's stand-down mechanism is what makes that safe).

The sell-side document numbers `order_number`, `invoice_number` and `purchase_order_number` are
also **not reserved**, under the rule "theirs if they bring one, otherwise ours"
(`plans/money/tasks/39-shopify-first-sync-followups.md` §6.5): a connector that carries the
source's own document number (Shopify's `#1001`, a QuickBooks invoice number) binds it with
`mergeStrategy: 'fill_blank'`, and the numbering hook keeps a non-blank incoming value on create
instead of allocating from `RecordSequence`. With nothing supplied the hook allocates `ORD-` /
`INV-` / `PO-` exactly as before, so hand-created records keep their sequence numbers. The
platform side is `CONNECTOR_WRITABLE_NUMBERS_ALLOWLIST` in `app-catalog.ts`, honoured by
`assertContributingTargetWritable` the same way as the totals allow-list. Quote, work-order,
build, ticket and `vendor_bill_internal_number` numbers stay hook-only.

### Layer A schema and `exampleRecord`

The source schema is built platform-side from the union of every mapping's absolute source paths
(`rootPath` + `sourcePath`) plus `exampleRecord`, with declared types overlaid from the entity field
(owned) or the resolved target field (contributing): unchanged from today's mechanism, just fed
from the new per-mapping field lists instead of the stream-wide flat map.

### Worked example 1: the Shopify product stream (owned + contributing, mixed)

From the Shopify brief §7.1. Two owned entities (`product`, `part`: both platform system entities,
so `entityKind` not `entityKey`), one flat-drilled contributing child:

```ts
streams: [{
  key: 'product', syncMode: 'incremental', exampleRecord,
  mappings: [
    // Shopify product -> native product. No `match` field anywhere: adoption is opt-in,
    // so a fresh merchant creates and nobody gets a silent merge heuristic.
    { rootPath: '', target: { entityKind: 'product' },
      fields: [
        { sourcePath: 'shopify_id',  appField: 'productId' },          // identity -> externalId
        { sourcePath: 'title',       target: 'product_title' },
        { sourcePath: 'bodyHtml',    target: 'product_description' },
        { sourcePath: 'productType', target: 'product_type' },
        { sourcePath: 'handle',      target: 'product_handle' },
        { sourcePath: 'status',      target: 'product_status' },
        { sourcePath: 'tags',        target: 'category' },
      ],
      connectionFields: [{ appField: 'storeDomain', from: 'label' }] },

    // variants[] -> native part, child of the product above (prefix-derived parent).
    { rootPath: 'variants[]', relationshipFieldKey: 'system:product_parts',
      target: { entityKind: 'part' },
      fields: [
        { sourcePath: 'shopifyId',         appField: 'variantId' },     // identity -> externalId
        { sourcePath: 'title',             target: 'part_title' },
        { sourcePath: 'sku',               target: 'part_sku' },
        { sourcePath: 'price',             appField: 'price' },
        { sourcePath: 'inventoryQuantity', appField: 'externalQuantity' },
      ] },

    // FLAT DRILLED CHILD: the same variants[] subtree also contributes the catalog item
    // that carries the sell price. Needs parentRootPath.
    { rootPath: 'variants[]', parentRootPath: 'variants[]',
      relationshipFieldKey: 'system:part_catalog_items',
      target: { entityKind: 'catalog_item' },
      fields: [
        { sourcePath: 'title', target: 'catalog_item_name' },
        { sourcePath: 'price', target: 'catalog_item_default_unit_price' },
      ] },
  ],
}]
```

`part_quantity_on_hand` is deliberately never a target: `recalculatePartQoH` re-sums the whole
movement ledger on every movement write, so a sink write into that column would be overwritten by
the next movement. Shopify's own count goes to the app field `externalQuantity` instead, and a drift
check becomes a plain column comparison.

### Worked example 2: the Shopify order stream (fully contributing)

From the Shopify brief §7.2: the case this plan exists to make expressible cleanly. No owned
entities: order, line item and the line-to-part edge all contribute onto native system entities.

```ts
streams: [{
  key: 'order', syncMode: 'incremental', exampleRecord, webhookTrigger,
  mappings: [
    { rootPath: '', target: { entityKind: 'order' },
      fields: [
        { sourcePath: 'shopify_id',        appField: 'shopifyOrderId' },  // identity -> externalId
        // `#1001` fills `order_number` once (`fill_blank`); the numbering hook
        // keeps it and only allocates `ORD-000N` when nothing was supplied
        // (§2.4 "Reserved targets"). The app field is a redundant grid column.
        { sourcePath: 'name',              target: 'order_number', mergeStrategy: 'fill_blank' },
        { sourcePath: 'name',              appField: 'orderName' },
        { sourcePath: 'createdAt',         target: 'order_placed_at' },
        { sourcePath: 'cancelledAt',       target: 'order_cancelled_at' },
        { sourcePath: 'financialStatus',   target: 'order_financial_status' },
        { sourcePath: 'fulfillmentStatus', target: 'order_fulfillment_status' },
        { sourcePath: 'currency',          target: 'order_currency' },
        { sourcePath: 'paymentGateways',   target: 'order_payment_gateways' },
        { sourcePath: 'tags',              target: 'category' },
        { sourcePath: 'shippingAddress',   target: 'order_shipping_address' },
        { sourcePath: 'note',              target: 'order_note', mergeStrategy: 'fill_blank' },
        // Transcribed totals (§7). The totals engine stands down for this record.
        { sourcePath: 'subtotalPrice',     target: 'order_subtotal' },
        { sourcePath: 'discountType',      target: 'order_discount_type' },   // projection emits 'amount'
        { sourcePath: 'totalDiscounts',    target: 'order_discount_value' },
        { sourcePath: 'totalTax',          target: 'order_tax_total' },
        { sourcePath: 'totalShipping',     target: 'order_shipping_total' },
        { sourcePath: 'totalPrice',        target: 'order_total' },
        // Fulfillment rollup: Shopify's summary, not a fact at auxx's grain.
        { sourcePath: 'firstFulfilledAt',  appField: 'firstFulfilledAt' },
        { sourcePath: 'lastFulfilledAt',   appField: 'lastFulfilledAt' },
        { sourcePath: 'shipmentCount',     appField: 'shipmentCount' },
        { sourcePath: 'isSplitShipment',   appField: 'isSplitShipment' },
        { sourcePath: 'raw',               appField: 'raw' },
      ],
      connectionFields: [{ appField: 'storeDomain', from: 'label' }] },

    // Embedded customer -> contact, retargeted edge, same shape as today.
    { rootPath: 'customer', relationshipFieldKey: 'system:order_contact',
      target: { entityKind: 'contact' },
      fields: [
        { sourcePath: 'id',    appField: 'customerId' },
        { sourcePath: 'email', target: 'primary_email', match: true },
      ],
      connectionFields: [{ appField: 'storeDomain', from: 'label' }] },

    { rootPath: 'line_items[]', relationshipFieldKey: 'system:order_line_items',
      target: { entityKind: 'line_item' },
      fields: [
        { sourcePath: 'shopifyId',    appField: 'shopifyLineId' },        // identity -> externalId
        { sourcePath: 'title',        target: 'line_item_name' },
        { sourcePath: 'variantTitle', target: 'line_item_description' },
        { sourcePath: 'quantity',     target: 'line_item_qty' },
        { sourcePath: 'price',        target: 'line_item_unit_price' },
        { sourcePath: 'lineTotal',    target: 'line_item_line_total' },  // transcribed
        { sourcePath: 'index',        target: 'line_item_sort_order' },
        // ...the fulfillment rollup, all appField
      ] },

    // line -> part, resolving by (connector, part def, variant id) because the
    // variants[] mapping in the product stream designates `variantId` as its
    // external id.
    { rootPath: 'line_items[].variant_id', linkMode: 'reference',
      relationshipFieldKey: 'system:line_item_part',
      target: { entityKind: 'part' } },
  ],
}]
```

`line_item` is a shared entity carrying four document slots (`line_item_quote` /
`line_item_work_order` / `line_item_invoice` / `line_item_order`), not a dedicated `order_line`:
the Shopify brief's §5 decision, kept here because it is what makes the third mapping above legible:
nothing about a Shopify line needs a field `line_item` does not already have except the fulfillment
rollup, which is why that rollup lands as app fields rather than new native columns.

---

## 6. What Lands in the Database

Three declaration surfaces, three DB stamp profiles (target form, after Phase 2's fixes):

| | A. `defineFields` field | B. `defineEntity` field (owned connector mapping writes it) | C. Contributing mapping field |
| --- | --- | --- | --- |
| Declared in | `app.fields` (`FieldDecl[]`) | `app.entities[].fields` (`FieldDecl[]`) | connector mapping's `fields[]`, via `target` or `appField` |
| Provisioner | `app-field-provisioning.ts` (reconciler) | `app-template-projector.ts` → `template-installer.ts` (direct `CatalogEntity → EntityTemplate` mapping) | none: binds onto an existing field at connector seed time |
| Fires at | install, roll-forward, connect, connector sync setup | app install (consent dialog) if `catalog.entities` is non-empty, or lazily at connector setup | connector create from catalog |
| `CustomField` stamps | `appInstallationId`, `connectionId?`, `appFieldKey`, `appSlug`, `isIdentity`, `isHidden`, capabilities; `systemAttribute` null | `appInstallationId`, `dataConnectorId`, `appFieldKey = key`, **`appSlug` and `isIdentity` now stamped** (the Phase 2 fix: `template-installer.ts` gains `appSlug` in `installContext` and passes it to `createCustomField`) | n/a: writes land on whatever field the mapping resolved to, carrying that field's own stamps |
| Def stamps | n/a | `EntityDefinition.sourceKey = key`, `appInstallationId`, `dataConnectorId` | n/a |
| Runtime writer | app via `setFieldValues`, platform code, or a connector via `appField` | entity sink | entity sink |

Today, path B (the owned connector column) stamps `appInstallationId` and `dataConnectorId` but
**no `appSlug` and no `isIdentity`**: a verified gap (plan §1): the sink's `mirrorIdentityWrites`
and `reconcileRecordIdentities` need `isIdentity` on the column to mirror it into `RecordIdentity`,
and today they never see it. The Phase 2 fix (`template-installer.ts` `installContext` gaining
`appSlug`) is what makes an owned identity column behave the same way a `defineFields` identity
field already does.

**`CustomField`** (`packages/database/src/db/schema/custom-field.ts`) is the field row: `id` is the
canonical field id, `appSlug: text()`, `isIdentity: boolean().default(false)`, `dataConnectorId`
(FK → `DataConnector`, nullable, `set null` on delete). **`EntityDefinition`**
(`entity-definition.ts`) carries `sourceKey: text()`, `appInstallationId`, `dataConnectorId`, and a
partial unique index on `(appInstallationId, dataConnectorId, sourceKey)` so a shared owned def is
adopted, not duplicated, on reinstall.

**`RecordIdentity`** (`packages/database/src/db/schema/record-identity.ts`) is a write-through
reverse-lookup index, never the source of truth (the value still lives in `FieldValue`). One row per
`(record, source, connection?, appFieldKey)`: `source` is the app slug (`'shopify'`) or `'chat'` for
app-less links; `externalId` is the denormalized value. Two unique indexes enforce one identity per
record-and-kind and one record per identity value.

### The `@app:` reference grammar

A contributing mapping's `appField` binding, and any late-bound reference to a field an app has not
provisioned yet, uses a late-bound ref of the shape `${defSegment}:@app:${appSlug}:${appFieldKey}`.
The plan cites `packages/types/field/utils.ts` for the helpers; **verified present** at that path
2026-09-02, exporting:

- `isAppFieldRef(ref): boolean`: detects the `@app:` marker in the field-id segment of a
  `ResourceFieldId`, short-circuiting on a plain (colon-less) field id so it never misfires on an
  ordinary key.
- `parseAppFieldRef(ref): AppFieldRefParts | null`: splits into `{ defSegment, appSlug,
  appFieldKey }`. `appFieldKey` may itself contain dots (a dotted subtree key from today's flat
  binding lists) but never colons, so a single split after the slug is correct.
- `toAppFieldRef(defSegment, appSlug, appFieldKey): ResourceFieldId`: the single constructor; use
  it instead of hand-building the string.

`defSegment` is either the manifest `apiSlug` (a connector-declaration-time ref) or a real def id
(a resolved binding ref). This grammar is what lets a contributing mapping name an app field that
has not been provisioned in this org yet: the ref resolves lazily, at write time.

---

## 7. Write Authority and Lifecycle

### Who may write which field

`updatable: false` and `creatable: false` on an app-owned or connector-owned field
(`appInstallationId IS NOT NULL OR dataConnectorId IS NOT NULL`) are enforced server-side (Phase 3)
for two `WriteOrigin.kind` values and exempt for the rest:

| Writer | Origin | Guarded? | Why |
| --- | --- | --- | --- |
| Record panel / table / drawer | `interactive` | yes | the case the flag exists for |
| Public API / SDK token | `api` | yes | behaves like interactive by definition |
| App `setFieldValues` (lambda callback route) | none; `FieldValueService.applyBulk` as the org system user, ownership-checked | no | the owning app must write its own read-only fields |
| Entity sink, CSV import | `sync` | no | they are the writers the flag protects fields *from* |
| Workflows, record rules, agents, field hooks | `automation` | no | server-side automation is trusted |
| Seeders, data migrations | `seed` | no | |

Today this is UI-only: `canUpdateField` (`resources/capabilities/field-capabilities.ts`) has zero
call sites, and `CRUD_RESOURCE_CONFIGS` (`resources/crud-definitions.ts`) is entirely commented out.
Phase 3 adds one function, `assertOriginMayWriteFields(origin, fields, writeKeys, op)`, called from
`UnifiedCrudHandler` create/update after write keys resolve to field ids. **Verify during
implementation** which origin the tRPC record mutations bind (expected `interactive`) and that the
lambda callback route stays outside the handler entirely.

### Lifecycle: what disconnect, uninstall and connector delete do to fields

A field can carry three ownership links, and the three provisioning paths stamp different subsets: a
manifest field has `appInstallationId` + `connectionId` + `appSlug` and no `dataConnectorId`; an
owned connector column has `appInstallationId` + `dataConnectorId`; a relationship the connector
planted on a shared def has `dataConnectorId` only. Verified against the dev DB (77 Shopify-related
`CustomField` rows), 2026-09-02:

| action | manifest fields | owned columns | planted relationships | connector row |
| --- | --- | --- | --- | --- |
| `deleteConnector` `keep` / `archive` | untouched | FK set null, stays | FK set null, stays | cascades |
| `deleteConnector` `delete` | untouched | deleted with the owned def | stray sweep → `deleteCustomField` | cascades |
| disconnect (`delete-app-connection.ts`) | that connection's copies deleted by the `Credential` FK cascade | untouched | untouched | `credentialId` set null, **row survives** |
| uninstall (`uninstall-app.ts`) | raw-deleted by `deleteAppFields` | raw-deleted too | untouched | **survives** with streams and mappings |

Four fixes land in Phase 2's files:

1. **Wire uninstall and disconnect to `deleteConnector`.** The tRPC router is its only caller today.
   Disconnect deletes every connector on that credential, uninstall every connector on that
   installation, both with behavior `keep` (never `delete`, offer `archive` in the disconnect
   dialog): an order is referenced by builds, and archiving a contributed order touches build
   reconciliation.
2. **The `delete` behavior's stray sweep must pass `allowProtectedDeletion: true`.** Its current
   comment claims connector fields carry no `appInstallationId`; the template installer stamps it on
   every column, so `isProtectedField` refuses and the sweep aborts mid-transaction.
3. **The consent dialog's "link to existing entity" branch must refuse a system def**, or at least
   stop writing the template field key into `systemAttribute`: the shape that produced three stray
   fields on the dev DB's system `line-items` def.
4. **`deleteAppFields` must route through `deleteCustomField` with `allowProtectedDeletion: true`**
   instead of a raw table delete, so a relationship field's inverse is cleaned up on uninstall: moot
   today because RELATIONSHIP manifest fields are skipped at provisioning, required once §3's
   RELATIONSHIP fix lands.

### Sync writes bypass inline hooks; totals recompute at finalize

A connector sync write runs on a `sync`-origin `WriteSession`. Pre-hooks (`SystemHookRegistry`, e.g.
auto-numbering) fire unconditionally and inline. **Per-field-change post hooks do not fire**:
timeline, realtime, the event bus are all suppressed (`skipEvents: true`) to stay storm-proof on
large syncs. But the **totals recompute is not skipped**: it runs once, at sync finalize, over the
run's change manifest (`packages/lib/src/events/handlers/finalize-integrity-passes.ts`), which
rewrites `line_item_line_total` for every synced line whose qty or price changed and recomputes the
parent document's totals from that.

This matters for any connector that transcribes a vendor's own totals (the Shopify order stream
above writes `order_subtotal`/`order_tax_total`/`order_shipping_total`/`order_total` directly, the
way `vendor_bill` already transcribes a supplier's bill): without a stand-down, the finalize pass
overwrites the transcribed number with auxx's own computed total on the very same sync. The Shopify
brief's §6 specifies the stand-down: before writing a document's or a line's totals, both
`money/totals-reconciler.ts` and the finalize pass's line arm check whether that field is
**connector-managed on that record** (`DataConnectorItem.managedFields`: the same read
`connector_owned_only` merge strategy already does) and skip the write if so. Any connector that
transcribes totals into a document this plan's write path can also compute needs the equivalent
check wired at the same two call sites; it is not automatic just because the mapping declares
`overwrite`.

---

## 8. Gotchas

- **One connector per app.** Multiple connectors per app is explicitly v2 (plan §8); the unique
  index is on the connector, not the target def.
- **Identity fields are scalar only.** `RELATIONSHIP`, `CALC`, the select types, `FILE`, `JSON` and
  `ACTOR` cannot be `identity: true`: `RecordIdentity` stores one scalar per row and has no way to
  mirror a multi-row or structured value.
- **Select options are the full provider set or none.** There is no partial-options mode: declare
  every `SINGLE_SELECT`/`MULTI_SELECT`/`TAGS` value up front, or leave the field untyped as
  something else. A provider adding a new enum value later requires a manifest update, not a
  runtime append.
- **Arrays in a projected value are dropped; objects pass through.** The fan-out (`map-record.ts`)
  drops array-shaped values with a warning; an object binds fine (this is how `shipping_address`
  reaches an `ADDRESS_STRUCT` field today). Do not project a source array straight onto a field:
  route it through a child mapping instead.
- **A dev reinstall is required after a key rename.** Changing a field's `key` (dotted →
  entity-scoped, or any other rename) means the reconciler sees the old key as gone and the new key
  as new: it hides the old column as an orphan rather than renaming it in place. There is no
  migration path for a key rename; delete and recreate the dev connector install.
- **The sister repo's `link:` SDK path decides which catalog fields exist.** If `auxxai-apps`
  points its `@auxx/sdk` dependency at a stale local link rather than the currently published
  version, an app can build and deploy successfully while silently missing fields the platform
  expects: the catalog only ever reflects what the linked SDK actually compiled.

---

## 9. File Map

Every path below was checked against the working tree on 2026-09-02. **new** marks a file the plan
creates that does not exist yet; **changed** marks a file that exists today under a different shape;
unmarked paths exist today and keep their role, with internal changes described in the plan.

| Category | Path | Role |
| --- | --- | --- |
| SDK | `packages/sdk/src/root/fields/define-field.ts` | `defineField`/`defineFields`; renamed from `appFieldKey` to `key`, gains the target `FieldDecl` shape |
| SDK | `packages/sdk/src/root/fields/field-types.ts` | `FIELD_TYPES`, `FieldCapabilities`, `FieldSelectOption`; `PHONE` removed |
| SDK | `packages/sdk/src/root/fields/index.ts` | `@auxx/sdk/fields` barrel |
| SDK | `packages/sdk/src/root/entities/define-entity.ts` | **new**: `defineEntity`, the entity-shape validator |
| SDK | `packages/sdk/src/root/entities/index.ts` | **new**: `@auxx/sdk/entities` barrel |
| SDK | `packages/sdk/src/root/data-connectors/types.ts` | connector types; `ConnectorFieldDecl`/`ConnectorEntityDecl`/`ConnectorRelationshipDecl`/`displayFieldKey`/`defaultMappings` deleted, `ConnectorMapping` added |
| SDK | `packages/sdk/src/root/data-connectors/define-data-connector.ts` | `defineDataConnector`; validates mapping field keys against the referenced entity when in scope |
| SDK | `packages/sdk/src/root/app.ts` | app registry; gains `entities?: ReadonlyArray<EntityDecl>` |
| SDK | `packages/sdk/src/root/tools/types.ts` | `EntityRefKind` union; gains `line_item` |
| SDK extractor | `packages/sdk/src/util/compile-and-extract-catalog.ts` | projects `fields`/`entities`/connector mappings into `catalog.*`; runs the cross-module validation (unknown `entityKey`, owned field not on the entity, `appField` not declared, more than one identity per entity) |
| SDK extractor | `packages/sdk/src/util/generate-app-fields-types.ts` | generates `.auxx/app-fields.d.ts`, keyed by `key` |
| SDK extractor | `packages/sdk/src/util/ensure-app-fields-types.ts` | keeps the generated file current on build |
| Catalog mirror | `packages/database/src/db/schema/app-deployment.ts` | `AppDeployment.catalog` jsonb shape; gains a shared `CatalogField` interface typed with the platform `FieldType` union instead of `string` |
| Provisioner | `packages/lib/src/entity-templates/app-template-projector.ts` | **changed**: a direct `CatalogEntity → EntityTemplate` mapping; the stream-derivation code, `partitionOwnedFields` and the reference-vs-owner dedupe are deleted |
| Provisioner | `packages/lib/src/entity-templates/template-installer.ts` | **changed**: `installContext` gains `appSlug`; `createField` passes `appSlug`/`isIdentity` through, fixing the owned-identity gap (§6) |
| Provisioner | `packages/lib/src/entity-templates/types.ts` | `EntityTemplate` types, unchanged shape |
| Installer | `packages/lib/src/apps/installations/app-field-provisioning.ts` | the `defineFields` reconciler; reads `key`; provisions RELATIONSHIP fields instead of skipping them |
| Installer | `packages/lib/src/apps/installations/install-app.ts` | install flow entry point; gains the entity-consent step when `catalog.entities` is non-empty |
| Installer | `packages/lib/src/apps/installations/roll-forward-installations.ts` | roll-forward; re-runs the projector for entity fields added/removed |
| Installer | `packages/lib/src/apps/installations/uninstall-app.ts` | uninstall; wired to delete the installation's connectors (`keep`); `deleteAppFields` routed through `deleteCustomField` |
| Installer | `packages/lib/src/apps/connections/delete-app-connection.ts` | disconnect; wired to delete the credential's connectors (`keep`/`archive`, never `delete`) |
| Installer | `packages/lib/src/custom-fields/delete-field.ts` | `deleteCustomField`, `allowProtectedDeletion`: kept, gains the two call sites above; the unused `connectionId` branch of `deleteAppFields` is deleted |
| Seeder | `packages/lib/src/data-connectors/mutations.ts` | `createConnectorFromAppCatalog`, `seedAppOwnedMappings`, `materializeAppContributingMappings`, `deleteConnector` (stray sweep gets `allowProtectedDeletion: true`) |
| Seeder | `packages/lib/src/data-connectors/app-catalog.ts` | `buildContributingFieldBindings`/`buildContributingMatchBindings`/`buildContributingConnectionAppFields`, `isWritableTarget`; `partitionOwnedFields` deleted |
| Seeder | `packages/lib/src/data-connectors/provisioning.ts` | lazy contributing-target provisioning; unchanged role, still refuses to author an owned def |
| Seeder | `packages/lib/src/data-connectors/relationship-pass.ts` | resolves `linkMode: 'reference'` pending relations by `(connector, target def, external id)` |
| Seeder | `packages/lib/src/data-connectors/connectors/app-connector-adapter.ts` | `toEngineStreams`; passes the new per-mapping shape, silent drops deleted |
| Cache | `packages/lib/src/cache/providers/installed-apps-provider.ts` | `installedApps` org-cache provider; cache key version bump |
| Cache | `packages/lib/src/cache/org-cache-keys.ts` | cache key constants; `org:installed-apps:v8` → `v9` |
| Write authority | `packages/lib/src/resources/capabilities/field-capabilities.ts` | `canUpdateField`/`canCreateField`; gains call sites in Phase 3 |
| Write authority | `packages/lib/src/resources/crud/write-origin.ts` | `WriteOrigin` discriminator (`interactive`/`api`/`automation`/`sync`/`seed`) |
| Write authority | `packages/lib/src/resources/crud/unified-handler-mutations.ts` | create/update entry points; gains the `assertOriginMayWriteFields` call after write-key resolution |
| Write authority | `packages/lib/src/field-values/` | **new function** `assertOriginMayWriteFields(origin, fields, writeKeys, op)` lands here |
| DB / reference grammar | `packages/database/src/db/schema/custom-field.ts` | `CustomField`: `appSlug`, `isIdentity`, `dataConnectorId`, capability flags |
| DB / reference grammar | `packages/database/src/db/schema/entity-definition.ts` | `EntityDefinition`: `sourceKey`, `appInstallationId`, `dataConnectorId` |
| DB / reference grammar | `packages/database/src/db/schema/record-identity.ts` | `RecordIdentity`: the write-through reverse-lookup index |
| DB / reference grammar | `packages/types/field/utils.ts` | `isAppFieldRef`/`parseAppFieldRef`/`toAppFieldRef`: the `@app:` ref grammar |
| Web / lambda | `apps/web/src/components/data-connectors/lib/bind-installed-owned-defs.ts` | reads `entityKey` from the mapping instead of matching `(streamKey, rootPath)` |
| Web / lambda | `apps/web/src/server/api/routers/data-connectors.ts` | tRPC surface; `ownedTargets` reads the mapping's `entityKey` |
| Web / lambda | `apps/web/src/components/workflow/dialogs/single-entity-install-dialog.tsx` | the entity-install consent dialog, reused for `defineEntity` consent |
| Web / lambda | `apps/web/src/components/workflow/dialogs/entity-requirements-step.tsx` | the consent step; refuses linking a template onto a system def |
| Web / lambda | `apps/lambda/src/executors/data-connector-executor.ts` | app-connector execution; passes the new catalog shape through |
| Money / finalize | `packages/lib/src/events/handlers/finalize-integrity-passes.ts` | sync-finalize totals recompute pass; gains the connector-managed stand-down check |
| Money / finalize | `packages/lib/src/money/totals-reconciler.ts` | the totals reconciler; gains the same stand-down check on the document side |
