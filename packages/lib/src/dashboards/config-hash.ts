// packages/lib/src/dashboards/config-hash.ts

import { stableHash } from '@auxx/utils/hash'
import type { DashboardLayoutDoc } from './client'

/**
 * sha256 (hex) of a layout doc's canonical serialization. Key-order- and
 * insertion-order-independent (see {@link stableHash}), so a doc hashes
 * identically before and after a Postgres `jsonb` round-trip — the invariant the
 * no-op-republish check in `publishDashboard` (and the draft-dirty check in
 * `saveDraft`) relies on.
 *
 * Server-only (wraps `node:crypto` via `@auxx/utils/hash`); the client never
 * hashes, so this deliberately lives OUTSIDE `client.ts`.
 */
export function hashLayoutDoc(doc: DashboardLayoutDoc): string {
  return stableHash(doc)
}
