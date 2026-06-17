<!-- docs/actions-architecture-guide.md -->

# Quick Actions — Architecture Guide

**Last updated:** 2026-06-16
**Status:** Current-state overview (post catalog/tools refactor #629)

Quick actions are app-defined operations a user can attach to an email reply and
run **at send time** — e.g. _"Create Coupon"_, _"Refund Charge"_. This document
describes how an action travels from an app author's source code to a rendered,
editable chip in the composer, and what happens when the reply is sent.

> This is the as-built reference. The dated planning docs under `plans/actions/`
> predate the catalog refactor and describe the original iframe-RPC design,
> which no longer matches runtime.

---

## Table of contents

1. [What an action is](#1-what-an-action-is)
2. [End-to-end data flow](#2-end-to-end-data-flow)
3. [Definition & build (SDK → catalog)](#3-definition--build-sdk--catalog)
4. [Storage & projection (catalog → org cache)](#4-storage--projection-catalog--org-cache)
5. [Delivery & client shaping](#5-delivery--client-shaping)
6. [UI surfaces](#6-ui-surfaces)
7. [Schema resolution (how the inline form renders)](#7-schema-resolution-how-the-inline-form-renders)
8. [Draft persistence & execution lifecycle](#8-draft-persistence--execution-lifecycle)
9. [The JSON-Schema ⇄ field-map bridge](#9-the-json-schema--field-map-bridge)
10. [Key files](#10-key-files)
11. [Known gaps & fragilities](#11-known-gaps--fragilities)

---

## 1. What an action is

An action is **a tool with an `action` surface**. In the SDK, a `tool` may
declare any combination of three surfaces:

- `tool.agent` → exposed to the AI agent (an _agent tool_)
- `tool.action` → exposed as a quick action (a button/chip in mail/ticket UI)
- (`tool.workflow` blocks are a separate registry)

The same underlying tool (same `id`, same input schema, same server handler) can
be **both** an agent tool and an action. _"Create Coupon"_ (`create_stripe_coupon`)
is both — the agent can call it, and the user can attach it to a reply.

A `CatalogAction` carries only display + routing metadata:

```ts
interface CatalogAction {
  toolId: string            // → the tool that actually runs
  label: string
  description?: string
  iconKey: string | null
  color?: string
  surface: 'ticket-header' | 'email-editor'
  requiresConfirmation?: boolean
  confirmationMessage?: string
}
```

Note it has **no input schema** — that lives on the tool, and is joined in
later (see §4). The `surface` field is informational today; the mail composer
does not yet filter on it (see §11).

---

## 2. End-to-end data flow

```
App source (app.ts)
  │  tool({ id, inputs: z.object({...}), action: {...}, agent: {...} })
  ▼
compileAndExtractCatalog()                         packages/sdk
  │  projects tools → catalog.tools (full registry, with inputsJsonSchema)
  │                 → catalog.agent.tools (agent surface only)
  │                 → catalog.actions     (action surface only, NO inputs)
  ▼
AppDeployment.catalog  (JSONB, baked at publish)   packages/database
  ▼
installedAppsProvider.compute()                    packages/lib/src/cache
  │  joins action.toolId → catalog.tools[].inputsJsonSchema  → CachedAction
  │  org cache key 'installedApps' (Redis, prefix v3, 900s TTL)
  ▼
apps.listInstalled (tRPC)  →  ExtensionsContext     apps/web
  ▼
useQuickActions()                                  apps/web/src/hooks
  │  installationToActions(): JSON Schema → field-descriptor map
  ▼
┌─ Add surfaces ─────────────┐   ┌─ Render ──────────────────┐
│ AddActionButton / picker   │   │ QuickActionPanel → Chip    │
│ "@" menu (mail-slash)      │──▶│ → QuickActionForm (inline) │
└────────────────────────────┘   └────────────────────────────┘
  │  onAdd(DraftActionPayload)         ▲ schema resolved at render
  ▼                                     │ from live useQuickActions
draft.actions  (persisted)  ───────────┘
  ▼
SEND  →  quickAction.execute (tRPC)  →  QuickActionExecutor
  │  invokes app server bundle via lambda (toolId + edited inputs)
  │  blocking pre-step: if any action fails, the email is NOT sent
  ▼
ticket timeline event (QUICK_ACTION_EXECUTED)
```

---

## 3. Definition & build (SDK → catalog)

`compileAndExtractCatalog()`
(`packages/sdk/src/util/compile-and-extract-catalog.ts`) compiles the app entry
(`src/app.ts`) in extraction mode and walks each registered `tool`:

- Every tool → `catalog.tools[]` (the **full registry**), with
  `inputsJsonSchema` / `outputsJsonSchema` produced by `zodToProviderToolSchema`
  (a plain JSON Schema, draft 2020-12 flavor).
- Tools with a `.agent` surface → also `catalog.agent.tools[]`.
- Tools with a `.action` surface → also `catalog.actions[]` (metadata only,
  **no inputs**).

Key consequence: **an action-only tool (no `.agent`) is absent from
`agent.tools` but present in `tools`.** Any consumer needing an action's input
schema must read the full `tools` registry, not `agent.tools`.

The payload is JSON-roundtrip-checked and persisted onto `AppDeployment.catalog`
(`packages/database/src/db/schema/app-deployment.ts`).

---

## 4. Storage & projection (catalog → org cache)

`installedAppsProvider` (`packages/lib/src/cache/providers/installed-apps-provider.ts`)
computes the per-org `installedApps` cache entry. For each installation it
projects the catalog surfaces onto a `CachedInstalledApp` row:
`agentTools`, `agentToolsets`, `agentTriggers`, `workflowBlocks`,
`workflowTriggers`, and `actions`.

For actions, it joins each action's `toolId` to the **full** `catalog.tools`
registry to attach the input schema:

```ts
const toolInputsById = new Map(
  (catalog?.tools ?? []).map((t) => [t.id, t.inputsJsonSchema])
)
const actions: CachedAction[] = catalog?.actions.map((a) => ({
  ...a,
  inputsJsonSchema: toolInputsById.get(a.toolId) ?? {},
}))
```

`CachedAction` (`org-cache-keys.ts`) = `CatalogAction & { inputsJsonSchema }`.
Joining here (rather than client-side against `agent.tools`) is what lets
**action-only** tools carry inputs.

The `installedApps` key is **Redis-backed**, versioned, and TTL'd:
`{ prefix: 'org:installed-apps:v3', ttlSeconds: 900 }`. Changing the projection
shape requires **bumping the version** so stale-shaped entries are ignored and
recomputed fleet-wide (a 15-min TTL otherwise serves the old shape).

---

## 5. Delivery & client shaping

The tRPC `apps.listInstalled` query
(`apps/web/src/server/api/routers/apps.ts`) returns the cached rows (dates
rehydrated). `ExtensionsContextProvider` holds them; `useExtensionsContext()`
exposes `appInstallations`.

`useQuickActions()` (`apps/web/src/hooks/use-quick-actions.ts`) flat-maps
installations into `SerializedQuickAction[]`. Per action it converts the JSON
Schema into the **field-descriptor map** the form expects:

```ts
inputs: jsonSchemaToActionFields(action.inputsJsonSchema)
```

`SerializedQuickAction` is the stable client shape: `{ id, label, description,
icon, color, inputs, outputs, defaults, appId, installationId }`. It reads from
the trpc cache synchronously — **no iframe boot** (the original design booted the
app sandbox over RPC; that path is gone).

---

## 6. UI surfaces

All in `apps/web/src/components/mail/email-editor/`.

**Add an action — two entry points, one payload:**

- **"Add action" button** (`AddActionButton` → `QuickActionPicker` →
  `MultiSelectPicker`) in the composer's belowEditor trigger row.
- **`@` menu** (`mail-slash-content.tsx`, the `references` config →
  "Add action" drill-in).

Both mint a byte-identical `DraftActionPayload` via `toDraftActionPayload()`
(`quick-action-panel.tsx`) and push it onto draft state with `onAddAction`.

```ts
interface DraftActionPayload {   // @auxx/lib/quick-actions/client
  appId: string
  installationId: string
  actionId: string               // == toolId
  inputs: Record<string, unknown>
  display: { label; icon?; color?; summary }
}
```

**Render the chips:** `QuickActionPanel` maps draft actions to `QuickActionChip`.
Each chip is a `Collapsible`:

- **Header row** — `CollapsibleTrigger` (chevron + color dot + label) and the
  remove `<button>` are **siblings** (the remove button must _not_ nest inside
  the trigger's `<button>` — invalid HTML / hydration error).
- **Body** — `QuickActionForm` renders one input per field
  (`string` / `number` / `currency` / `boolean` / `select`), writing edits back
  via `onUpdate(actionId, inputs)`.

---

## 7. Schema resolution (how the inline form renders)

A chip can only expand if it has a resolved input schema. This is resolved at
**render time** from the live catalog — _not_ from any add-time cache:

```ts
// QuickActionPanel
const { actions: availableActions } = useQuickActions(threadId, ticketId)
const schemaByKey = useMemo(() => {
  const map = new Map<string, { inputs: Record<string, any> }>()
  for (const a of availableActions) {
    if (a.inputs && Object.keys(a.inputs).length > 0)
      map.set(`${a.appId}:${a.id}`, { inputs: a.inputs })
  }
  return map
}, [availableActions])

// per chip
schema={schemaByKey.get(`${action.appId}:${action.actionId}`)}
```

Why render-time and not an add-time module cache:

- **Survives reloads / restored drafts.** A chip rehydrated from a saved draft
  finds its schema immediately — no dependency on the add flow having run this
  session.
- **No stale module memory.** Reflects the installed app's _current_ schema.
- **Uninstalled apps degrade correctly.** If a draft references an action whose
  app was uninstalled, the lookup returns `undefined` → the chip simply isn't
  expandable (there's no schema to edit against). Remove still works.

> History: a module-level `quickActionSchemaCache`, populated only on add, used
> to back this. It silently failed for any chip restored from a saved draft. It
> was removed in favor of the render-time lookup.

---

## 8. Draft persistence & execution lifecycle

**Persistence.** The composer keeps `quickActions` in state and writes it onto
the draft payload (`actions: quickActions`), so chips survive autosave/reopen.
The chips _render_ from this list; their _schemas_ come from the live catalog
(§7).

**Execution (send-time, blocking).** In `email-editor/index.tsx` `handleSendClick`:

1. If there are actions, a "Send & execute actions" confirm is shown.
2. `quickAction.execute` (tRPC) runs them via `QuickActionExecutor.executeAll`
   (`packages/lib/src/quick-actions/quick-action-executor.ts`), which invokes the
   app's **server bundle through the lambda executor** with
   `{ toolId: action.actionId, inputs }` — the same handler the agent would call.
   Actions run **concurrently**.
3. **If any action fails, the email is NOT sent** — the send is aborted and an
   error toast is shown.
4. On success, the email send proceeds. The send payload does **not** include
   actions — they are a side effect, not part of the message.

**Audit trail.** For each successful action on a ticket, the router writes a
`QUICK_ACTION_EXECUTED` timeline event (`apps/web/src/server/api/routers/quick-actions.ts`)
with `{ appId, actionId, label, summary, outputs }`.

**After send.** The draft (which held `actions`) is torn down, so the chips
disappear. The sent message carries **no** action record and `message-display`
renders nothing about them — the only durable trace is the ticket timeline
event above.

---

## 9. The JSON-Schema ⇄ field-map bridge

This mismatch is the crux of the historical bug, so it's worth stating plainly.

- **Tool inputs** are emitted as a **JSON Schema**:
  `{ type:'object', properties:{ name:{type:'string'}, duration:{enum:[...]}, … }, required:[...] }`.
- **The form** (`QuickActionForm`) reads a **flat field-descriptor map keyed by
  field name**: `{ name:{type:'string',label,…}, duration:{type:'select',options} }`.

`jsonSchemaToActionFields()` (`use-quick-actions.ts`) bridges them by walking
`schema.properties`:

| JSON Schema             | Form field type | Notes                                        |
| ----------------------- | --------------- | -------------------------------------------- |
| `enum: [...]`           | `select`        | options from `enum`, regardless of base type |
| `type: integer\|number` | `number`        | `integer` flag; min/max from `minimum`/`maximum`/`exclusiveMinimum` |
| `type: boolean`         | `boolean`       |                                              |
| everything else         | `string`        |                                              |

It is **lossy by design**: JSON Schema carries no `currency` type or label
metadata, so currency inputs degrade to plain number fields and labels are
title-cased from the field key (`maxRedemptions` → "Max Redemptions").

---

## 10. Key files

| Concern                  | File                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| Catalog extraction       | `packages/sdk/src/util/compile-and-extract-catalog.ts`               |
| Zod → JSON Schema        | `packages/sdk/src/build/server/zod-to-provider-tool-schema.ts`       |
| Catalog types            | `packages/database/src/db/schema/app-deployment.ts`                  |
| Org-cache projection     | `packages/lib/src/cache/providers/installed-apps-provider.ts`        |
| Cache key types/config   | `packages/lib/src/cache/org-cache-keys.ts` (`CachedAction`, `v3`)    |
| tRPC delivery            | `apps/web/src/server/api/routers/apps.ts` (`listInstalled`)          |
| Client hook + bridge     | `apps/web/src/hooks/use-quick-actions.ts` (`jsonSchemaToActionFields`) |
| Serialized client shape  | `apps/web/src/lib/workflow/workflow-block-loader.ts` (`SerializedQuickAction`) |
| Chips + inline form      | `apps/web/src/components/mail/email-editor/quick-action-panel.tsx`   |
| `@`-menu add path        | `apps/web/src/components/mail/email-editor/mail-slash-content.tsx`   |
| Send wiring              | `apps/web/src/components/mail/email-editor/index.tsx` (`handleSendClick`) |
| Execute router           | `apps/web/src/server/api/routers/quick-actions.ts`                   |
| Executor (lambda invoke) | `packages/lib/src/quick-actions/quick-action-executor.ts`            |
| Draft payload type       | `@auxx/lib/quick-actions/client` (`DraftActionPayload`)              |

---

## 11. Known gaps & fragilities

- **Surface not enforced in the mail picker.** `CatalogAction.surface` is
  `ticket-header | email-editor`, but `installationToActions` does not filter by
  it — e.g. `create_stripe_coupon` is declared `ticket-header` yet appears in the
  email composer. Either intended (actions are universal) or a missing filter;
  unresolved.
- **`@auxx/lib` rebuild required for projection changes.** The web server
  resolves `@auxx/lib` to built `dist/*.mjs` (Turbopack ignores the `source`
  export condition). Server-side changes to the projection don't take effect
  until `pnpm --filter @auxx/lib build`, and cached `installedApps` entries must
  recompute (bump the cache version or wait out the TTL). See
  `plans/dev/fix-package-rebuilds/build-plan.md`.
- **Lossy currency rendering.** JSON Schema has no currency type, so currency
  inputs render as plain number fields (raw minor units), losing the symbol /
  decimal handling the SDK `currency` field would have provided.
- **No post-send action record on the message.** Executed actions are a send-time
  side effect; the only durable trace is the ticket timeline event. There is no
  per-message "✓ Created coupon SAVE20" trail.
