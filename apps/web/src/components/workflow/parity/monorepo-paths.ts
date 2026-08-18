// apps/web/src/components/workflow/parity/monorepo-paths.ts

import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Shared filesystem plumbing for the parity suite's static readers
 * (`engine-write-scrape.ts`, `builder-declared-keys.ts`,
 * `store-subscription-scrape.test.ts`) — all need to locate the monorepo root
 * and read/strip source files, and none should carry its own copy of that
 * logic. Split out of `engine-contract.ts` when it was deleted (node-catalog
 * Phase 1 exit criterion) so the two readers it used to house — one genuinely
 * ENGINE-side, one BUILDER-side — don't depend on each other just to find a
 * path.
 */

/** Walk up from this file until the monorepo root (the one with `packages/lib`). */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (!existsSync(join(dir, 'packages', 'lib', 'package.json'))) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error('could not locate the monorepo root')
    dir = parent
  }
  return dir
}

export const ENGINE_ROOT = join(repoRoot(), 'packages/lib/src/workflow-engine')
export const BUILDER_ROOT = join(repoRoot(), 'apps/web/src/components/workflow/nodes')

/**
 * The whole builder tree, not just its node definitions.
 *
 * `BUILDER_ROOT` is deliberately narrower (`.../workflow/nodes`) because the
 * builder↔engine contract only lives in the node folders. The store-subscription
 * scrape (`store-subscription-scrape.test.ts`) has to see the canvas, panels and
 * hooks too, and those sit beside `nodes/`, not under it.
 */
export const WORKFLOW_ROOT = join(repoRoot(), 'apps/web/src/components/workflow')

/**
 * List every non-test source file under `dir`, recursively.
 *
 * `extensions` defaults to `.ts` alone — the engine and node-catalog readers
 * that predate this parameter scan pure-TypeScript trees and must keep
 * ignoring React files. Pass `['.ts', '.tsx']` to include components; the
 * test-file exclusion covers both suffixes either way.
 *
 * @param dir - Directory to walk.
 * @param extensions - File suffixes to collect (matched with `endsWith`).
 * @param out - Accumulator, supplied by the recursion.
 */
export function listSources(
  dir: string,
  extensions: readonly string[] = ['.ts'],
  out: string[] = []
): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) listSources(full, extensions, out)
    else if (extensions.some((ext) => full.endsWith(ext)) && !/\.(test|spec)\.tsx?$/.test(full))
      out.push(full)
  }
  return out
}

/**
 * Strip comments before scanning.
 *
 * Not cosmetic: `form-input-processor.ts` documents `setNodeVariable(` inside a
 * JSDoc block, and without this a caller's scanner reads the prose that
 * follows it as an argument list.
 *
 * Offsets are preserved (comments are blanked, not removed) so callers doing
 * offset-based structural analysis (e.g. `engine-write-scrape.ts`'s
 * `else`-block spans) stay aligned with the original source.
 */
export function stripComments(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, ' ')
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, lead: string) => lead + blank(_m.slice(lead.length)))
}
