// vitest.alias.ts

import path from 'node:path'

/**
 * Every `@auxx/*` workspace package, mapped to its SOURCE directory.
 *
 * ## Why this has to exist
 *
 * Each workspace package exports four conditions:
 *
 * ```json
 * "types":   "./src/index.ts",
 * "source":  "./src/index.ts",
 * "import":  "./dist/index.mjs",
 * "default": "./src/index.ts"
 * ```
 *
 * `tsc` picks `types` and reads source. Vite — and therefore Vitest — resolves
 * ESM through `import`, so it picks **`dist`**. On a developer machine that
 * directory exists and everything works; on a fresh CI checkout it does not, and
 * the suite dies with `Failed to resolve entry for package "@auxx/database"`
 * before a single test runs. The two toolchains disagree about the same
 * package.json, and only one of them is affected by a cold checkout.
 *
 * Aliasing to source settles it: CI and a laptop resolve identically, tests
 * always exercise the code as written rather than the last build, and no test
 * job needs a build step to precede it.
 *
 * This cost a red `main` on 2026-07-30. `packages/billing` and `packages/lib`
 * had hand-rolled partial versions of this map, which is why those two projects
 * were the ones that had always passed in CI — the projects added alongside them
 * (`services`, `credentials`, `redis`, `kb`) had no aliases and failed instantly.
 *
 * ## Using it
 *
 * ```ts
 * import { auxxSourceAlias } from '../../vitest.alias'
 * export default defineConfig({
 *   resolve: { alias: { ...auxxSourceAlias, '~/': path.resolve(__dirname, './src/') } },
 * })
 * ```
 *
 * Imported by RELATIVE path on purpose. A `@auxx/…` specifier here would have to
 * be resolved by the very mechanism this file exists to work around.
 *
 * ## Rules
 *
 * Vite alias keys are PREFIX matches, so `@auxx/database` also rewrites
 * `@auxx/database/enums` → `packages/database/src/enums`. Every package keeps
 * its subpaths under `src/` with matching names, so one entry covers a package
 * whole — except `@auxx/types`, whose subpaths live at the package root and
 * which is therefore mapped without `src`.
 *
 * A package added to the workspace belongs here even if nothing imports it
 * across a package boundary yet. The entry is inert until something does, and
 * adding it now is what stops the next cold-CI failure.
 */
// `__dirname`, not `import.meta.dirname`: Vite bundles a config and its relative
// imports together, injecting file-scope `__dirname` per module — so this
// resolves against the repo root here, not against whichever config imported it.
const workspace = (pkg: string, dir = 'src') => path.resolve(__dirname, 'packages', pkg, dir)

export const auxxSourceAlias: Record<string, string> = {
  '@auxx/billing': workspace('billing'),
  '@auxx/config': workspace('config'),
  '@auxx/credentials': workspace('credentials'),
  '@auxx/database': workspace('database'),
  '@auxx/deployment': workspace('deployment'),
  '@auxx/email': workspace('email'),
  '@auxx/lib': workspace('lib'),
  '@auxx/logger': workspace('logger'),
  '@auxx/redis': workspace('redis'),
  '@auxx/seed': workspace('seed'),
  '@auxx/services': workspace('services'),
  // Sources sit at the package root, not under `src/`.
  '@auxx/types': workspace('types', '.'),
  '@auxx/ui': workspace('ui'),
  '@auxx/utils': workspace('utils'),
  '@auxx/workflow-nodes': workspace('workflow-nodes'),
}
