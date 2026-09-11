// apps/web/src/components/apps/dedupe-installations.ts

/**
 * Collapse an installed-apps list to one entry per app, production preferred.
 *
 * A thin re-export: the rule itself lives in `@auxx/lib/apps/client` so the
 * apps UI, the workflow UI and the engine's installation resolver cannot drift
 * apart. Kept as a named alias because the call sites read better as
 * "dedupe by app" than as "pick preferred per app".
 */
export { pickPreferredInstallationPerApp as dedupeInstallationsByApp } from '@auxx/lib/apps/client'
