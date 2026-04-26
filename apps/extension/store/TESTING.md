# Manual E2E checklist

Run this before every store submission. Catches 90% of regressions; bottom-up
unit tests don't.

Tester: __________ Date: __________ Build: __________

## Setup

- [ ] `pnpm -C apps/extension build`
- [ ] Loaded unpacked from `apps/extension/dist/` in `chrome://extensions`
- [ ] Pinned to toolbar
- [ ] Logged in to `auxx.ai` in a tab on the same browser profile

## Auth

- [ ] Click toolbar icon on a non-host page → panel opens, shows generic-site capture
- [ ] Sign out of auxx.ai in the web tab → panel flips to "Sign in" CTA
- [ ] Sign back in → panel re-renders with workspace
- [ ] Switch org via auxx.ai's org switcher → panel re-renders for the new org

## LinkedIn

- [ ] Person profile (`/in/<slug>`) → button injected → click → contact parses
- [ ] Save → record appears in Auxx.ai, button flips to "Open in Auxx.ai"
- [ ] Re-visit same profile → matches list shows the existing record
- [ ] Company profile (`/company/<slug>`) → company parses + saves
- [ ] Sales Navigator profile → contact parses
- [ ] Search results page → bulk-select toolbar appears, multi-add works
- [ ] DM conversation → button injects in conversation header

## Gmail

- [ ] Open a thread with multiple recipients → click button → contact parses
- [ ] Compose with a recipient typed → still captures correctly

## X / Twitter

- [ ] `x.com/<username>` profile → contact parses
- [ ] `x.com/search` → search-results parser
- [ ] `x.com/home` (reserved path) → falls through to generic-site capture, no error

## Facebook

- [ ] Profile page without About → Contact and Basic Info tab open → "Open Contact and Basic Info" hint shown
- [ ] After hint, profile parses
- [ ] Page (org account) → re-routes to company entity

## Instagram

- [ ] Public profile → parses
- [ ] Reserved path (`/explore`, `/p/<id>`) → no parse attempt

## Generic site

- [ ] Random company website → "Save this page" view → save creates company by domain
- [ ] Re-visit → "Already in Auxx.ai" view with Open CTA

## Detail view (embed)

- [ ] Save flow lands on detail view inside the panel
- [ ] Header shows avatar + displayName + Open button
- [ ] Open button pops auxx.ai tab to the right record
- [ ] Field list scrolls smoothly when long
- [ ] Loader covers full panel height during fetch (no upper-left text flash)

## Theme

- [ ] OS dark mode → panel + embed render dark
- [ ] OS light mode → panel + embed render light

## Errors / 4xx

- [ ] Open the extension while NOT logged in → "Sign in" CTA, no JS errors
- [ ] Token mint fails (kill auxx.ai cookie mid-session) → "Sign in to Auxx.ai to view this record" surfaces

## Console

- [ ] Service worker console (chrome://extensions → service worker) — no red errors
- [ ] Iframe console (right-click in panel → Inspect) — no red errors
- [ ] Host page console — content script logs only at debug level, no warnings
