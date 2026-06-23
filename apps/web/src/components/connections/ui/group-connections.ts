// apps/web/src/components/connections/ui/group-connections.ts
import type { ConnectionRow } from './connection-card'

/** A set of connections that share an owner (one app, or one platform provider). */
export interface ConnectionGroup {
  /** `app:<appId>` or `provider:<type>` — stable per owner within a scope. */
  key: string
  /** Resolved app/provider label (the card subtitle). */
  label: string
  /** Resolved visual-ref icon (app logo / provider mark / fallback). */
  iconId: string
  scope: 'user' | 'organization'
  /** Member rows, sorted: expired first, then by display name. */
  rows: ConnectionRow[]
  /** Count of rows with `status === 'expired'` — drives the stack's rollup badge. */
  expiredCount: number
}

/** The owner group key for a row: apps group by installation, everything else by provider type. */
function groupKey(row: ConnectionRow): string {
  return row.kind === 'app' ? `app:${row.appId}` : `provider:${row.type}`
}

const displayName = (row: ConnectionRow): string => row.label ?? row.name

/**
 * Collapse one scope's rows into owner groups (apps + platform providers), each sorted with
 * expired connections first. Single-row groups are returned too — the renderer decides whether
 * to draw a stack or a plain card. `resolve` reuses the section's `resolveIcon`/`resolveSubtitle`
 * so faces match the individual cards.
 */
export function groupConnections(
  rows: ConnectionRow[],
  resolve: { iconId: (r: ConnectionRow) => string; label: (r: ConnectionRow) => string }
): ConnectionGroup[] {
  const byKey = new Map<string, ConnectionGroup>()

  for (const row of rows) {
    const key = groupKey(row)
    let group = byKey.get(key)
    if (!group) {
      group = {
        key,
        label: resolve.label(row),
        iconId: resolve.iconId(row),
        scope: row.scope,
        rows: [],
        expiredCount: 0,
      }
      byKey.set(key, group)
    }
    group.rows.push(row)
    if (row.status === 'expired') group.expiredCount++
  }

  for (const group of byKey.values()) {
    group.rows.sort((a, b) => {
      const aExpired = a.status === 'expired' ? 0 : 1
      const bExpired = b.status === 'expired' ? 0 : 1
      if (aExpired !== bExpired) return aExpired - bExpired
      return displayName(a).localeCompare(displayName(b))
    })
  }

  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label))
}
