# Permission justifications

The Chrome Web Store reviewer asks for one paragraph per declared permission.
Vague answers trigger manual review; be specific and factual.

These mirror what's declared in `apps/extension/manifest.json`.

## `activeTab`

To inject the Auxx.ai panel iframe into the current page when the user clicks the toolbar icon. `activeTab` grants temporary host access to the tab the user explicitly activated, scoped to a single user gesture and revoked on navigation. Used in place of broad host permissions so the extension cannot touch any tab the user did not opt into.

## `scripting`

To run `chrome.scripting.executeScript` against the active tab on toolbar click, which injects the Auxx.ai panel iframe element and a small inline bridge script that forwards parser invocations from the iframe to the page-side content script.

## `storage`

To persist the user's theme preference (light/dark) and active Auxx.ai workspace identifier between browser sessions in `chrome.storage.local`.

## `tabs`

To read `tab.url` from the `chrome.tabs.onUpdated` listener so the service worker can detect SPA navigation (LinkedIn / Instagram / Twitter pushState) and tell the iframe panel to re-parse the new page. Without this permission, URL changes that don't trigger a full reload would leave the panel showing stale data.

## `host_permissions`

We declare narrow host permissions for our own backend only:

> - `https://auxx.ai/*` — apex domain (marketing pages and short-link
>   redirects)
> - `https://*.auxx.ai/*` — subdomains, including `app.auxx.ai` where
>   the production tRPC API and the record-detail embed iframe live
>
> The service worker uses these to make credentialed cross-origin fetches
> to our tRPC API and to mint the short-lived bearer token that
> authenticates the record-detail embed iframe. Host access for the host
> sites where the extension parses content (Gmail, LinkedIn, X, Facebook,
> Instagram) is granted implicitly via the `content_scripts` `matches`
> declarations; we do not request broad `<all_urls>` or `https://*/*`
> permissions.

## Single-purpose statement

Auxx.ai lets users save contacts and companies they see on the web into their Auxx.ai contact database.

Every feature in the extension must plausibly serve that purpose — host
parsers (capture), iframe panel (review + save), record-detail embed (verify
the saved record). Don't bundle unrelated utilities.

## Remote code: **Yes**

When the dev console asks "Are you using Remote code?", select **Yes** and
paste:

> The extension embeds an `<iframe>` from `https://auxx.ai/embed/record/<recordId>`
> inside its panel to show the record-editing UI for a saved contact or
> company. That iframe executes JavaScript served by auxx.ai (the same web
> app the user signs into directly). The embedded view is the same field
> editor that already exists on auxx.ai — it is **not** a channel for
> pushing extension-behavior changes. The user authenticates the nested
> view via a short-lived bearer token minted by the extension from their
> existing auxx.ai session. The extension's `content_security_policy.frame-src`
> is restricted to `https://auxx.ai` and `https://*.auxx.ai`, so no
> third-party origins can be loaded into the panel.
>
> All other extension code — service worker, content scripts, the iframe
> shell's React app, parsers — is bundled into the extension package by
> Vite at build time. We do not use `eval()`, `new Function()`, dynamic
> `import()` from URLs, or any other mechanism to load and execute remote
> JavaScript outside of the auxx.ai-domain iframe described above.

### Why this triggers the disclosure

Chrome's policy considers JavaScript executed inside an extension page or
its iframes "remote code" when the source origin is not the extension
package itself. The auxx.ai embed iframe meets that definition. Declaring
"Yes" with the justification above is the canonical pattern — declaring
"No" while shipping a same-origin iframe that runs scripts has been a
common reason for first-submission rejection.
