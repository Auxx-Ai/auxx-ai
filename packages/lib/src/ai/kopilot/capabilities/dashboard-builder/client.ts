// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/client.ts

/**
 * Constants for the `dashboard.builder` page capability.
 *
 * NO `'use client'` directive, deliberately. A directive turns every export of
 * this module into a proxy stub for SERVER importers, and the page key is read
 * on the server (the stream route's registration gate) as well as in the
 * browser. Constants-only modules stay directive-free.
 */

/**
 * Page key the dashboard builder's docked chat sends as `page`. Registration in
 * `apps/web/src/app/api/kopilot/stream/route.ts` is gated on it, and the tools
 * resolve their subject from the `dashboard` session ref rather than an
 * argument.
 */
export const DASHBOARD_BUILDER_PAGE = 'dashboard.builder'

// NOTE: no tool in this capability carries a `toolsetSlug`, and that is
// deliberate. These tools are mounted by PAGE CONTEXT (`page:
// 'dashboard.builder'`), exactly like the workflow-builder, agents-builder and
// record-views tools, and they are listed in `tool-slug-coverage`'s
// `ALWAYS_ON_TOOLS` allowlist (they also carry `surfaces: ['builder']`, which
// that scan treats as page-mounted on its own).
//
// The workflow-builder tools DID carry `toolsetSlug: 'workflow.builder'` until
// it was found to disable the whole capability: master Kopilot's toolsets come
// from the `kopilot.toolsets` org setting, whose default is the glob `auxx:*`,
// which cannot match a slug outside the `auxx:` namespace, and orgs that have
// customised the list hold explicit slugs that predate the toolset entirely.
// `filterToolsByToolsets` drops any tool whose toolset is not enabled, so all
// 15 were stripped after registration: the builder prompt section rendered, and
// not one tool existed. An org-toolset grant was meaningless there and is
// meaningless here for the same reason: these tools only exist on a page no
// user-authored agent can ever run on.
//
// `surfaces: ['builder']` stays a LITERAL in each tool factory (never a shared
// spread): the anti-drift scan reads each factory's `return {` window as text
// and cannot see through a spread. Builder-only because dashboard authoring has
// no meaning on chat/email, and a runtime AI node must never inherit it.
