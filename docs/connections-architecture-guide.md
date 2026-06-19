<!-- docs/connections-architecture-guide.md -->

# Connections & Credentials Architecture Guide

Date: 2026-06-19
Status: Reference guide

How Auxx stores, defines, and resolves every external credential — OAuth tokens,
API keys, database passwords, bot tokens — behind a single model. This is the
platform-side companion to `app-implementation-template-v3.md` §3, which covers
only the app-author slice.

> **History.** Connections used to live in four parallel systems (workflow
> `CREDENTIAL_REGISTRY`, app connections, MCP, integrations). They were unified
> onto two tables — see `plans/connections/unify-connection-definition.md`
> (Phases 1–8) and `plans/connections/multi-connection-per-app.md` (multi-method
> + primary pointer). This guide describes the result.

---

## 1. The two tables

Every credential in the platform is two rows working together:

| Table | Role | One sentence |
|---|---|---|
| **`ConnectionDefinition`** | The **blueprint** | *How* to connect — the auth type, OAuth URLs, the fields the user must supply. Authored once, never holds an org's secrets. |
| **`Credential`** | The **secret** | *What* an org actually connected — the encrypted token/key for one org (and maybe one user), pointing back at its definition. |

```
ConnectionDefinition (blueprint)  ──<  Credential (one per org/user connection)
  "how to connect to Stripe"            "Acme Corp's Stripe key, encrypted"
```

A definition is owned by exactly one of four things; a credential belongs to one
of four families. Those two axes are the whole model.

---

## 2. `ConnectionDefinition` — the blueprint

`packages/database/src/db/schema/connection-definition.ts`

A definition declares **how** to connect. It never stores an org's secret (an
OAuth *client* secret is the platform's, not an org's — and it's encrypted in
`oauth2ClientSecret`). The org's token lives in `Credential`.

### 2.1 The four owners

Exactly one owner column is set per row — enforced by `ConnectionDefinition_owner_check`:

| Owner column | Who owns it | Identity | Defined where |
|---|---|---|---|
| `appId` | An installable **app** (Stripe, Shopify, FedEx) | `(appId, key, major)` | Build portal — `apps/build/.../[app_slug]/connections/page.tsx` |
| `mcpServerId` | An **MCP server** connection | `mcpServerId` | MCP server config |
| `providerKey` | A **platform built-in** (Google OAuth, Postgres, SMTP) | `(providerKey, major)` | Code — `packages/lib/src/connections/providers/defs.ts`, seeded |
| *(none — workflow)* | A generic **workflow** credential type | n/a | Workflow node config |

The owner check (load-bearing): `appId | mcpServerId | providerKey` are mutually
exclusive, **and app rows must carry a `key`** — otherwise the partial unique
index on `(appId, key, major)` is toothless (Postgres treats NULLs as distinct,
so a duplicate app method could slip in).

### 2.2 Key columns

| Column | Purpose |
|---|---|
| `connectionType` | `'oauth2-code'` \| `'secret'` \| `'none'` — the auth mechanism (§3). |
| `key` | Method id within an app (`'oauth2'`, `'api_key'`). The addressable identity of one connection method (§5). NOT NULL for apps; null for mcp/platform. |
| `global` | `true` = org-wide credential, `false` = per-user. A property of the method/provider. |
| `major` | Version major — definitions are versioned. |
| `oauth2*` | OAuth2 config: authorize/token/refresh URLs, scopes, encrypted client id/secret, token-request auth method, refresh interval, `oauth2Features` (PKCE, extra params, scope separator). |
| `connectionVariables` | Dynamic fields the org supplies at connect time (§4). |
| `authApply` | Declarative spec for turning the resolved credential into request auth (§6). Null for DB/email/none. |

---

## 3. The three connection types

`connectionType` decides the connect UX and what `Credential` stores.

### `oauth2-code`
The platform runs the full OAuth2 authorization-code flow. The definition holds
authorize/token URLs, scopes, and the (encrypted) client id/secret. The org
clicks "Connect", is redirected, and the callback exchanges the code for an
access + refresh token. Tokens are **lazily refreshed on use** (§7). For apps,
routes are `apps/web/src/app/api/apps/[slug]/oauth2/{authorize,callback}/route.ts`.

### `secret`
No redirect — the user pastes value(s) that the platform encrypts.
- **Single secret** (no `connectionVariables`): one input; the consumer reads `connection.value`.
- **Multi-field secret** (`connectionVariables` defined): one input per variable; `secret: true` variables are encrypted, plain ones land in `metadata`. The consumer reads the merged map via `connection.fields`, and `connection.value` is `''`.

