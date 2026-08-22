// packages/lib/src/data-connectors/__test-helpers.ts
//
// Shared test-only fixtures for the data-connector sync sinks.
//
// `SyncCtx` is the single object every sink entry point takes, and it keeps
// growing (`manifest` in B2, `connectionMeta` in the identity plan, `sweep`,
// `driftByMapping`). Each sink test used to hand-roll the whole thing, so every
// new required member broke N fixtures at once — and the nine-field
// `counters` block was copied verbatim in three files.
//
// Build one here instead. Defaults mirror what production supplies for a run
// with nothing subscribed; pass overrides for whatever the case asserts on.

import type { Database } from '@auxx/database'
import {
  createManifestCollector,
  type ManifestCollector,
} from '../record-rules/sync-manifest-collector'
import { newRecordFailureTally } from './record-failure-tally'
import type { SyncCtx } from './sinks/types'

/**
 * A real, always-on {@link ManifestCollector} with ZERO rule subscriptions — exactly
 * what production builds for an org with no enabled record rules (plan 07: the
 * collector is always real; empty subscriptions just mean `subscriptionsFor` answers
 * undefined for every def, so tier-2 delta capture never fires). Pure and DB-free.
 */
export function emptyManifestCollector(): ManifestCollector {
  return createManifestCollector({})
}

/** A zeroed {@link SyncCtx.counters} — mirrors `newRunCounters()` in `./service`. */
export function zeroRunCounters(): SyncCtx['counters'] {
  return {
    fetched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    archived: 0,
    deleted: 0,
    failed: 0,
    relationshipWarnings: 0,
    errorSample: [],
  }
}

/**
 * Build a {@link SyncCtx} for a sink test. Every required member gets a
 * production-shaped default; `crud`/`ownedCrud` default to an empty stub, so a
 * case that exercises writes must pass its own spies.
 */
export function makeSyncCtx(over: Partial<SyncCtx> = {}): SyncCtx {
  return {
    db: {} as Database,
    orgId: 'org1',
    connector: { id: 'dc1', credentialId: 'cred1' } as SyncCtx['connector'],
    runId: 'run1',
    crud: {} as SyncCtx['crud'],
    ownedCrud: {} as SyncCtx['ownedCrud'],
    relationshipCrud: {} as SyncCtx['relationshipCrud'],
    counters: zeroRunCounters(),
    failureTally: newRecordFailureTally(),
    manifest: emptyManifestCollector(),
    touchedDefs: new Set<string>(),
    ...over,
  }
}
