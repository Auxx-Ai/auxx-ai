<!-- docs/app-implementation-template-v3.md -->

# App Implementation Template v3

Date: 2026-06-12
Status: Reference template (supersedes `app-implementation-template-v2.md`)

---

## What Changed Since v2

v2 described a block-centric architecture where business logic lived in per-resource `*-execute.server.ts` files dispatched by the block's server file. The platform has since moved to a **unified surface model**:

| Area | v2 | v3 (current) |
|------|----|--------------|
| Unit of behavior | Workflow block operations | **Tools** (`defineTool` + zod schemas) |
| Block server file | Business logic dispatcher | Thin `ctx.runTool` dispatcher via `toolMap` |
| Agent exposure | N/A | `agent: { toolsetSlug }` surface key + **toolsets** |
| Quick actions | N/A | `action: { surface: 'ticket-header' \| 'email-editor' }` surface key |
| Triggers | Plain object export under `blocks/{app}/triggers/` | `defineTrigger` under top-level `src/triggers/`, `workflow`/`agent` surface keys |
| App-owned fields | N/A | `src/fields.ts` via `defineFields` (provisioned per install/connection) |
| Schemas | `Workflow.*` only | Blocks/triggers still `Workflow.*`; tools use **zod** (re-exported from `@auxx/sdk/tools`) |
| Error handling | Hand-rolled error message maps | SDK error classes from `@auxx/sdk/server` |
| Icons | Inline SVG strings | PNG import from `src/assets/icon.png` (SVG imports rejected — XSS) |
| Connection (tools) | `getOrganizationConnection()` | Unified `getConnection()` (resolves the agent-bound account) |
| Lifecycle events | `(payload: { connectionId })` | `({ connection }: { connection: Connection })`, can return `{ label }` |
| Scaffold | Copy `apps/slack` | Copy `apps/__template` |

**Reference implementations** (all under `/Users/mklooth/Sites/auxxai-apps/apps/`):

| App | Demonstrates |
|-----|--------------|
| `__template` | Canonical minimal scaffold — copy this to start. README documents the surface model. |
| `shopify` | Full surface set: agent tools + internal tools + block dispatcher + webhook trigger + app fields + toolsets + settings |
| `stripe` | `action` surface key (quick actions on tickets) alongside `agent` |
| `whatsapp` | Typed internal tools with input/output **projection** in the dispatcher + vitest tests |
| `gog-calendar` | Polling trigger (`config.polling`) |
| `discord` | Testing patterns |

---

## 1. Core Concept: The Unified Surface Model

Every **tool**, **block**, and **trigger** is registered in `src/app.tsx`. *Where* each one shows up is controlled by **surface keys on the definition itself**, not by which array it lives in.

### Tools

A tool is the atomic unit of behavior — a zod-typed input/output pair with a server-side execute.

| Surface key | Effect |
|---|---|
| `agent: {…}` | Tool appears in the agent picker, callable by the LLM (gated by its `toolsetSlug`). |
| `action: {…}` | Tool also runs as a quick-action button on a ticket / email editor. |
| *(neither)* | **Internal-only.** Callable by the platform (e.g. a block dispatcher via `ctx.runTool`) but invisible in pickers. |

A tool can carry multiple surface keys at once (agent-exposed + quick-action + block target).

### Blocks

A workflow block **does not carry business logic anymore**. It declares a `toolMap` routing each `${resource}.${operation}` key to an internal tool id, and its server file is a thin `ctx.runTool` dispatcher.

### Triggers

Declared with `defineTrigger`. Surface keys:

| Surface key | Effect |
|---|---|
| `workflow: { node, panel }` | Trigger appears as a workflow start node. |
| `agent: {…}` | Trigger fans out to agents (`label`, `description`, `defaultEnabled`). |

A trigger with no surface key is unreachable — the build scanner flags it as an authoring error.

---

## 2. Prerequisites

1. **Create the app record** in the Auxx platform (via the build portal or API)
2. **Get the app slug** — folder name under `auxxai-apps/apps/{app-slug}/`
3. **Determine app capabilities**:

| Capability | Description |
|-----------|-------------|
| **Agent tools** | LLM-callable operations grouped into admin-approvable toolsets |
| **Quick actions** | Tools surfaced as buttons on tickets / the email editor |
| **Block (actions)** | Resource/operation workflow block, dispatching to internal tools |
| **Triggers (webhook)** | Inbound events via webhook push |
| **Triggers (polling)** | Inbound events via scheduled polling |
| **Webhooks** | HTTP endpoints receiving third-party events (webhook triggers only) |
| **App fields** | Custom fields the app owns on contacts/tickets/etc., provisioned per install or per connection |
| **Settings** | Admin-facing org/user settings schema |

4. **Set up authentication** (`oauth2-code` / `secret` / `none`) — see §3.

---

## 3. Connection Setup

Connection details are configured in the build portal at:
```
apps/build/src/app/(portal)/[slug]/apps/[app_slug]/connections/page.tsx
```

All connection types store: **Connection Type**, **Label**, **Description**, and **Global** (org-wide vs user-specific).

### 3A. Auth Type: `oauth2-code`

The platform handles the full OAuth2 authorization code flow:

- **Authorize route**: `apps/web/src/app/api/apps/[slug]/oauth2/authorize/route.ts` — validates session, generates CSRF state in Redis, auto-injects offline-access scopes (Google: `access_type=offline` + `prompt=consent`; Microsoft: `offline_access`; Slack: none), redirects.
- **Callback route**: `apps/web/src/app/api/apps/[slug]/oauth2/callback/route.ts` — validates state, exchanges the code, saves via `saveAppConnection()` (encrypted), redirects to `/app/settings/apps/installed/{slug}/connections?success=true`.
- **Redirect URI pattern**: `{WEBAPP_URL}/api/apps/{app-slug}/oauth2/callback` — register it with the provider.

Build portal fields: Authorize URL, Access Token URL, Client ID/Secret, Scopes, Token Request Auth Method (`request-body` | `basic-auth`), Refresh Schedule (`none` | `hourly` | `daily` | `weekly`).

#### Dynamic OAuth variables

For per-tenant values (subdomain in the URL, org-provided credentials), define `connectionVariables` on the `ConnectionDefinition` (top-level column, editable in the build portal). Variables use `{key}` placeholders in `oauth2AuthorizeUrl`, `oauth2AccessTokenUrl`, `oauth2ClientId`, `oauth2ClientSecret`; the platform interpolates them at authorize time. Plain values persist in connection metadata; `secret: true` values are encrypted with the credential.

```
# Shopify example
Authorize URL:  https://{shop}.myshopify.com/admin/oauth/authorize
Token URL:      https://{shop}.myshopify.com/admin/oauth/access_token
Variables:      [{ key: "shop", label: "Shop Subdomain", placeholder: "my-store" }]
```

Runtime access:

```typescript
const shop = connection.fields?.shop
```

