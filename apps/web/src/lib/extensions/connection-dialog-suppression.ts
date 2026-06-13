// apps/web/src/lib/extensions/connection-dialog-suppression.ts

/**
 * Ref-counted registry of installation IDs for which the auto-popping
 * {@link ConnectionExpiredDialog} should be suppressed.
 *
 * The workflow builder renders an app node's config by asking the app bundle to
 * draw its panel, which auto-calls server functions to populate fields. When the
 * connection is expired those calls return `CONNECTION_REQUIRED` — but during
 * regular config editing we don't want an unprompted modal hijacking the screen.
 * The App Settings status dot + connection picker already surface that state.
 *
 * Run/test paths go through tRPC (`workflow.runSingleNode`) and the app-trigger
 * test endpoint — not the server-function bridge — so they are unaffected and
 * keep their existing connection feedback.
 */
const counts = new Map<string, number>()

/**
 * Suppress the connection-expired modal for `installationId` until the returned
 * disposer runs. Ref-counted so overlapping mounts compose correctly.
 */
export function suppressConnectionDialog(installationId: string): () => void {
  counts.set(installationId, (counts.get(installationId) ?? 0) + 1)
  return () => {
    const next = (counts.get(installationId) ?? 0) - 1
    if (next <= 0) counts.delete(installationId)
    else counts.set(installationId, next)
  }
}

/** Whether the connection-expired modal is currently suppressed for `installationId`. */
export function isConnectionDialogSuppressed(installationId: string): boolean {
  return (counts.get(installationId) ?? 0) > 0
}
