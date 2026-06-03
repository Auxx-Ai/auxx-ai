// packages/lib/src/knowledge-sources/crawl/sitemap-tree.ts
// Pure: a flat list of mapped URLs → a nested SitemapNode tree by path segments.
// Provider-agnostic (Firecrawl `/map` returns flat links with no hierarchy) — this is
// the wizard tree, identical across providers.

import type { SitemapNode } from './types'

/** A discovered link from a provider's site map. */
export interface MappedLink {
  url: string
  title?: string
}

/**
 * Build the nested section tree. Each URL's pathname segments become branch nodes;
 * the URL's terminal node is marked `isPage`. The root node ('/') represents the
 * site origin and is itself a page when the homepage was mapped.
 */
export function buildTreeFromPaths(links: MappedLink[]): SitemapNode {
  const root: SitemapNode = { path: '/', url: '', isPage: false, children: [] }

  for (const link of links) {
    let parsed: URL
    try {
      parsed = new URL(link.url)
    } catch {
      continue // skip malformed links
    }
    if (!root.url) root.url = `${parsed.protocol}//${parsed.host}`

    const segments = parsed.pathname.split('/').filter(Boolean)
    let node = root
    let acc = ''
    for (const segment of segments) {
      acc += `/${segment}`
      let child = node.children.find((c) => c.path === acc)
      if (!child) {
        child = { path: acc, url: link.url, isPage: false, children: [] }
        node.children.push(child)
      }
      node = child
    }

    // The terminal node for this URL is a real page.
    node.isPage = true
    node.url = link.url
    if (link.title && !node.title) node.title = link.title
  }

  sortTree(root)
  return root
}

/** Stable alphabetical order so the wizard tree doesn't reshuffle between maps. */
function sortTree(node: SitemapNode): void {
  node.children.sort((a, b) => a.path.localeCompare(b.path))
  for (const child of node.children) sortTree(child)
}