### `none`
No credentials, no connect UI.

---

## 4. Connection variables — dynamic & multi-field inputs

`ConnectionVariable[]` on the definition is the one mechanism behind both
"per-tenant OAuth values" and "multi-field API keys". Each variable is described
with the platform `FieldType` (TEXT / NUMBER / CHECKBOX / SINGLE_SELECT) so every
renderer picks the right control; `secret` (masking + encryption) and `multiline`
are orthogonal presentation flags, not types.

| For `oauth2-code` | For `secret` |
|---|---|
| Interpolated into `{key}` placeholders in `oauth2AuthorizeUrl` / `oauth2AccessTokenUrl` / `oauth2ClientId` / `oauth2ClientSecret` at authorize time (e.g. Shopify's `{shop}` subdomain). | Rendered as the multi-field connect form (e.g. FedEx's `client_id` + `client_secret` + `account_number`). |

At runtime the org's values are merged (plain from `metadata` + decrypted
`secret`-flagged) into `connection.fields`. Variables support `validation`,
`displayOptions.show` (conditional visibility), defaults, and select `options`.

---

## 5. Multiple methods per app + the primary pointer

`plans/connections/multi-connection-per-app.md` (implemented 2026-06-19).

One app can offer **alternative auth methods** — e.g. Stripe via API key *or*
OAuth2 — as **one `ConnectionDefinition` row per method**, distinguished by `key`.
Identity is `(appId, key, major)`; `global` is a property of each method, not part
of the key. If an app needs the same provider in two scopes (personal Google *and*
workspace Google) it declares two methods with distinct keys.

- **Connect UX:** the picker appears only when an app exposes >1 method; single-method apps connect with no extra click.
- **The disambiguator:** `Credential.connectionDefinitionId` (FK) records *which method* an org actually connected with. Every connect path writes it; the runtime resolver loads the definition from this FK, never by guessing from `appId`.
- **The primary pointer (`Credential.isDefault`):** an org can hold several org-scoped credentials for one app (multiple methods *or* multiple accounts). Unbound, org-global callers (record actions, quick actions, polling triggers, Kopilot capabilities) resolve to the **primary** one. At most one primary per `(org, app)` among org-scoped app rows (partial unique index). Agents (`appAccounts[appId].credId`) and workflows (`accountId`) bind a specific credential and ignore the primary. First org connection auto-becomes primary; `apps.setDefaultConnection` switches it.

---

## 6. `authApply` — credential → request auth

`packages/lib/src/connections/auth-apply.ts`

A declarative spec (`AuthApply` on the definition) for putting a resolved
credential onto an outgoing HTTP request — shared by the workflow HTTP node,
generic-REST connectors, and future consumers, so auth lives in one place.

```ts
type AuthApply =
  | { in: 'header'; name: string; format?: string }   // e.g. Authorization: Bearer {value}
  | { in: 'basic' }                                    // Basic from fields.user / fields.password
  | { in: 'query'; name: string }                      // ?api_key={value}
```

`{value}` interpolates the resolved token (OAuth access token, or the secret);
`{fieldKey}` interpolates any connection variable. `authApply` is **null** for
DB/email/none connections — those are secret bags the consuming driver reads
straight from `connection.fields`, not HTTP-request auth.

---

## 7. `Credential` — the encrypted store

`packages/database/src/db/schema/credential.ts`

One table behind four families, discriminated by `kind`:

| `kind` | `type` | Owner FK | Example |
|---|---|---|---|
| `app` | null | `appId` + `appInstallationId` | Acme's Stripe connection |
| `mcp` | null | `mcpServerId` | An MCP server connection |
| `integration` | provider (`'gmail'`) | — | A connected Gmail inbox |
| `workflow` | type (`'telegram-bot'`, or a `providerKey`) | — | A workflow bot token |

Key columns:

- `organizationId` (always) + `userId` (null = **org-scoped**, set = **user-scoped**) — the scope axis.
- `encryptedSecrets` — AES-256-GCM blob, **secrets only** (tokens, keys, passwords). See `@auxx/credentials/crypto`.
- `metadata` (jsonb) — plaintext companions: scopes, account email, shop domain, plain connection variables.
- `connectionDefinitionId` (FK) — the blueprint this credential was made from; the resolver's preferred lookup.
- `isDefault` — the org's primary org-scoped app connection (§5).
- `expiresAt` / `lastRefreshAt` / `lastRefreshFailureAt` / `consecutiveRefreshFailures` — OAuth expiry + refresh circuit breaker. `expiresAt` is the **only** home of expiry.

