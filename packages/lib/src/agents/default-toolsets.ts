// packages/lib/src/agents/default-toolsets.ts

import { BUILTIN_APP, BUILTIN_TOOLSETS } from './builtin-app'
import { getOrgToolsetCatalog } from './toolset-catalog'

/**
 * Built-in default toolset slugs — every `BUILTIN_TOOLSETS` row with
 * `isDefault: true`. Each agent created without an explicit `toolsetSlugs`
 * payload gets one `Agent.toolsets[]` entry per slug with
 * `source = 'auto_default'`.
 */
export const BUILTIN_DEFAULT_TOOLSETS: ReadonlyArray<string> = BUILTIN_TOOLSETS.filter(
  (t) => t.isDefault
).map((t) => t.slug)

/**
 * Resolve the default-on toolset slugs for a new agent in this org. Returns
 * the built-in defaults plus any installed-app toolsets that opt in via
 * `isDefault: true`. App-side defaults are read through the cached toolset
 * catalog so install/uninstall events refresh them automatically.
 */
export async function resolveDefaultToolsets(orgId: string): Promise<string[]> {
  const builtin = [...BUILTIN_DEFAULT_TOOLSETS]
  const catalog = await getOrgToolsetCatalog(orgId)
  const appDefaults = catalog
    .filter((entry) => entry.appId !== BUILTIN_APP.id && entry.isDefault)
    .map((entry) => entry.slug)
  // Dedupe defensively — a slug should only ever come from one source.
  return Array.from(new Set([...builtin, ...appDefaults]))
}
