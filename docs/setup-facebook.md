# Facebook Messenger & Instagram DM setup

Both channels run on **one Meta app** and **one OAuth route**. Instagram Messaging is a
child of the Facebook Graph API, so there is no separate Instagram app, client id, or
verify token — connecting Instagram means authorizing the same Facebook app against a
Page that has an Instagram professional account linked to it.

> Architecture decisions behind this (why Facebook Login rather than Instagram Login,
> why page tokens rather than the 60-day refresh treadmill) live in
> `plans/channels/facebook-instagram-channel-rewrite.md`.

## Prerequisites

- A Facebook account with a **Page** (the integration connects to a Page, never a personal profile)
- For Instagram: an Instagram **professional** account (Business or Creator), linked to
  that Page, with **Settings → Messages → Allow access to messages** turned on. Without
  that toggle Meta delivers no message webhooks for the account, and nothing in the
  connect flow will tell you.

## 1. Create the Meta app

1. [Meta for Developers](https://developers.facebook.com/) → **My Apps** → **Create App**
2. Use case: **Other** → type: **Business**
3. Name it, add a contact email, create.
4. Add the **Messenger** product, and **Facebook Login** (Login is what the connect flow uses).

## 2. App ID and secret

**App Settings → Basic.** Copy the App ID and (after **Show**) the App Secret.

| Variable | Value |
| --- | --- |
| `FACEBOOK_APP_ID` | App ID |
| `FACEBOOK_APP_SECRET` | App Secret |
| `FACEBOOK_GRAPH_API_VERSION` | `v26.0` |
| `FACEBOOK_WEBHOOK_VERIFY_TOKEN` | `openssl rand -hex 32` |

**Set these in the worker's env too, not just the web app's.** Message sync runs in
`@auxx/worker`, which loads its own `.env` — a version pinned only in the root `.env` will
not reach it.

> `FACEBOOK_GRAPH_API_VERSION` must not be left at an old value. Graph answers a
> deprecated version by silently serving a current one and returning `paging.next` links
> stamped with the newer version, so a stale pin produces requests whose behaviour you
> cannot predict from the code.

### After ANY credential change: re-seed

`ensurePlatformProviders` bakes **encrypted copies** of the OAuth client into the
`ConnectionDefinition` rows at seed time. Editing env alone is inert at runtime — the old
client is still in the database, and the connect fails with "App not active".

```bash
npx dotenv -- npx tsx packages/lib/scripts/reseed-platform-providers.ts
```

## 3. OAuth redirect URI

The callback is keyed on the **ConnectionDefinition id**, not the provider name:

```
{BASE}/api/connections/{connectionDefinitionId}/oauth2/callback
```

**That id is a cuid, and it differs per environment** — dev and production have separate
seeded rows. There is no static URL to copy. Read the ids for your environment:

```sql
SELECT id, "providerKey" FROM "ConnectionDefinition"
WHERE "providerKey" IN ('facebook', 'instagram');
```

Register **both** resulting URLs under **Facebook Login → Settings → Valid OAuth Redirect
URIs**.

In dev, `{BASE}` is `NGROK_URL` when set, otherwise `WEBAPP_URL` — the tunnel host, not
`localhost:3000`, because Meta will not redirect to a private address.

## 4. Webhooks

App-level webhook configuration is **manual, in the App Dashboard**. Only the *per-page*
subscription is automated (the connect flow and `recoverChannel` both arm it).

**Messenger → Messenger API Settings → Webhooks → Add Callback URL:**

- Callback URL: `{BASE}/api/facebook/webhook`
- Verify Token: your `FACEBOOK_WEBHOOK_VERIFY_TOKEN`

Subscribe the `page` object to: `messages`, `messaging_postbacks`, `message_reads`.

**Instagram → Webhooks** (separate callback, same verify token):

- Callback URL: `{BASE}/api/instagram/webhook`
- Subscribe the `instagram` object to: `messages`, `messaging_postbacks`

Do **not** subscribe `feed` or `comments`. Post comments are not ingested — the routes
log and drop them — so subscribing only makes the gap look handled.

The verify handshake is a `GET` with `hub.challenge`; a mismatch answers 403 and Meta
shows "The URL couldn't be validated".

## 5. Permissions

Requested by the connect flow (`connections/providers/defs.ts`):

- **Facebook:** `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`,
  `pages_show_list`, `business_management`
- **Instagram:** the same five, plus `instagram_basic` and `instagram_manage_messages`

`business_management` is not optional: without it, Pages owned by a Business portfolio
are simply absent from `/me/accounts` at connect time, and the connect fails with
"No Facebook Pages found" on an account that plainly has Pages.

In **Development** mode these work immediately for people holding a role on the app
(admin, developer, tester) against Pages they administer — no App Review. External users
need App Review and Live mode.

Two review items worth knowing before you rely on them:

- **Human Agent** — required to reply outside Meta's 24-hour messaging window. Auxx uses
  the `HUMAN_AGENT` tag for composer replies past the window; automated (agent/workflow)
  sends are blocked there rather than tagged, because tagging bot traffic as human is a
  policy violation Meta detects.
- Instagram message webhooks may require the app to be **Live** even for role-holders.

## 6. Connect

In Auxx: **Settings → Channels → Add channel → Facebook** (or Instagram). Facebook's own
consent step is where you choose which Pages to grant; Auxx currently auto-selects the
first eligible Page, so grant only the Page you want, or steer it there.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| "App not active" on connect | Env changed without re-seeding — see §2. |
| Webhook validation fails | Verify token mismatch, or `{BASE}` not publicly reachable. |
| Connected, but no messages arrive | The Page subscription did not arm. Check `GET /{pageId}/subscribed_apps`. Reconnecting through the OAuth popup re-arms it; so does channel recovery. |
| Instagram connects but stays silent | "Allow access to messages" is off, the IG account is not professional, or the app needs to be Live. |
| Connect succeeds, channel never appears | Historically a disconnected (soft-deleted) row being relinked. Fixed — but check `Integration.deletedAt` if it recurs. |
| Token errors after working fine | Page tokens are long-lived but die if the user removes the app from Page settings. Surfaces as `requiresReauth`; there is no refresh grant. |
