// apps/web/src/components/workflow/parity/monorepo-paths.ts

import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Shared filesystem plumbing for the parity suite's static readers
 * (`engine-write-scrape.ts`, `builder-declared-keys.ts`) — both need to locate
 * the monorepo root and read/strip source files, and neither should carry its
 * own copy of that logic. Split out of `engine-contract.ts` when it was
 * deleted (node-catalog Phase 1 exit criterion) so the two readers it used to
 * house — one genuinely ENGINE-side, one BUILDER-side — don't depend on each
 * other just to find a path.
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

/** List every non-test `.ts` source file under `dir`, recursively. */
export function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) listSources(full, out)
    else if (full.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(full)) out.push(full)
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
