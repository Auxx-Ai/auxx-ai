// packages/lib/src/ai/kopilot/capabilities/ledger/client.ts

/**
 * Constants for the `accounting.ledger` page capability.
 *
 * NO `'use client'` directive, deliberately - the same rule
 * `dashboard-builder/client.ts` records. A directive turns every export of this
 * module into a proxy stub for SERVER importers, and the page key is read on
 * the server (the stream route's registration) as well as in the browser.
 * Constants-only modules stay directive-free.
 */

/**
 * Page key the ledger console (`/app/accounting/closeout`) sends as `page`.
 *
 * `CloseoutPage` mounts `<KopilotContext page='accounting.ledger' />`, which is
 * what puts {@link createLedgerCapabilities}' tools in scope for that turn.
 *
 * 🛑 The web component hardcodes the literal rather than importing this
 * constant, exactly as `dashboard-detail-view.tsx` does: `apps/web` reaching
 * into `@auxx/lib/ai/kopilot` from a `'use client'` component pulls the whole
 * server-side capability graph into the browser bundle.
 */
export const ACCOUNTING_LEDGER_PAGE = 'accounting.ledger'

// NOTE: the tool in this capability carries no `toolsetSlug`, and that is
// deliberate - it is mounted by PAGE CONTEXT, like the record-views,
// workflow-builder, dashboard-builder and purchasing-intake tools, and is
// listed in `tool-slug-coverage`'s `ALWAYS_ON_TOOLS` allowlist. An org-toolset
// grant would be meaningless (and would silently strip the tool: the
// `kopilot.toolsets` default is the glob `auxx:*`, which cannot match a slug
// outside that namespace). See `dashboard-builder/client.ts` for the full
// account of how that failure presented.
