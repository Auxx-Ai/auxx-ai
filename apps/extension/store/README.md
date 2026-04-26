# Auxx.ai — Chrome Web Store listing assets

Everything that goes into the Chrome Web Store dev-console listing for the
Auxx.ai extension. Version-controlled so the listing is reproducible (and so the
copy doesn't drift between team members).

The full publishing playbook lives at `plans/folk/13-publishing-and-testing.md`.

## Files

| File | What |
| --- | --- |
| `copy.md` | Name, short description, long description |
| `permissions.md` | Per-permission justifications (paste-ready into the dev console) |
| `disclosures.md` | Single-purpose statement + data-collection declarations |
| `TESTING.md` | Manual E2E checklist run before each release |
| `icons/` | Toolbar icons (16/32/48/128) — copies of `apps/extension/public/icons/` for one-stop upload |
| `screenshots/` | Listing screenshots (1280×800 PNG, 1–5 max) + master logo for compositing |
| `promo/` | Promo tiles (440×280 small, 1400×560 marquee) + logo source files |

## What lives elsewhere

| Asset | Path |
| --- | --- |
| Toolbar icons (16/32/48/128) | `apps/extension/public/icons/` |
| Manifest (incl. pinned `key`) | `apps/extension/manifest.json` |
| Privacy policy | `https://auxx.ai/privacy-policy` (web app, not in this repo) |
| Private signing key (`.pem`) | **Not in repo.** Keep in 1Password / shared vault. Losing it means losing the ability to publish updates under the same extension ID. |

## Build the submission zip

```bash
pnpm -C apps/extension build
cd apps/extension/dist && zip -r ../auxx-extension-v$(jq -r .version ../manifest.json).zip . && cd -
```

Verify before uploading:

- `manifest.json` is at the zip root (not nested in `dist/`)
- No `.DS_Store`, `.git`, source maps
- Total size <10 MB
