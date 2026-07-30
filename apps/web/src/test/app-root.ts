// apps/web/src/test/app-root.ts

import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Absolute path to `apps/web`, anchored to THIS FILE rather than to the process
 * working directory.
 *
 * A handful of tests assert on router source as text — that a mail procedure is
 * wrapped in the right permission gate, that a share card spells an area the
 * same way the copy does — so they read `.ts` files off disk. They used to do it
 * with `path.resolve(process.cwd(), 'src/…')`, which quietly depends on where
 * vitest was invoked from: `pnpm --filter @auxx/web test` puts the cwd at
 * `apps/web` and the reads succeed, while `vitest --project web` from the
 * monorepo root puts it two levels up and every one of them throws ENOENT.
 *
 * That is why these files were failing the moment CI began running the `web`
 * project (#1415) — the tests were fine, the anchor was not. Vitest does not
 * chdir its workers into the project root, and no config option makes it: the
 * path has to come from the module, not the environment.
 */
export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