> Full design: `plans/apps/oauth/dynamic-oauth-variables-plan.md`,
> `plans/apps/connections/multi-field-secret-connections-plan.md`.

### 3B. Auth Type: `secret`

API key / token pasted by the user — no redirect flow. Set `connectionType: 'secret'` with a Label ("Bot Token", "API Key") and Description (where to find it). The platform renders the connect dialog and encrypts the secret — no custom UI needed. No refresh schedule; rotation means manual reconnect.

**Single secret** (default): no connection variables defined → one "API Key" input; the app reads `connection.value`.

**Multi-field secret**: providers needing several values (client ID + client secret + account number) define `connectionVariables` on the definition — the connect dialog renders one input per variable (`secret: true` → masked + encrypted; plain → stored in metadata). The app reads the merged map via `connection.fields`; `connection.value` is `''`.

```
# FedEx example
Variables: [
  { key: "client_id",      label: "Client ID",      secret: true },
  { key: "client_secret",  label: "Client Secret",  secret: true },
  { key: "account_number", label: "Account Number" },
]
```

```typescript
const { client_id, client_secret, account_number } = getConnection().fields ?? {}
```

The `connection-added` event payload carries the same `fields` map — validate credentials there (mint a token once, return `{ label: account_number }`).

### 3C. Auth Type: `none`

No user credentials; no connection UI shown.

### 3D. Using Connections at Runtime

Two getters from `@auxx/sdk/server` — pick by call site:

```typescript
// TOOLS — unified getter. The platform bridge resolves the connection from
// the calling agent's bound account (Agent.appAccounts[slug].credId), so
// multi-account orgs pick the account on the agent, not in tool code.
import { getConnection } from '@auxx/sdk/server'

// BLOCK / TRIGGER executes — org-scoped getter (workflow runs aren't
// agent-bound).
import { getOrganizationConnection } from '@auxx/sdk/server'
```

Wrap resolution in a small shared helper so every tool fails identically (see `apps/shopify/src/tools/shared/connection.ts`):

```typescript
// src/tools/shared/connection.ts
import { getConnection } from '@auxx/sdk/server'
import { throwConnectionNotFound } from '../../blocks/{app-slug}/shared/{app-slug}-api'

export function get{App}Connection(): { token: string } {
  const connection = getConnection()
  if (!connection?.value) throwConnectionNotFound()
  return { token: connection.value }
}
```

**Connection error pattern** (unchanged from v2):

```typescript
export function throwConnectionNotFound(): never {
  const err = new Error(
    '{App Name} not connected. Please connect in Settings → Apps → {App Name}.'
  ) as Error & { code: string; scope: string }
  err.code = 'CONNECTION_NOT_FOUND'
  err.scope = 'organization'
  throw err
}
```

---

## 4. File Structure

```
apps/{app-slug}/
├── src/
│   ├── app.tsx                                  # REGISTRY: tools, toolsets, blocks, triggers, fields
│   ├── app.settings.ts                          # Admin-facing settings schema
│   ├── fields.ts                                # App-owned custom fields (optional)
│   ├── auxx-env.d.ts                            # SDK type declarations
│   ├── assets/
│   │   └── icon.png                             # App icon (PNG/JPG/GIF/WebP — NOT SVG)
│   │
│   ├── tools/
│   │   ├── {tool-name}.tool.tsx                 # defineTool — agent/action-surfaced tool
│   │   ├── {tool-name}.tool.server.ts           # Default-export execute (REQUIRED pairing)
│   │   ├── internal/                            # Internal tools backing the block dispatcher
│   │   │   ├── {resource}-{op}.tool.tsx
│   │   │   └── {resource}-{op}.tool.server.ts
│   │   ├── shared/                              # Connection helper, output mappers, etc.
│   │   │   ├── connection.ts
│   │   │   └── map-{entity}.ts
│   │   └── toolsets.ts                          # Admin-approvable agent tool groups
│   │
│   ├── blocks/
│   │   └── {app-slug}/
│   │       ├── {app-slug}.workflow.tsx          # Block declaration + toolMap + node
│   │       ├── {app-slug}.server.ts             # Thin ctx.runTool dispatcher
│   │       ├── {app-slug}-tool-map.ts           # `${resource}.${operation}` → tool id table
│   │       ├── {app-slug}-schema.ts             # Assembled Workflow.* schema
│   │       ├── {app-slug}-panel.tsx             # Top-level panel orchestration
│   │       │
│   │       ├── resources/
│   │       │   ├── constants.ts                 # RESOURCES / OPERATIONS / VALID_OPERATIONS
│   │       │   └── {resource}/
│   │       │       ├── {resource}-schema.ts     # Workflow.* inputs + computeOutputs
│   │       │       ├── {resource}-panel.tsx     # Panel UI per operation
│   │       │       └── {resource}-execute.server.ts  # Implementation (called by internal tools)
│   │       │
│   │       └── shared/
│   │           ├── {app-slug}-api.ts            # API client (SDK error classes)
│   │           ├── use-{app-slug}-data.ts       # Client data hook with caching
│   │           └── list-{data}.server.ts        # Server fetchers for dropdowns
│   │
│   ├── triggers/                                # TOP-LEVEL now (not under blocks/)
│   │   └── {trigger-name}/
│   │       ├── {trigger-name}.workflow.tsx      # defineTrigger({ …, workflow: { node, panel } })
│   │       ├── {trigger-name}-schema.ts
│   │       ├── {trigger-name}-panel.tsx
│   │       ├── {trigger-name}.server.ts         # Webhook: passthrough; Polling: { events, state }
│   │       └── shared/
│   │           └── {trigger-name}-types.ts      # Event detection + payload extraction
│   │
│   ├── events/                                  # Connection lifecycle hooks
│   │   ├── connection-added.event.ts
│   │   └── connection-removed.event.ts
│   │
│   └── webhooks/                                # Inbound webhook handlers (webhook triggers only)
│       └── {handler-name}.webhook.ts
│
├── tests/                                       # Optional but recommended
│   ├── __mocks__/auxx-sdk-server.ts
│   └── *.test.ts
├── docs/examples/*.json                         # Sample provider payloads (optional, useful for evals)
├── package.json
├── tsconfig.json
├── vitest.config.ts                             # Only if tests exist
├── .prettierrc.json
└── README.md
```

---

## 5. Implementation Steps

### Phase 1: Scaffold

#### 1.1 Copy the template app

```bash
# From auxxai-apps/
cp -r apps/__template apps/{app-slug}
```

Then rename the example block/trigger/tools as you replace them. Read `apps/__template/README.md` — it documents the surface model with worked examples.

#### 1.2 `package.json`

