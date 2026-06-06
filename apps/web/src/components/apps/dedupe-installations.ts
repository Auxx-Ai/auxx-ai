// apps/web/src/components/apps/dedupe-installations.ts

/**
 * Collapse an installed-apps list to one entry per app.
 *
 * An organization can legitimately hold both a `development` and a `production`
 * installation of the same app (`installApp` dedupes per installationType, not per app),
 * so `apps.listInstalled` returns a row per installation. The apps UI renders one card
 * per app, so without this the same app appears twice (and collides on its React key).
 *
 * Keeps the production installation when both exist, otherwise the first seen.
 */
export function dedupeInstallationsByApp<
  T extends { app: { id: string }; installationType: string },
>(installations: T[]): T[] {
  const byApp = new Map<string, T>()
  for (const installation of installations) {
    const existing = byApp.get(installation.app.id)
    if (!existing || installation.installationType === 'production') {
      byApp.set(installation.app.id, installation)
    }
  }
  return [...byApp.values()]
}
