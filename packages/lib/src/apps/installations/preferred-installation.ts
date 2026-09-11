// packages/lib/src/apps/installations/preferred-installation.ts

/**
 * Which of an org's installations of one app is THE installation.
 *
 * ## Why this has to exist
 *
 * An organization can hold two live installations of the same app at once:
 * `pnpm sync-dev` creates a `development` one and `auxx version create --publish`
 * a `production` one, and `installApp` dedupes per `installationType`, not per
 * app. Every caller that wants "the installation" therefore has to choose, and
 * the choice is not cosmetic — settings, connections and app storage are all
 * keyed by `appInstallationId`, so two callers that choose differently read and
 * write different rows while appearing to talk about the same app.
 *
 * That is not a hypothetical. The settings page saved `allowWrites` to the
 * production installation while the workflow engine executed the block as the
 * development one, so a write the admin had just enabled came back as
 * `INSUFFICIENT_PERMISSIONS` from the app's own capability gate. The rule was
 * written out by hand in seven places and one of them disagreed.
 *
 * ## The rule
 *
 * Production first, any installation as the fallback. Production is what the
 * org actually published and what a non-developer is looking at; a development
 * installation exists only while someone is iterating on the app, and falling
 * back to it is better than answering "not installed".
 *
 * ## Why a `find`, and not an `orderBy`
 *
 * Callers reach this list four different ways — a Drizzle `findMany`, a tRPC
 * payload, React context, a server component's props — and only one of them can
 * express an `ORDER BY`. A pure pick over whatever array the caller already has
 * is the only shape all of them can share. Sorting in SQL would leave the
 * client sites writing the rule out by hand again, which is how this drifted.
 *
 * Callers must therefore NOT use an unordered `findFirst`: the database is free
 * to hand back either row, and the same org can get a different answer between
 * two queries. Read every live installation and pick.
 */

/** An installation, narrowed to the one field the choice reads. */
export interface InstallationTypeCarrier {
  installationType: string | null
}

/** The installation type preferred whenever an org holds more than one. */
export const PREFERRED_INSTALLATION_TYPE = 'production'

/**
 * Pick the installation a caller should act on, production first.
 *
 * Pass every live (`uninstalledAt IS NULL`) installation of ONE app; returns
 * `undefined` for an empty list, which means the app is not installed.
 */
export function pickPreferredInstallation<T extends InstallationTypeCarrier>(
  installations: readonly T[]
): T | undefined {
  return (
    installations.find((i) => i.installationType === PREFERRED_INSTALLATION_TYPE) ??
    installations[0]
  )
}

/**
 * The same rule over a list spanning MANY apps: one entry per app, production
 * preferred. Order follows first appearance per app.
 *
 * The apps UI renders one card per app while `apps.listInstalled` returns a row
 * per installation, so without this an app with both installations appears
 * twice and collides on its React key.
 */
export function pickPreferredInstallationPerApp<
  T extends InstallationTypeCarrier & { app: { id: string } },
>(installations: readonly T[]): T[] {
  const byApp = new Map<string, T>()
  for (const installation of installations) {
    const existing = byApp.get(installation.app.id)
    if (!existing || installation.installationType === PREFERRED_INSTALLATION_TYPE) {
      byApp.set(installation.app.id, installation)
    }
  }
  return [...byApp.values()]
}