```json
{
  "name": "{app-slug}",
  "version": "1.0.0",
  "description": "An Auxx application",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "auxx dev",
    "build": "auxx build",
    "lint": "prettier --check \"src/**/*.{ts,tsx}\"",
    "format": "prettier --write \"src/**/*.{ts,tsx}\"",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@auxx/sdk": "workspace:*",
    "react": "19.1.0",
    "zod": "~3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "19.1.8",
    "prettier": "^3.5.3",
    "typescript": "^5.9.2",
    "vitest": "^3.1.0"
  }
}
```

> Note: the apps repo lints with **prettier**, not biome. `zod` is a direct dependency, but always import `z` from `@auxx/sdk/tools` so the version the SDK compiles against is the one you author with.

#### 1.3 App icon

Drop a PNG at `src/assets/icon.png` and import it wherever an icon is needed:

```typescript
import appIcon from '../assets/icon.png'   // auto-prefixed to `base64:` by the SDK
```

Accepted icon values: imported PNG/JPG/GIF/WebP, Lucide icon name (`'message-square'`), emoji, or a remote URL. **SVG imports are rejected** (XSS risk) — use a remote URL for SVGs.

#### 1.4 `src/app.tsx` — the registry

Every tool, block, and trigger you ship is referenced here. Surfaces are declared on the individual definitions, not here.

```tsx
// src/app.tsx
import { TextBlock } from '@auxx/sdk/client'
import { {appSlug}Block } from './blocks/{app-slug}/{app-slug}.workflow'
import { {toolName}Tool } from './tools/{tool-name}.tool'
import { {appSlug}Toolsets } from './tools/toolsets'
import { {triggerName}Trigger } from './triggers/{trigger-name}/{trigger-name}.workflow'
import { {appSlug}Fields } from './fields'

export const app = {
  record: {
    actions: [],
    bulkActions: [],
    widgets: [],
  },
  callRecording: {
    insight: { textActions: [] },
    summary: { textActions: [] },
    transcript: { textActions: [] },
  },
  // App-owned custom fields (optional) — see Phase 5.
  fields: {appSlug}Fields,
  workflow: {
    blocks: [{appSlug}Block],
    triggers: [{triggerName}Trigger],
  },
  // EVERY tool ships here regardless of surface — agent-facing, action-facing,
  // and internal block-backing tools alike.
  tools: [
    {toolName}Tool,
    // ...internal tools
  ],
  toolsets: {appSlug}Toolsets,
}

export function App() {
  return (
    <>
      <TextBlock align="center">{App Name}</TextBlock>
      <TextBlock align="left">
        One or two sentences explaining the integration to the admin installing it.
      </TextBlock>
    </>
  )
}
```

#### 1.5 `src/auxx-env.d.ts`

```typescript
/// <reference types="@auxx/sdk/global" />
```

---

### Phase 2: API Client & Shared Utilities

#### 2.1 API client (`blocks/{app-slug}/shared/{app-slug}-api.ts`)

Use the **SDK error classes** from `@auxx/sdk/server` — they carry retry/connection semantics the platform understands. Don't hand-roll status→message maps as the only error path anymore.

