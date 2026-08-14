// apps/web/src/components/workflow/parity/builder-declared-keys.ts

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILDER_ROOT, ENGINE_ROOT, stripComments } from './monorepo-paths'

/**
 * Property names declared for a builder node's data shape — the BUILDER half
 * of the config-keys assertion, split out of the deleted `engine-contract.ts`
 * (node-catalog Phase 1 exit criterion). Unlike that file's engine-side
 * scraping (now `engine-write-scrape.ts`), this reader has nothing to do with
 * processor internals — it is a declared-shape reader, and it stays textual
 * for a reason unrelated to that migration: TypeScript interfaces have no
 * runtime representation, so there is no way to `Object.keys()` a `type` at
 * test time.
 *
 * The zod schema alone is NOT the builder's writable surface, migrated node
 * types included. Several nodes declare only a handful of keys in zod while
 * the panel writes the full TypeScript interface — `format`'s manifest schema
 * (`catalog/nodes/format.ts`) has four keys, its `FormatNodeData` interface has
 * eighteen `*Config` objects that the panel and validator both use. Reading the
 * interface keeps the config-key assertion pointed at genuine name-mismatches
 * (`data.assigneeId` vs `data.assignee`) rather than at zod schemas that are
 * merely incomplete — which is a different bug, and not this suite's.
 *
 * Deliberately a flat property-line scan rather than a parse: it over-collects
 * slightly (nested object types in the same file contribute their keys too),
 * and over-collecting only makes this assertion more conservative.
 */
export function builderDeclaredKeys(builderDir: string): Set<string> {
  const keys = new Set<string>()

  // Migrated node types (node-catalog Phase 1) declare their data interface in
  // the lib catalog; the web types.ts shrinks to a `type: NodeType` narrowing
  // wrapper over it. Read the catalog file first when it exists — it IS the
  // builder declaration for those types.
  const catalogPath = join(ENGINE_ROOT, 'catalog/nodes', `${builderDir.replace(/^core\//, '')}.ts`)
  const paths = [catalogPath, join(BUILDER_ROOT, builderDir, 'types.ts')]
  for (const path of paths) {
    if (!existsSync(path)) continue
    const source = stripComments(readFileSync(path, 'utf8'))
    for (const m of source.matchAll(/^\s+(\w+)\??\s*:/gm)) {
      keys.add(m[1] as string)
    }
  }
  return keys
}
