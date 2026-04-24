# @auxx/extension

Chrome extension that captures contacts and companies from supported host sites
(Gmail, LinkedIn, Sales Navigator in v1) into the user's active Auxx organization.

## Local development

```bash
pnpm -C apps/extension dev
```

Then in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked**
→ select `apps/extension/dist`. The Vite dev server runs at port 5173 with HMR.

The iframe calls the web app at the URL baked in at build time from
`@auxx/config`'s `WEBAPP_URL`. With no env vars set, that resolves to
`http://localhost:3000` — which is where `pnpm dev` runs the web app. To
point a local build somewhere else, set `APP_URL` before running `pnpm dev`
(e.g. `APP_URL=https://app.dev.auxx.ai pnpm -C apps/extension dev`).

For the iframe's session fetch to attach its cookie, the web app must be
running with `DOMAIN` set (any value — it flips `SameSite=None; Secure` on
the session cookie). In `apps/web/.env.local`:

```bash
# Extension ID derived from manifest "key" (see below)
NEXT_PUBLIC_EXTENSION_ID=<your-extension-id>
# Flip session cookie to SameSite=None; Secure so chrome-extension:// can read it
DOMAIN=localhost
```

## Pinned extension ID

Generate the keypair once and keep the private PEM out of git (1Password etc.):

```bash
openssl genrsa 2048 \
  | openssl pkcs8 -topk8 -nocrypt -out auxx-extension-key.pem

openssl rsa -in auxx-extension-key.pem \
  -pubout -outform DER \
  | openssl base64 -A
```

Paste the printed base64 into the manifest as `"key"`. Load the extension once
to read the derived ID, then set `NEXT_PUBLIC_EXTENSION_ID` in `apps/web/.env`
so the CORS middleware on `/api/trpc/*` and `/api/extension/session` knows
which origin to allow.

## Production build

```bash
# Build against prod (needs APP_URL or DOMAIN set)
DOMAIN=auxx.ai pnpm -C apps/extension build
```

One build per environment: unlike the Next.js apps, the extension can't
rewrite URLs at container start (it ships as a signed zip), so `WEBAPP_URL`
is resolved at `vite build` time. Upload `dist/` (zipped) to the Chrome Web
Store. Staged rollout recommended: 10% → 50% → 100%.