```typescript
// src/blocks/{app-slug}/shared/{app-slug}-api.ts
import {
  ConflictError,
  ConnectionExpiredError,
  InsufficientPermissionsError,
  InvalidInputError,
  NotFoundError,
  RateLimitError,
  UpstreamServiceError,
} from '@auxx/sdk/server'

export async function {app}Api<T = unknown>(
  credential: string,
  path: string,
  options: { method?: string; body?: Record<string, unknown>; qs?: Record<string, string> } = {}
): Promise<T> {
  const { method = 'GET', body, qs } = options

  const url = new URL(`https://api.{provider}.com/v1${path}`)
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v)
    }
  }

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/json',
      },
      ...(body && { body: JSON.stringify(body) }),
    })
  } catch (err) {
    throw new UpstreamServiceError(err instanceof Error ? err.message : '{App Name} request failed')
  }

  if (response.status === 204) return {} as T
  const data = await response.json()

  if (!response.ok) {
    if (response.status === 401) throw new ConnectionExpiredError('organization')
    if (response.status === 403) throw new InsufficientPermissionsError('organization')
    if (response.status === 429) {
      const ra = Number(response.headers.get('Retry-After'))
      throw new RateLimitError(Number.isFinite(ra) ? ra : undefined)
    }
    if (response.status === 404) throw new NotFoundError()
    if (response.status === 409) throw new ConflictError()
    if (response.status >= 500) {
      throw new UpstreamServiceError(`{App Name} error ${response.status}`, response.status)
    }
    if (response.status === 400 || response.status === 422) {
      // Surface the provider's validation message when available.
      throw new InvalidInputError(extractProviderMessage(data) ?? 'Validation error.')
    }
    throw new Error(`{App Name} API error: ${response.status} ${response.statusText}`)
  }

  return data as T
}
```

For pagination, follow `shopifyApiGetAll` (`apps/shopify/.../shared/shopify-api.ts`) — Link-header or cursor loop with a hard page cap (50).

#### 2.2 Client data hook (`shared/use-{app-slug}-data.ts`)

Unchanged from v2 — module-level cache (5-min TTL), in-flight dedup, `{ data, loading, error, refresh }`. Copy from any recent app.

#### 2.3 Server data fetchers (`shared/list-{data}.server.ts`)

Unchanged from v2 — one file per dropdown data type, returns `{ value, label }[]`, empty array when no connection.

---

### Phase 3: Tools

Tools come in two flavors that share the same `defineTool` anatomy:

- **Agent/action tools** (`src/tools/*.tool.tsx`) — purpose-built for LLM or human use: tight zod schemas, rich `.describe()` hints, `exampleOutput`, surface keys.
- **Internal tools** (`src/tools/internal/*.tool.tsx`) — back the workflow block's dispatcher. No surface keys.

Each tool is a **pair of files**: `{name}.tool.tsx` (definition) + `{name}.tool.server.ts` (execute). The build scanner requires `execute` to be a **default import from a `.tool.server.ts` file** — same rule as workflow blocks.

#### 3.1 Agent-facing tool definition

```tsx
// src/tools/find-{thing}.tool.tsx
import { defineTool, refs, z } from '@auxx/sdk/tools'
import appIcon from '../assets/icon.png'
import findThingExecute from './find-{thing}.tool.server'

export const findThingTool = defineTool({
  // snake_case id for agent-facing tools; must match ^[a-zA-Z0-9_-]{1,64}$
  id: 'find_{thing}',
  name: 'Find {thing}',
  // Sent to the LLM — write it like a hint: what it does, what it returns,
  // when to use it.
  description: 'Look up a {thing} by email or id. Returns provider data plus the Auxx recordId when imported.',
  icon: appIcon,
  inputs: z.object({
    email: z.string().email().optional().describe('Customer email. Provide email OR id.'),
    id: z.string().optional().describe('Provider id. Provide email OR id.'),
  }),
  outputs: z.object({
    found: z.boolean(),
    thing: z
      .object({
        // refs.entity marks fence-resolvable id fields — the platform mines
        // these from outputs to render entity cards. Output-only.
        auxxRecordId: refs.entity('contact').nullable()
          .describe('Auxx contact record id, or null if not imported.'),
        providerId: z.string(),
        email: z.string().nullable(),
        createdAt: z.string().describe('ISO 8601.'),
      })
      .nullable(),
  }),
  // One realistic success output. Validated against `outputs` at build time;
  // reused by eval autofill, capture/headless mode, and docs.
  exampleOutput: {
    found: true,
    thing: {
      auxxRecordId: null,
      providerId: '12345',
      email: 'jane@example.com',
      createdAt: '2026-01-15T08:00:00Z',
    },
  },
  config: {
    requiresConnection: true,
    timeout: 10000, // default 15000; hard cap 30000 buffered / 120000 streaming
    idempotent: true, // opt-in for read-only tools
  },
  execute: findThingExecute,
  // SURFACE KEY — exposes to the agent picker, gated by the toolset.
  agent: { toolsetSlug: '{app-slug}.{toolset}' },
})
```

```typescript
// src/tools/find-{thing}.tool.server.ts
import { {app}Api } from '../blocks/{app-slug}/shared/{app-slug}-api'
import { get{App}Connection } from './shared/connection'

interface FindThingInput { email?: string; id?: string }
interface FindThingOutput { found: boolean; thing: Record<string, unknown> | null }

export default async function findThing(input: FindThingInput): Promise<FindThingOutput> {
  // Re-validate any zod .refine() constraints here — the JSON Schema
  // converter strips refinements, so the LLM can send inputs that violate them.
  const { token } = get{App}Connection()
  // ... call the API, map the result
  return { found: true, thing: { /* mapped */ } }
}
```

The server execute also receives a second `ctx: ToolExecuteContext` argument (`organizationId`, `userId`, `appInstallationId`, `sessionId`, `agentId`, `triggerId`) — entity lookups and field I/O are reached through `@auxx/sdk/server` functions, not `ctx`.

**Authoring rules for agent tools:**

- `.describe()` every input and any non-obvious output field — these are LLM-facing.
- Move zod `.refine()` checks into the execute as runtime guards (converter strips them).
- Mark fence-resolvable ids with `refs.entity(kind)` — kinds: `contact`, `company`, `deal`, `ticket`, `task`, `user`, `article`, `thread`. Output fields only.
- Always provide `exampleOutput`.
- Map provider records through shared mappers (`tools/shared/map-{entity}.ts`) so all tools return consistent shapes.

#### 3.2 `agent` surface options

```typescript
agent: {
  name: 'custom_llm_name',        // defaults to tool id
  description: '…',               // defaults to tool description
  toolsetSlug: '{app-slug}.{toolset}',
  idempotent: true,               // LLM hint for read-only tools
  streaming: true,                // execute returns AsyncGenerator (declare explicitly)
  surfaces: ['chat', 'email'],    // allow-list: internal | chat | email | builder; absent ⇒ all
  externalSafe: true,             // advisory: safe for untrusted external callers (chat visitors)
  inputBindings: [                // platform clamps these inputs from turn context;
    {                             // the model never supplies them
      name: 'customerId',
      default: { kind: 'var', ref: 'contact:@app:{app-slug}:customerId' },
    },
  ],
},
```

`surfaces` and `externalSafe` are **not** security gates — the admin enabling the toolset is. `inputBindings` is the mechanism for identity-scoped reads (e.g. Shopify's order lookup binds `customerId` to the verified contact's app field so a chat visitor can never query someone else's orders).

#### 3.3 `action` surface options (quick actions)

Add to any tool that should run as a button on a ticket or in the email editor (see `apps/stripe/src/tools/issue-stripe-refund.tool.tsx`):

```typescript
action: {
  label: 'Refund Charge',
  description: 'Issue a full or partial refund',
  color: '#635BFF',
  surface: 'ticket-header',           // or 'email-editor'
  requiresConfirmation: true,
  confirmationMessage: 'Issue this refund?',
  shouldShow: (ctx) => ctx.entities.some((e) => e.entityDefinitionSlug === '{app}-order'),
  getDefaults: (ctx) => ({ chargeId: ctx.ticket?.fields.chargeId }),
},
```

`ctx` is a `ToolActionContext`: `threadId`, `ticket?`, `participants[]` (with resolved `contact`), and `entities[]` (everything linked to the thread).

#### 3.4 Toolsets (`src/tools/toolsets.ts`)

Toolsets are the approval gate an admin uses to grant an agent a group of tools at once. Every tool with `agent: { toolsetSlug }` must reference an id declared here.

```typescript
// src/tools/toolsets.ts
import type { Toolset } from '@auxx/sdk/tools'

export const {appSlug}Toolsets: Toolset[] = [
  {
    id: '{app-slug}.{things}',           // runtime slug: app:{app-slug}:{things}
    name: '{App Name} {things}',
    description: 'Find and inspect {things}.',
    tools: ['find_{thing}', 'get_{thing}'],
  },
  {
    id: '{app-slug}.{things}.write',
    name: '{App Name} {things} (write)',
    description: 'Mutating ops. Enable only for agents you trust to act unattended.',
    tools: ['cancel_{thing}', 'refund_{thing}'],
    // subGroup: '{Things}',  // optional collapsible grouping under the app row
  },
]
```

**Conventions:**

- **Read/write split** on sensitive resources, so enabling read for a triage agent doesn't arm it to mutate. Toolset selection *is* the write-approval gate.
- **No `isDefault` flag** — admins pick every toolset deliberately.
- A preflight tool every other toolset depends on (e.g. `list_shopify_stores`) can be intentionally toolset-less — the platform auto-attaches it when any of the app's toolsets is enabled.

---

### Phase 4: Block as Dispatcher

The block keeps its v2 anatomy — assembled `Workflow.*` schema, resource/operation constants, per-resource panels, canvas node — but the execution path changed: the server file routes through a `toolMap` into **internal tools**.

#### 4.1 Resource/operation constants (`resources/constants.ts`)

Unchanged from v2: `RESOURCES`, `OPERATIONS`, `ALL_OPERATIONS`, `VALID_OPERATIONS`.

#### 4.2 Per-resource schema & panel

Unchanged from v2. Schemas use `Workflow.*` factories with operation-prefixed field names (`createProjectName`, `getProjectId`); panels use `ConditionalRender` / `Section` / `VarFieldGroup` / `OptionsInput` (with `loading`) / `ArrayInput` + `useArrayItem()`.

Field factories reference: `Workflow.string/number/boolean/select/date/datetime/time/email/url/phone/object/currency/secret/file/array/struct` — all support `acceptsVariables: true`. See `packages/sdk/src/root/workflow/input-nodes.ts`.

#### 4.3 Per-resource implementation (`resources/{resource}/{resource}-execute.server.ts`)

Business logic lives here, same as v2 — `executeResource(operation, input)` switch over operations, calling the API client. The difference is *who calls it*: not the block's server file directly, but the internal tools (next step).

```typescript
// src/blocks/{app-slug}/resources/{resource}/{resource}-execute.server.ts
import { getOrganizationConnection } from '@auxx/sdk/server'
import { {app}Api, throwConnectionNotFound } from '../../shared/{app-slug}-api'

