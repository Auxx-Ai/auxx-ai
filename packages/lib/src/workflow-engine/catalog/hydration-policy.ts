// packages/lib/src/workflow-engine/catalog/hydration-policy.ts

import type { DehydrateGraphOptions, HydrateGraphOptions } from './graph-hydration'

/**
 * How every wired seam calls {@link hydrateGraph} / {@link dehydrateGraph} —
 * one constant so the two halves can never disagree, and so the decision below
 * has exactly one place to be reversed.
 *
 * The read side has no options left. See {@link DEHYDRATION_OPTIONS} for the
 * one decision that remains, and for the epitaph of the one that was removed.
 */
export const HYDRATION_OPTIONS: HydrateGraphOptions = {}

/**
 * The write-side policy: strip handles that equal their default, because
 * {@link hydrateGraph} restores them.
 *
 * Safe because every engine path reaches the document through
 * `WorkflowGraphBuilder.build()`, which hydrates before anything routes. Two
 * tests hold that up — `core/__tests__/loop-handle-stripping.test.ts` (a
 * three-node loop body whose stored edges carry no handles) and the parity
 * suite's default-handle census. `dehydrateGraph`'s own parameter default stays
 * `false` so a data migration doing read-modify-write still sees stored bytes.
 *
 * ## The read-time defaults layer, and why it is gone
 *
 * `plans/kopilot/workflow/23-graph-document-canonicalization.md` §2.4 wanted
 * `manifest.defaultData()` layered under stored data at read, so a default
 * would be a projection rather than a panel write. It was built, never enabled,
 * and is now deleted. `plans/kopilot/workflow/26-hydration-defaults-and-handles.md`
 * has the full evaluation; the two structural reasons, neither of which is the
 * "schema question" it was first diagnosed as:
 *
 * 1. **There is no single answer to "what is the default for this type."**
 *    Kopilot resolves manifests through a per-org `buildManifestLookup(orgId)`
 *    that sees app blocks; the browser, engine, org cache and public API use
 *    the core registry, which does not. An app block's `defaultData()` returns
 *    its `appId`/`appSlug`/`blockId`, so one writer would strip identity keys
 *    that no reader could put back.
 * 2. **Four manifests' `defaultData()` is not a pure function of the type.**
 *    `scheduled` reads the ambient `Intl` timezone — different in a browser and
 *    in a UTC worker — and three others mint a `generateId()`. A layer whose
 *    projection differs per process cannot be an inverse of anything.
 *
 * It also had no beneficiary left: the two panel backfills §2.4 existed to
 * retire both write keys the layer structurally cannot restore, and plan `22`'s
 * content guard already makes those writes save-neutral.
 *
 * Enabling it once, briefly, stripped load-bearing config off a real row
 * (#1770 → #1771). Do not rebuild it without answering both points above.
 */
export const DEHYDRATION_OPTIONS: DehydrateGraphOptions = { stripDefaultHandles: true }
