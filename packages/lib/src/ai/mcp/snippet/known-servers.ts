// packages/lib/src/ai/mcp/snippet/known-servers.ts
//
// Static maps that short-circuit the registry lookup for stdio packages we already know about.
// Keyed by the affix-stripped package slug (see `stripPackageAffixes`).

/** Packages that act on the local machine/browser — no hosted remote can exist. */
export const LOCAL_ONLY_PACKAGES: Record<string, string> = {
  'server-filesystem': 'reads and writes the local filesystem',
  filesystem: 'reads and writes the local filesystem',
  'server-memory': 'stores data in a local process',
  memory: 'stores data in a local process',
  'server-sequential-thinking': 'runs entirely in the local process',
  'sequential-thinking': 'runs entirely in the local process',
  'server-puppeteer': 'controls a local browser',
  puppeteer: 'controls a local browser',
  'chrome-devtools-mcp': 'controls a local Chrome instance',
  'chrome-devtools': 'controls a local Chrome instance',
  playwright: 'controls a local browser',
  'server-sqlite': 'opens a local SQLite database file',
  sqlite: 'opens a local SQLite database file',
}

/** Curated/known stdio packages with a hosted Streamable HTTP twin. */
export const KNOWN_PACKAGE_REMOTES: Record<string, { url: string }> = {
  context7: { url: 'https://mcp.context7.com/mcp' },
  'context7-mcp': { url: 'https://mcp.context7.com/mcp' },
}

/** Match a raw package id against the local-only list (affix-stripped). Returns the reason copy. */
export function localOnlyReason(strippedSlug: string): string | undefined {
  return LOCAL_ONLY_PACKAGES[strippedSlug]
}

/** Match a raw package id against the known-remotes map (affix-stripped). */
export function knownRemote(strippedSlug: string): { url: string } | undefined {
  return KNOWN_PACKAGE_REMOTES[strippedSlug]
}
