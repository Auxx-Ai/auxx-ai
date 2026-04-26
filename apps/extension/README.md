# @auxx/extension

Chrome extension that captures contacts and companies from Gmail, LinkedIn,
Sales Navigator, X, Facebook, Instagram, and any company website into the
user's active Auxx.ai workspace.

---

## Quick reference

```bash
pnpm -C apps/extension dev       # local dev with HMR (load unpacked from dist/)
pnpm -C apps/extension build     # production build (no source maps)
pnpm -C apps/extension package   # build + zip → auxx-extension-v<version>.zip
```

---

## Local development

```bash
pnpm -C apps/extension dev
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select `apps/extension/dist`
5. Pin the extension (puzzle icon → pin) so the toolbar button is always visible

The Vite dev server runs at port 5173 with HMR for the iframe React app and
auto-reload for content scripts. **Keep `chrome://extensions` open** while
developing — it's where errors surface and where you reload after manifest
changes.

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

### Pinned extension ID

The manifest already has a stable `key` baked in, so the extension ID is the
same in dev, staging, prod, and the Web Store. The matching private `.pem`
must be kept somewhere safe (1Password / shared vault) — losing it means
losing the ability to publish updates under the same extension ID.

If you ever need to regenerate (only if the private key is lost AND we accept
a new extension ID):

```bash
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out auxx-extension-key.pem
openssl rsa -in auxx-extension-key.pem -pubout -outform DER | openssl base64 -A
```

Paste the printed base64 into `manifest.json` as `"key"`. Load the extension
once to read the derived ID, then update `NEXT_PUBLIC_EXTENSION_ID` in
`apps/web/.env` so the CORS middleware allows the new origin.

---

## Production build

```bash
DOMAIN=auxx.ai pnpm -C apps/extension build
```

The extension can't rewrite URLs at runtime (it ships as a signed zip), so
`WEBAPP_URL` is resolved at `vite build` time — one build per environment.
Source maps are emitted in dev only; `vite build` produces a stripped
production bundle.

---

## Packaging for the Chrome Web Store

```bash
DOMAIN=auxx.ai pnpm -C apps/extension package
```

Produces `apps/extension/auxx-extension-v<version>.zip` ready to upload. The
script:

- Builds against the env-resolved `WEBAPP_URL`
- Zips `dist/` **contents** (so `manifest.json` lands at the zip root, not
  nested in a folder — the Web Store rejects nested manifests)
- Excludes source maps, `.DS_Store`, and `.git/*`
- Strips the `"key"` field from the zipped manifest (the Web Store rejects
  uploads that include `key` — it manages signing keys itself). The source
  `manifest.json` and the unpacked `dist/manifest.json` keep their `key`
  so local dev still gets a stable extension ID.

If you bump the version, edit `manifest.json:version` first — Chrome rejects
re-uploads with the same version string. The script reads the version from
the built manifest, so the zip filename always matches.

### Sanity check before uploading

```bash
unzip -l apps/extension/auxx-extension-v<version>.zip | head
```

You should see `manifest.json` listed at the root (no `dist/` prefix), and no
`*.map` files. Total size should be well under 10 MB (currently ~0.3 MB).

---

## Publishing to the Chrome Web Store

The full playbook lives in `plans/folk/13-publishing-and-testing.md`. Here's
the idiot-proof version for a new submission.

### One-time setup

1. Pay the **$5 one-time** developer-account fee at
   https://chrome.google.com/webstore/devconsole. Use an org-owned Google
   account (e.g. `dev@auxx.ai`), **not** a personal Gmail.
2. Verify the contact email Google sends you.
3. (Optional) Verify the `auxx.ai` domain in Google Search Console so the
   listing shows the publisher badge.

### Each release

1. **Bump version** in `manifest.json` (semver is fine; Chrome only requires
   it changes per upload).
2. **Run the manual E2E checklist** at `apps/extension/store/TESTING.md` —
   load unpacked from `dist/`, walk through every host site (Gmail,
   LinkedIn, X, Facebook, Instagram, generic), test signed-out + dark mode.
