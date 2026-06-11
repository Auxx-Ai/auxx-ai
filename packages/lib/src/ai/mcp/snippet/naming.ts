// packages/lib/src/ai/mcp/snippet/naming.ts
//
// Pure naming helpers shared by the parser, the registry search heuristic, and enrichment.

/** Strip an npm scope and `mcp-`/`-mcp` affixes from a package id → bare slug (`@upstash/context7-mcp` → `context7`). */
export function stripPackageAffixes(packageId: string): string {
  const unscoped = packageId.replace(/^@[^/]+\//, '')
  return unscoped
    .replace(/^mcp-/, '')
    .replace(/-mcp$/, '')
    .replace(/^server-/, '')
}

/** Title-case a slug for display (`chrome-devtools` → `Chrome Devtools`). */
export function prettifyName(slug: string): string {
  const base = stripPackageAffixes(slug)
  return base
    .split(/[-_/\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** First non-flag positional after `npx [-y]` / `uvx`, with a trailing `@version` stripped. */
export function extractPackageId(
  command: string | undefined,
  args: string[] | undefined
): string | undefined {
  const tokens = [command, ...(args ?? [])].filter((t): t is string => !!t)
  const runner = tokens.findIndex((t) => t === 'npx' || t === 'uvx' || t === 'pnpm' || t === 'bunx')
  const start = runner === -1 ? 0 : runner + 1
  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.startsWith('-')) continue // -y, --yes, etc.
    return t.replace(/@[^/@]+$/, '') // strip trailing @version (keep @scope/name)
  }
  return undefined
}
