// packages/lib/src/inventory/builds/write-lane.ts

// The one place that decides the write lane for a build's own entity rows. `quietSession` (not
// `skipEvents`, `seedSession` or `absorbedSession`): builds are production automation that announce
// their own writes after commit through `publishBuildUpdate` and `publishQuietBuildWrites`.

import { getRealtimeService, publishRecordsChanged } from '../../realtime'
import { quietSession, type WriteSession } from '../../resources/crud/write-origin'

/** The prose recorded on every silent build write. Greppable, and the audit trail. */
export const BUILD_WRITE_LANE_REASON =
  'build completion posts its own consume/produce ledger and announces its rows after commit'

/**
 * The quiet session for build writes that do not announce every row they touch (reversal,
 * pricing). Never pair it with `skipEvents: true`: the deprecated alias overrides the lane.
 */
export function buildWriteSession(): WriteSession {
  return quietSession(BUILD_WRITE_LANE_REASON)
}

/**
 * The completion's session: `completeBuild` announces the build through
 * {@link publishQuietBuildWrites} after commit, so per-record frames are shut too.
 */
export function buildCompletionSession(): WriteSession {
  return quietSession(BUILD_WRITE_LANE_REASON, { coveredBy: 'publishQuietBuildWrites' })
}

/**
 * Announce rows a build wrote silently: one tier-2 `records:changed` frame per def, fire and
 * forget after the commit. No `excludeSocketId`: the tab that completed the build is the one most
 * likely to have it open.
 */
export function publishQuietBuildWrites(
  organizationId: string,
  entityDefinitionId: string,
  recordIds: string[]
): void {
  if (recordIds.length === 0) return
  // 🛑 try/catch AND `.catch`, both. `getRealtimeService()` resolves transport
  // config and throws SYNCHRONOUSLY when it is absent, which a promise handler
  // never sees — and this runs after the commit, so a throw here would report a
  // build that is already in the ledger as failed.
  try {
    publishRecordsChanged(getRealtimeService(), organizationId, {
      entityDefinitionId,
      entries: recordIds.map((recordId) => ({ recordId })),
    }).catch(() => {})
  } catch {
    // Best effort. The next list fetch or channel rebind catches the rows up.
  }
}