3. **Build the production zip:**
   ```bash
   DOMAIN=auxx.ai pnpm -C apps/extension package
   ```
4. **Upload** the zip:
   - Go to the dev console → select the Auxx.ai extension → **Package**
   - Click **Upload new package** → pick
     `apps/extension/auxx-extension-v<version>.zip`
5. **Update the listing** if anything changed:
   - Description: `apps/extension/store/copy.md`
   - Permission justifications: `apps/extension/store/permissions.md`
   - Privacy practices: `apps/extension/store/disclosures.md`
   - Single-purpose statement: also in `permissions.md`
   - Privacy policy URL: `https://auxx.ai/privacy-policy`
6. **Submit for review.** First submission = 3–7 business days. Updates =
   1–3 days. Don't touch the submission while it's in review (it resets the
   clock).

### First-ever submission

Do this once before going public:

1. Set **Visibility = Unlisted** (or use the testers list with your email)
2. Submit for review
3. When approved, install from the unlisted store URL on a clean browser
   profile and run through `apps/extension/store/TESTING.md` again
4. Edit the listing → flip **Visibility = Public** → resubmit
5. Public re-review is usually same-day to 2 days since the code is
   unchanged

### When a review gets rejected

The reviewer sends a paragraph explaining why. Common reasons:

| Reason | Fix |
| --- | --- |
| Missing privacy policy URL | Confirm `https://auxx.ai/privacy-policy` resolves and matches `disclosures.md` |
| Permissions overbroad vs. described purpose | Tighten justifications in `permissions.md` and re-upload |
| "Remote code" flagged | False positive on minified chunks — reply explaining imports are bundled, point to specific files |
| Screenshots show old design | Take new ones at 1280×800, drop in `store/screenshots/`, re-upload |
| "Single purpose" unclear | Tighten the single-purpose statement in `permissions.md` |
| Declared data collection doesn't match | Update `disclosures.md` to match what's actually sent |

Address it specifically and resubmit — second reviews are usually 1-3 days.

### Emergency rollback

You can't roll back to a previous version, but you can re-upload an older
zip with a bumped version number (e.g. ship v1.5.1 that's actually v1.3.0's
code). Or fix-forward with a patch — minor-version updates review fastest.

---

## Listing assets

Lives in `apps/extension/store/`. See `store/README.md` for what each file
is for.

| Asset | Where |
| --- | --- |
| Description / copy | `store/copy.md` |
| Permission justifications | `store/permissions.md` |
| Privacy disclosures | `store/disclosures.md` |
| E2E checklist | `store/TESTING.md` |
| Screenshots (1280×800) | `store/screenshots/` |
| Promo tiles (440×280, 1400×560) | `store/promo/` |
| Toolbar icons | `apps/extension/public/icons/` |
| Privacy policy page | `apps/homepage/src/app/privacy-policy/page.tsx` |

---

## Troubleshooting

**"Manifest is missing" on upload** — you zipped `dist/` itself instead of
its contents. Use `pnpm package` (which zips contents correctly) instead of
zipping the folder by hand.

**"key field is not allowed in manifest" on upload** — you zipped a
manifest that still has `"key"` set. `pnpm package` strips it
automatically; if you see this error you probably zipped `dist/` by hand.
Re-run `pnpm package` and upload the produced zip.

**"Source maps included" warning** — shouldn't happen with `pnpm package`
since the script excludes them. If you see it, you probably ran `vite build`
and zipped `dist/` manually. Run `pnpm package` instead.

**"Same version already uploaded"** — bump `manifest.json:version`. Chrome
rejects re-uploads with the same version string.

**Iframe shows "Sign in to Auxx.ai"** — the bearer-token mint failed. Confirm
you're logged into auxx.ai in the same browser profile, and that
`NEXT_PUBLIC_EXTENSION_ID` matches the actual loaded extension ID
(`chrome://extensions` → copy the ID under the Auxx.ai card).

**Content script not loading after a manifest change** — reload the
extension card on `chrome://extensions` AND reload the host page. Manifest
changes don't HMR.

**"externally_connectable" not working** — Firefox doesn't support it; we
target Chromium browsers only for v1.
