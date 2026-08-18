// packages/lib/src/workflows/graph-edit/normalize/connection-binding.ts

/**
 * Validation for an app block's bound `connectionId` (plan 17 §7, D2).
 *
 * `connectionId` needs no tool of its own: it is an ordinary top-level config
 * key `add_node`/`update_node` already accept. What it needs is a check, at the
 * normalize step, so a bad id never reaches the graph — an `error` issue here
 * blocks the persist (`ops.ts` gates on `plan.normalizeIssues`), which is the
 * right severity: a node pinned to a credential that does not resolve fails at
 * RUN time, long after the author has moved on.
 *
 * Three things are asserted, and only the first is already true elsewhere:
 *
 * 1. **The credential exists in THIS org.** `getCredential` is org-scoped and
 *    returns not-found for a foreign row, so a probe cannot confirm existence.
 * 2. **It belongs to THIS app.** New. `resolveConnectionForRuntime` does *not*
 *    check this — with a `connectionId` set it resolves the row, classifies it
 *    by its own `userId`, and hands it to the block's lambda whatever app it
 *    came from. A UPS credential id on a FedEx node resolves today.
 * 3. **It is workspace-scoped** (`userId === null`). A personal credential on a
 *    shared graph pins the workflow to one person, and a scheduled run then
 *    resolves nothing. NOTE this is deliberately narrower than the canvas,
 *    which still lets a human bind a personal credential (`BasePanel` renders
 *    `AppAccountPopover` without `allowPersonal`, default `true`) — a
 *    pre-existing bug, not a contract this must match.
 *
 * NOT in `normalize/connection.ts`: that file is about graph EDGES — branch
 * handles and `after`/`inside` wiring — and shares nothing with this but a word.
 */

import { getCredential } from '@auxx/credentials/store'
import { getCachedInstalledApps } from '../../../cache'
import type { Issue } from '../types'

/** Field name every issue here carries — the config key the author must fix. */
const FIELD = 'connectionId'

/** `<appId>:<blockId>` — the app id is everything before the FIRST colon. */
function appIdOfType(type: string): string {
  const colon = type.indexOf(':')
  return colon > 0 ? type.slice(0, colon) : ''
}

/**
 * Check a node config's `connectionId`, if it has one. Returns issues only —
 * the value is never rewritten, because there is no correct id to substitute
 * and guessing one would bind the node to something nobody chose.
 *
 * Silent no-op for: a core node type, an app whose installation this org does
 * not have (`add_node` already refuses that with its own message), and an
 * absent/empty `connectionId` — unbound is the healthy default.
 */
export async function checkConnectionBinding(
  organizationId: string,
  type: string,
  config: Record<string, unknown>
): Promise<Issue[]> {
  const raw = config[FIELD]
  if (typeof raw !== 'string' || !raw.trim()) return []
  const connectionId = raw.trim()

  // Cheapest exit first: the type tells us whether this can be an app block at
  // all, so a core node never reaches the cache or the credential store.
  const appId = appIdOfType(type)
  if (!appId) return []
  const installedApps = await getCachedInstalledApps(organizationId)
  const inst = installedApps.find((a) => a.app.id === appId)
  if (!inst) return []

  const result = await getCredential(connectionId, organizationId)
  if (result.isErr()) {
    return [
      {
        severity: 'error',
        field: FIELD,
        message:
          `Connection "${connectionId}" does not exist in this workspace. ` +
          `Call list_app_connections({ type: "${type}" }) to see the ones that do — or leave ` +
          'connectionId unset to use the workspace default.',
      },
    ]
  }

  const record = result.value
  if (record.appId && record.appId !== appId) {
    // Name the app it actually belongs to. "Wrong app" alone leaves the author
    // guessing which of the ids it is holding went where — and when that app is
    // not installed here there is no title to name, so say that instead of
    // stitching a placeholder into the sentence.
    const other = installedApps.find((a) => a.app.id === record.appId)?.app.title
    return [
      {
        severity: 'error',
        field: FIELD,
        message:
          `Connection "${connectionId}" ` +
          (other ? `is a ${other} connection` : 'belongs to a different app') +
          ` — this node is a ${inst.app.title} block. ` +
          `Call list_app_connections({ type: "${type}" }).`,
      },
    ]
  }

  if (record.userId !== null) {
    return [
      {
        severity: 'error',
        field: FIELD,
        message:
          `Connection "${connectionId}" is a personal connection. Workflow nodes bind workspace ` +
          'connections only, so the workflow keeps working when someone else — or a schedule — ' +
          'runs it. Call list_app_connections to see the workspace ones.',
      },
    ]
  }

  return []
}