The store lives in `@auxx/credentials/store` (`find-credential`, `insert-credential`,
`reveal-secrets`, `rotate-secrets`, `set-default-credential`, `split-sensitive-fields`,
`merge-secrets`, …) — secrets and metadata are split on write and merged on reveal.

---

## 8. Runtime resolution

`packages/lib/src/connections/resolve-connection-for-runtime.ts` — the **one**
resolver for every owner. Given an owner + org + user, it finds the definition,
finds the credential, decrypts, lazily refreshes OAuth tokens, and returns
`RuntimeConnectionData` (`{ id, type, value, fields, authApply, metadata, expiresAt }`).

Resolution by owner input:

- **`connectionId`** — bind a specific `Credential` directly (agents, workflows, HTTP node). Loads the definition from the credential's own FK / owner / `providerKey`. Skips discovery.
- **`appId`** — resolves the user-scoped and org-scoped credentials **credential-first**: `findCredential` is primary-preferring (`ORDER BY isDefault DESC, createdAt DESC`), so the org's chosen primary wins when there's >1 connection. The method's definition comes from the credential's FK, so `type`/`authApply` always match the method actually connected.
- **`mcpServerId`** — org-scoped only.
- **`providerKey`** — the single platform-provider definition; its `global` flag decides org-wide vs per-user.

Because resolution keys on `connectionType` (not `kind`), workflow and platform
credentials get auto-refresh-on-use for free. Lazy refresh is single-flight and
never throws (`ensureFreshCredentialToken`); the hot path stays at one reveal.

---

## 9. Platform built-in providers

`packages/lib/src/connections/providers/` — `defs.ts` (the list), `types.ts`
(`PlatformProviderDef`), `ensure-platform-providers.ts` (the seeder).

Each entry is the old workflow `ICredentialType`, now a `ConnectionDefinition`
row keyed by `providerKey` (`'googleOAuth2Api'`, `'outlookOAuth2Api'`, `'postgres'`,
SMTP, …). The one indirection: instead of storing the OAuth client id/secret on
the row, a provider names the platform **env vars** (`systemClientIdEnv` /
`systemClientSecretEnv`) that hold them; `ensure-platform-providers` reads and
encrypts those into the row at seed/boot. Providers also carry `uiMetadata`
(brand icon, category, color) for the connect catalog.

---

## 10. The app SDK surface

`packages/sdk/src/server/connections.ts` — what an **app author** sees, and it's
deliberately method-agnostic:

```ts
interface Connection {
  id: string
  type: 'oauth2-code' | 'secret'   // the connectionType of THIS credential's definition
  value: string                    // token (oauth2) or single secret; '' for multi-field
  fields?: Record<string, string>  // merged plain + decrypted secret variables
  metadata?: { scope?, externalUserId?, tokenType?, [k]: any }
  expiresAt?: Date
}
```

App code reads `getConnection().value` (token/key) or `.fields` (multi-field) and
**never** reads anything identifying the method — Stripe's API key and OAuth token
both present as `Authorization: Bearer {value}`, so the same code works for either.
Authors declare methods in the build portal, not in app `src/`. To branch on auth
mechanism, branch on `connection.type` (oauth2 vs secret). See
`app-implementation-template-v3.md` §3 for the full author-facing workflow.

---

## 11. Key files

| What | Where |
|---|---|
| Definition schema | `packages/database/src/db/schema/connection-definition.ts` |
| Credential schema | `packages/database/src/db/schema/credential.ts` |
| Runtime resolver | `packages/lib/src/connections/resolve-connection-for-runtime.ts` |
| Definition loader / refresh config | `packages/lib/src/connections/resolve-connection-definition.ts` |
| `authApply` helper | `packages/lib/src/connections/auth-apply.ts` |
| Save (platform/unified) | `packages/lib/src/connections/save-connection.ts` |
| Save (app) | `packages/lib/src/apps/connections/save-app-connection.ts` |
| Credential store | `packages/credentials/src/store/` |
| Crypto (AES-256-GCM v2) | `packages/credentials/src/crypto/` |
| Platform providers | `packages/lib/src/connections/providers/` |
| App SDK `Connection` | `packages/sdk/src/server/connections.ts` |
| App connection config UI | `apps/build/src/app/(portal)/[slug]/apps/[app_slug]/connections/page.tsx` |
| OAuth routes (apps) | `apps/web/src/app/api/apps/[slug]/oauth2/{authorize,callback}/route.ts` |
| App-author guide (§3) | `docs/app-implementation-template-v3.md` |
| Unify design | `plans/connections/unify-connection-definition.md` |
| Multi-method design | `plans/connections/multi-connection-per-app.md` |