export async function execute{Resource}(
  operation: string,
  input: Record<string, any>
): Promise<Record<string, any>> {
  const connection = getOrganizationConnection()
  if (!connection?.value) throwConnectionNotFound()
  const credential = connection.value

  switch (operation) {
    case 'create': { /* … */ }
    case 'get': { /* … */ }
    default:
      throw new Error(`Unknown {resource} operation: ${operation}`)
  }
}
```

#### 4.4 Internal tools (`tools/internal/{resource}-{op}.tool.tsx`)

One small internal tool per `${resource}.${operation}` pair. Two patterns exist:

**Pattern A — flat passthrough (Shopify).** The internal tool accepts the block's prefixed field names unchanged via `z.object({}).passthrough()`, and its server file delegates straight to the resource execute. Fast to write when migrating an existing block; the cost is untyped tool inputs.

```tsx
// src/tools/internal/{resource}-{op}.tool.tsx
import { defineTool, z } from '@auxx/sdk/tools'
import appIcon from '../../assets/icon.png'
import execute from './{resource}-{op}.tool.server'

export const {resource}{Op}Tool = defineTool({
  id: 'block_{app_slug}_{resource}_{op}',
  name: '{App Name} {resource} {op} (block-internal)',
  description: 'Internal tool backing the {App Name} workflow block. Not exposed to agents.',
  icon: appIcon,
  inputs: z.object({}).passthrough(),
  outputs: z.object({}).passthrough(),
  config: { requiresConnection: true, timeout: 15000 },
  execute,
  // NO agent/action keys — internal-only.
})
```

```typescript
// src/tools/internal/{resource}-{op}.tool.server.ts
import { execute{Resource} } from '../../blocks/{app-slug}/resources/{resource}/{resource}-execute.server'

export default async function {resource}{Op}Execute(
  input: Record<string, any>
): Promise<Record<string, any>> {
  return execute{Resource}('{op}', input)
}
```

**Pattern B — typed inputs + projection (WhatsApp, preferred for new apps).** Internal tools declare real flat zod schemas; the block dispatcher projects the block's prefixed union shape onto each tool's flat shape (and projects outputs back when names differ). This keeps internal tools individually testable and reusable.

#### 4.5 Tool map (`blocks/{app-slug}/{app-slug}-tool-map.ts`)

Lives in a **plain `.ts` file** (not the `.workflow.tsx`) so the server-side dispatcher can import it without dragging in the React/client surface.

```typescript
// src/blocks/{app-slug}/{app-slug}-tool-map.ts
export const {appSlug}ToolMap = {
  '{resource1}.create': 'block_{app_slug}_{resource1}_create',
  '{resource1}.get': 'block_{app_slug}_{resource1}_get',
  '{resource1}.getMany': 'block_{app_slug}_{resource1}_get_many',
  '{resource2}.create': 'block_{app_slug}_{resource2}_create',
  // …one entry per valid resource/operation pair
} as const
```

#### 4.6 Block server dispatcher (`{app-slug}.server.ts`)

```typescript
// src/blocks/{app-slug}/{app-slug}.server.ts
import type { WorkflowExecuteFunction } from '@auxx/sdk'
import { VALID_OPERATIONS } from './resources/constants'
import { {appSlug}Schema } from './{app-slug}-schema'
import { {appSlug}ToolMap } from './{app-slug}-tool-map'

const execute: WorkflowExecuteFunction<typeof {appSlug}Schema> = async (input, ctx) => {
  const { resource, operation } = input

  const valid = VALID_OPERATIONS[resource]
  if (!valid) throw new Error(`Unknown resource: ${resource}`)
  if (!valid.includes(operation)) {
    throw new Error(`Invalid operation "${operation}" for resource "${resource}"`)
  }

  const key = `${resource}.${operation}` as keyof typeof {appSlug}ToolMap
  const toolId = {appSlug}ToolMap[key]
  if (!toolId) throw new Error(`No tool mapped for ${key}`)

  // Pattern A: forward the flat block input unchanged.
  return ctx.runTool(toolId, input)
  // Pattern B: project first — see apps/whatsapp/src/blocks/whatsapp/whatsapp.server.ts
  // return projectOutputForOp(key, await ctx.runTool(toolId, projectInputsForOp(key, input)))
}

export default execute
```

`ctx` is a `WorkflowExecuteContext` — currently just `runTool(toolId, input)`. The full server SDK is still reached via `@auxx/sdk/server` imports.

#### 4.7 Block export (`{app-slug}.workflow.tsx`)

```tsx
// src/blocks/{app-slug}/{app-slug}.workflow.tsx
import { type WorkflowBlock } from '@auxx/sdk'
import { WorkflowNode, WorkflowNodeHandle, WorkflowNodeRow, useWorkflowNode } from '@auxx/sdk/client'
import appIcon from '../../assets/icon.png'
import {appSlug}Execute from './{app-slug}.server'
import { {AppSlug}Panel } from './{app-slug}-panel'
import { {appSlug}Schema } from './{app-slug}-schema'
import { {appSlug}ToolMap } from './{app-slug}-tool-map'

function {AppSlug}Node() {
  const { data } = useWorkflowNode()
  const label = RESOURCE_LABELS[data.resource]?.[data.operation] || '{App Name}'
  return (
    <WorkflowNode>
      <WorkflowNodeHandle type="target" id="target" position="left" />
      <WorkflowNodeRow label={label} />
      <WorkflowNodeHandle type="source" id="source" position="right" />
    </WorkflowNode>
  )
}

export const {appSlug}Block = {
  id: '{app-slug}',
  label: '{App Name}',
  description: '{Short description}',
  category: 'action',
  icon: appIcon,
  color: '{#hexcolor}',
  schema: {appSlug}Schema,
  node: {AppSlug}Node,
  panel: {AppSlug}Panel,
  execute: {appSlug}Execute,
  config: {
    timeout: 15000,
    retries: 1,
    requiresConnection: true,
  },
  toolMap: {appSlug}ToolMap,
} satisfies WorkflowBlock<typeof {appSlug}Schema>
```

#### 4.8 Top-level panel & assembled schema

Unchanged from v2: assembled schema spreads per-resource inputs with `computeOutputs` branching on `(resource, operation)`; the top-level panel renders the resource/operation `FieldRow` per resource (filtered operations), auto-resets operation on resource change, and lazily loads dropdown data.

---

### Phase 5: App Fields (Optional)

Apps can own custom fields on platform entities — provisioned automatically per install (`scope: 'installation'`) or per connected account (`scope: 'connection'`), and removed on disconnect/uninstall.

```typescript
// src/fields.ts
import { defineFields } from '@auxx/sdk/fields'

export const {appSlug}Fields = defineFields([
  {
    appFieldKey: 'customerId',        // stable id, ^[a-zA-Z][a-zA-Z0-9_]{0,63}$
    type: 'TEXT',
    targetEntity: 'contact',          // EntityRefKind — resolved at provision time
    scope: 'connection',              // one field set per connected account
    name: '{App Name} customer ID',
    capabilities: {
      hidden: true,                   // not shown in the CRM UI
      filterable: true,
      sortable: false,
      creatable: false,               // platform-written, never user-supplied
      updatable: false,
    },
  },
])
```

Register in `app.tsx` as `fields: {appSlug}Fields`. Field types are discriminated: select types (`SINGLE_SELECT`/`MULTI_SELECT`/`TAGS`) **require** `options`; `RELATIONSHIP` requires `relationship: { targetEntity, cardinality }`; `CALC` requires `calc.expression`; scalars forbid all three — misconfig is a compile error.

The killer combo: a hidden, platform-written field (e.g. the verified storefront customer id) + an agent tool `inputBinding` referencing `'{entity}:@app:{app-slug}:{appFieldKey}'` gives you identity-scoped reads that untrusted callers can't spoof. See `apps/shopify/src/fields.ts` for the worked example and rationale.

---

### Phase 6: Triggers

Triggers live at **top-level `src/triggers/{trigger-name}/`** and are declared with `defineTrigger`. The node/panel hang off the `workflow` surface key.

| Type | When | Execute signature | Webhooks? | Lifecycle events? |
|------|------|-------------------|-----------|------------------|
| **Webhook** | Service pushes events | `(input) => input` (passthrough) | Yes | Yes |
| **Polling** | You fetch on a schedule | `(input, polling) => { events, state }` | No | No |

#### 6.1 Trigger schema (`{trigger-name}-schema.ts`)

Unchanged from v2: inputs = filter/config fields (`Workflow.*`), outputs = event data fields.

#### 6.2 Trigger panel (`{trigger-name}-panel.tsx`)

Webhook triggers still sync `triggerFilters` to node data — but **guard against redundant writes** (compare serialized values before calling `updateData`):

```tsx
// src/triggers/{trigger-name}/{trigger-name}-panel.tsx
import { useEffect } from 'react'
import { WorkflowPanel, useWorkflow } from '@auxx/sdk/client'
import { {triggerName}Schema } from './{trigger-name}-schema'

export function {TriggerName}Panel() {
  const { data, updateData, OptionsInput, VarField, VarFieldGroup, Section } =
    useWorkflow<typeof {triggerName}Schema>({triggerName}Schema)

  useEffect(() => {
    const topics = Array.isArray(data?.topic) ? data.topic : data?.topic ? [data.topic] : []
    const filters = topics.length > 0 ? { topic: topics } : undefined
    if (JSON.stringify(filters) !== JSON.stringify((data as any)?.triggerFilters)) {
      updateData({ triggerFilters: filters } as any)
    }
  }, [data?.topic])

  return (
    <WorkflowPanel>
      <Section title="Trigger">
        <VarFieldGroup>
          <VarField>
            <OptionsInput name="topic" />
          </VarField>
        </VarFieldGroup>
      </Section>
    </WorkflowPanel>
  )
}
```

Polling triggers: the platform renders the "Polling Interval" selector automatically — don't render it yourself.

#### 6.3 Trigger execute (`{trigger-name}.server.ts`)

**Webhook (passthrough)** — trigger data arrives pre-populated from the webhook handler:

```typescript
export default async function {triggerName}Execute(input: Record<string, unknown>) {
  return input as any
}
```

**Polling** — called on a schedule with persisted state + connection:

```typescript
import type { PollingState, PollingExecuteResult } from '@auxx/sdk' // workflow types

export default async function {triggerName}Execute(
  input: Record<string, unknown>,        // panel config values
  polling: PollingState                  // { state, connection }
): Promise<PollingExecuteResult> {
  const { state, connection } = polling
  if (!connection?.value) return { events: [], state }

  const lastChecked = (state.lastChecked as string) || new Date().toISOString()
  // fetch since lastChecked, filter per `input` config, map to schema outputs…
  const events = [/* each event must include an `eventId` for dedup */]

  return { events, state: { ...state, lastChecked: new Date().toISOString() } }
}
```

Polling rules (unchanged from v2): include `eventId` per event for dedup; prefer "miss events rather than re-process" when state is missing; return `[]` on provider errors with advanced state rather than throwing on every poll.

#### 6.4 Trigger export (`{trigger-name}.workflow.tsx`)

```tsx
// src/triggers/{trigger-name}/{trigger-name}.workflow.tsx
import { defineTrigger } from '@auxx/sdk'
import { WorkflowNode, WorkflowNodeHandle, WorkflowNodeRow, useWorkflowNode } from '@auxx/sdk/client'
import appIcon from '../../assets/icon.png'
import { {TriggerName}Panel } from './{trigger-name}-panel'
import { {triggerName}Schema } from './{trigger-name}-schema'
import {triggerName}Execute from './{trigger-name}.server'

function {TriggerName}Node() {
  const { data } = useWorkflowNode()
  return (
    <WorkflowNode>
      <WorkflowNodeRow label={/* derive from data */ '{Trigger Label}'} />
      <WorkflowNodeHandle type="source" id="source" position="right" />
    </WorkflowNode>
  )
}

export const {triggerName}Trigger = defineTrigger({
  id: '{app-slug}.{trigger-name}',
  label: '{Trigger Label}',
  description: '{When this trigger fires}',
  icon: appIcon,
  color: '{#hexcolor}',
  schema: {triggerName}Schema,
  execute: {triggerName}Execute,
  config: {
    timeout: 5000,
    retries: 0,
    requiresConnection: true,
    // POLLING TRIGGERS ONLY — presence of `polling` switches the platform to
    // BullMQ cron scheduling instead of waiting for webhooks:
    // polling: { intervalMinutes: 5, minIntervalMinutes: 1 },
    // …or for advanced schedules: polling: { cron: '0 9 * * 1' },
  },
  // SURFACE KEY — workflow start node.
  workflow: {
    node: {TriggerName}Node,
    panel: {TriggerName}Panel,
  },
  // SURFACE KEY (optional) — fan out into agents:
  // agent: { label: '…', description: '…', defaultEnabled: false },
})
```

#### 6.5 Trigger types/helpers (`shared/{trigger-name}-types.ts`)

For webhook triggers, keep `detectEventType` / `extractTriggerData` helpers here, same as v2. For polling triggers the extraction usually lives inline in the execute.

---

### Phase 7: Webhook Handling (Webhook Triggers Only)

```typescript
// src/webhooks/{handler-name}.webhook.ts
import { extractTriggerData } from '../triggers/{trigger-name}/shared/{trigger-name}-types'

const okResponse = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

export default async function {handlerName}Webhook(
  req: Request
): Promise<
  Response | { response: Response; triggerData: Record<string, unknown>; eventId: string }
> {
  try {
    // 1. Validate provider headers / signature
    const topic = req.headers.get('x-{provider}-topic')
    if (!topic) return new Response('Missing headers', { status: 400 })

    // 2. Parse + extract
    const payload = await req.json()
    const triggerData = extractTriggerData(topic, payload)

    // 3. Unhandled event type → 200 to prevent retry storms
    if (!triggerData) return okResponse()

    // 4. Return response + trigger data + dedup id
    return {
      response: okResponse(),
      triggerData,
      eventId: `{app-slug}-${topic}-${payload.id ?? Date.now()}`,
    }
  } catch (error) {
    console.error('[{handler-name}.webhook] Error processing webhook:', error)
    return okResponse()
  }
}
```

Key patterns (unchanged from v2): always 200 for unhandled events; `triggerData` matches trigger outputs; `eventId` deduplicates; the platform matches `triggerData` against the panel's `triggerFilters`. Wrap the whole body in try/catch — a thrown handler triggers provider retries.

---

### Phase 8: Connection Lifecycle Events (Webhook Triggers Only)

**Signatures changed since v2**: handlers receive `{ connection }` (the full `Connection`, with `id`, `value`, `metadata`) and `connection-added` may return a `ConnectionAddedResult` — returning `{ label }` renames the connection in the UI (e.g. to the connected store's domain).

#### 8.1 `events/connection-added.event.ts`

```typescript
import type { Connection, ConnectionAddedResult } from '@auxx/sdk/server'
import { createWebhookHandler, updateWebhookHandler } from '@auxx/sdk/server'
import { {app}Api } from '../blocks/{app-slug}/shared/{app-slug}-api'

const WEBHOOK_TOPICS = ['{event1}', '{event2}']

export default async function connectionAdded({
  connection,
}: {
  connection: Connection
}): Promise<ConnectionAddedResult> {
  const token = connection.value
  if (!token) return {}

  // 1. Create the platform webhook handler
  const handler = await createWebhookHandler({
    fileName: '{handler-name}',                  // matches webhooks/{handler-name}.webhook.ts
    triggerId: '{app-slug}.{trigger-name}',
    connectionId: connection.id,
  })

  // 2. Register topics with the provider — per-topic try/catch; collect and
  //    summarize skips (missing scopes etc.) instead of failing the whole hook.
  const webhookIds: string[] = []
  const skipped: string[] = []
  for (const topic of WEBHOOK_TOPICS) {
    try {
      const result = await {app}Api<{ id: number }>(token, '/webhooks', {
        method: 'POST',
        body: { topic, address: handler.url, format: 'json' },
      })
      webhookIds.push(String(result.id))
    } catch {
      skipped.push(topic)
    }
  }

  // 3. Store metadata for cleanup
  await updateWebhookHandler(handler.id, {
    metadata: { webhookIds, registeredAt: new Date().toISOString() },
  })
  if (skipped.length) {
    console.warn(`[{app-slug}] Skipped ${skipped.length} topic(s): ${skipped.join(', ')}`)
  }

  // 4. Optionally rename the connection to something recognizable
  return { label: /* e.g. account/store identifier */ undefined }
}
```

Apps without webhooks still ship the file with an empty body (and it's where field provisioning side-effects would go if you need custom behavior beyond `defineFields`).

#### 8.2 `events/connection-removed.event.ts`

```typescript
import type { Connection } from '@auxx/sdk/server'
import { deleteWebhookHandler, listWebhookHandlers } from '@auxx/sdk/server'
import { {app}Api } from '../blocks/{app-slug}/shared/{app-slug}-api'

export default async function connectionRemoved({ connection }: { connection: Connection }) {
  const token = connection.value

  const allHandlers = await listWebhookHandlers()
  const connectionHandlers = allHandlers.filter((h) => h.connectionId === connection.id)

  // 1. Unregister from the provider (best-effort — token may already be revoked)
  if (token) {
    for (const handler of connectionHandlers) {
      const webhookIds = handler.metadata?.webhookIds as string[] | undefined
      for (const webhookId of webhookIds ?? []) {
        try {
          await {app}Api(token, `/webhooks/${webhookId}`, { method: 'DELETE' })
        } catch {
          /* best-effort */
        }
      }
    }
  }

  // 2. Delete platform handlers
  for (const handler of connectionHandlers) {
    await deleteWebhookHandler(handler.id)
  }
}
```

---

### Phase 9: Settings (`src/app.settings.ts`)

```typescript
// src/app.settings.ts
import { Settings, type SettingsSchema } from '@auxx/sdk'

export const appSettingsSchema = {
  organization: {
    exampleSetting: Settings.string({
      label: 'Example setting',
      description: 'Help text shown to the admin.',
      isOptional: true,
    }),
  },
  user: {},
} satisfies SettingsSchema

export default appSettingsSchema
```

Ship the file even when both maps are empty.

---

### Phase 10: Testing

Recommended, not yet universal (whatsapp/discord have suites; shopify doesn't). With Pattern B internal tools, test the tool server executes directly.

#### 10.1 `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@auxx/sdk/server': './tests/__mocks__/auxx-sdk-server.ts',
    },
  },
})
```

#### 10.2 `tests/__mocks__/auxx-sdk-server.ts`

Mock every `@auxx/sdk/server` export the code under test touches — including the error classes, since the API client imports them:

```typescript
import { vi } from 'vitest'

export const getConnection = vi.fn(() => null)
export const getOrganizationConnection = vi.fn(() => null)
export const getUserConnection = vi.fn(() => null)

export class ConnectionExpiredError extends Error {}
export class InsufficientPermissionsError extends Error {}
export class InvalidInputError extends Error {}
export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class RateLimitError extends Error {}
export class UpstreamServiceError extends Error {
  constructor(message: string, public status?: number) { super(message) }
}
```

#### 10.3 What to test

- **API client**: auth headers, method/body forwarding, qs handling, 204 handling, each error-class mapping (401 → `ConnectionExpiredError`, 429 → `RateLimitError` with Retry-After, etc.), pagination caps.
- **Tool executes**: connection-missing throw, happy path per operation, runtime re-validation of stripped zod refinements, provider error propagation.
- **Block dispatcher**: routes every `VALID_OPERATIONS` pair to the mapped tool id (mock `ctx.runTool`), throws on unknown resource / invalid operation / unmapped key. Projection helpers (Pattern B) get table-driven input/output projection tests.
- **Webhook handlers**: header validation, unhandled-topic 200, `triggerData` extraction, `eventId` shape.

---

## 6. Checklist

### Core Setup
- [ ] Copied `apps/__template` → `apps/{app-slug}`; renamed example tool/block/trigger
- [ ] `package.json` name/scripts/deps updated (prettier lint, zod, vitest if testing)
- [ ] `src/assets/icon.png` added (PNG — not SVG)
- [ ] `app.tsx` registry lists every tool (incl. internal), toolsets, blocks, triggers, fields
- [ ] `app.settings.ts` ships (even if empty), `satisfies SettingsSchema`, default export

### Connection
- [ ] Connection configured in build portal (`oauth2-code` / `secret` / `none`)
- [ ] OAuth: redirect URI registered; dynamic connection variables if per-tenant URLs/creds
- [ ] Shared connection helper in `tools/shared/connection.ts` using unified `getConnection()`

### Tools
- [ ] Agent tools: snake_case ids, `.describe()` on every input, `refs.entity()` on fence-resolvable output ids, `exampleOutput` on every tool
- [ ] zod `.refine()` constraints re-checked at runtime in the execute
- [ ] Every `.tool.tsx` paired with a default-export `.tool.server.ts`
- [ ] `toolsets.ts`: read/write split on sensitive resources; every agent tool's `toolsetSlug` declared
- [ ] Write tools: consider `requiresConfirmation` on the action surface; never `externalSafe`
- [ ] Identity-scoped reads use `inputBindings` against an app field, not model-supplied ids
- [ ] Quick actions (`action` key) where a tool makes sense as a ticket/email button

### Block (if applicable)
- [ ] API client uses SDK error classes
- [ ] Resource constants / schemas / panels (v2 patterns still apply)
- [ ] One internal tool per resource/operation pair (no surface keys)
- [ ] `{app-slug}-tool-map.ts` in a plain `.ts` file; every `VALID_OPERATIONS` pair mapped
- [ ] Server file is a thin `ctx.runTool` dispatcher (`WorkflowExecuteFunction`)
- [ ] Block export carries `toolMap` and `satisfies WorkflowBlock<typeof schema>`

### App Fields (if applicable)
- [ ] `defineFields` in `src/fields.ts`, registered as `app.fields`
- [ ] Correct `scope` (`installation` vs `connection`) and capabilities (hidden/creatable/updatable)

### Triggers (if applicable)
- [ ] Declared with `defineTrigger` under top-level `src/triggers/`
- [ ] `workflow: { node, panel }` surface key; `agent` surface if it should fan out to agents
- [ ] Webhook: passthrough execute, `triggerFilters` panel sync (with redundant-write guard), handler file, lifecycle events
- [ ] Polling: `config.polling` (`intervalMinutes` or `cron`, plus `minIntervalMinutes`), `{ events, state }` execute, `eventId` per event
- [ ] Webhook handler: try/catch the whole body, 200 for unhandled topics, typed return

### Lifecycle Events (webhook triggers)
- [ ] `connection-added`: `({ connection })` signature, per-topic try/catch with skip summary, `updateWebhookHandler(handler.id, { metadata })`, optional `{ label }` return
- [ ] `connection-removed`: filter `listWebhookHandlers()` by `connectionId`, best-effort provider cleanup, delete handlers

### Testing
- [ ] vitest config + SDK server mock (incl. error classes)
- [ ] API client / tool execute / dispatcher routing / webhook extraction tests pass

### Integration Testing
- [ ] Connect flow end-to-end; connection label set correctly
- [ ] Each agent tool: enable its toolset on a test agent, invoke from chat/builder, verify output + entity fences
- [ ] Each quick action: appears on the right surface, confirmation fires, defaults populate
- [ ] Each block operation through the workflow editor
- [ ] Triggers fire with correct outputs; filters exclude non-matching events
- [ ] App fields provisioned on connect, removed on disconnect
- [ ] Webhook/polling lifecycle: publish → registered/scheduled, disable/delete → cleaned up

---

## 7. Adding Things Later

### Adding an agent tool
1. Create `tools/{name}.tool.tsx` + `.tool.server.ts` with `agent: { toolsetSlug }`
2. Add the tool id to an existing toolset (or declare a new one) in `toolsets.ts`
3. Register in `app.tsx` → `tools[]`
4. Add `exampleOutput`; add execute tests

### Adding a block operation
1. Add to `OPERATIONS` / `ALL_OPERATIONS` / `VALID_OPERATIONS` in `constants.ts`
2. Implement in the resource execute (or create the resource per v2 steps)
3. Create the internal tool pair in `tools/internal/`; register in `app.tsx` → `tools[]`
4. Map the pair in `{app-slug}-tool-map.ts`
5. Schema inputs + `computeOutputs` branch + panel `ConditionalRender` + node label
6. Dispatcher routing test

### Adding a trigger
1. Create `src/triggers/{name}/` with schema, panel, execute, and `defineTrigger` export
2. Webhook: extend/add the webhook handler + lifecycle event registration. Polling: set `config.polling`
3. Register in `app.tsx` → `workflow.triggers[]`
4. Consider the `agent` surface key if agents should react to it

---

## 8. Key Architecture References

| Document / Code | Location |
|----------|----------|
| Scaffold app + surface-model README | `auxxai-apps/apps/__template/` |
| Tool types (surfaces, config, Toolset, ctx) | `packages/sdk/src/root/tools/types.ts` |
| `defineTool` / `refs` | `packages/sdk/src/root/tools/` |
| `defineFields` / field types | `packages/sdk/src/root/fields/` |
| Workflow/trigger types (`defineTrigger`, `WorkflowExecuteContext`, polling) | `packages/sdk/src/root/workflow/types.ts` |
| SDK field factories (`Workflow.*`) | `packages/sdk/src/root/workflow/input-nodes.ts` |
| SDK client hooks | `packages/sdk/src/client/workflow/` |
| SDK server exports (connections, webhook handlers, errors) | `packages/sdk/src/server/` |
| Full reference app (tools + fields + trigger + block) | `auxxai-apps/apps/shopify/` |
| Action-surface reference | `auxxai-apps/apps/stripe/` |
| Projection dispatcher + tests reference | `auxxai-apps/apps/whatsapp/` |
| Polling trigger reference | `auxxai-apps/apps/gog-calendar/` |
| Apps/tools platform plan | `plans/kopilot/apps/README.md` |
| Refs / entity fences | `plans/kopilot/apps/refs.md` |
| Tool example outputs (evals) | `plans/evals/tool-example-outputs.md` |
| Agent credentials / account binding | `plans/kopilot/apps/agent-credentials.md` |
| Tool availability surfaces | `plans/chat/v6/chat-tool-availability.md` |
| Per-app surface migration | `plans/kopilot/agents/triggers/app-surface-per-app-migration.md` |
| Dynamic OAuth variables | `plans/apps/oauth/dynamic-oauth-variables-plan.md` |
| Connection config form | `apps/build/src/app/(portal)/[slug]/apps/[app_slug]/connections/page.tsx` |
| OAuth authorize/callback routes | `apps/web/src/app/api/apps/[slug]/oauth2/{authorize,callback}/route.ts` |
| Previous template (superseded) | `plans/apps/template/app-implementation-template-v2.md` |
