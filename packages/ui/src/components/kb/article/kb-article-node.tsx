// packages/ui/src/components/kb/article/kb-article-node.tsx

import type { ReactNode } from 'react'
import { AccordionBlock } from './accordion-block'
import { BlockRenderer } from './block-renderer'
import { TableBlock } from './table-block'
import { TabsBlock } from './tabs-block'
import type {
  AccordionJSON,
  ArticleNodeJSON,
  BlockJSON,
  DiffDecorations,
  DocJSON,
  PanelJSON,
  ResolveAuxxHref,
  TabsJSON,
} from './types'

interface KBArticleNodeProps {
  node: ArticleNodeJSON
  idx: number
  /** The full doc the node belongs to — needed for ordered concerns like list numbering. */
  doc: DocJSON
  headingIds?: Record<number, string>
  resolveAuxxHref?: ResolveAuxxHref
  /** Diff decorations for container-nested leaves; absent on the normal render path. */
  decorations?: DiffDecorations
}

/**
 * Renders a single top-level article node (leaf block or container). The
 * dispatch shared by `KBArticleRenderer` and the diff view so block/container
 * rendering never diverges between the two surfaces.
 */
export function KBArticleNode({
  node,
  idx,
  doc,
  headingIds,
  resolveAuxxHref,
  decorations,
}: KBArticleNodeProps) {
  switch (node.type) {
    case 'tabs':
      return (
        <ServerTabsBlock node={node} resolveAuxxHref={resolveAuxxHref} decorations={decorations} />
      )
    case 'accordion':
      return (
        <ServerAccordionBlock
          node={node}
          resolveAuxxHref={resolveAuxxHref}
          decorations={decorations}
        />
      )
    case 'table':
      return <TableBlock node={node} resolveAuxxHref={resolveAuxxHref} decorations={decorations} />
    case 'block':
      return (
        <BlockRenderer
          node={node}
          idx={idx}
          doc={doc}
          headingIds={headingIds}
          resolveAuxxHref={resolveAuxxHref}
          decorations={decorations}
        />
      )
    default:
      return null
  }
}

function renderPanelBody(
  panel: PanelJSON,
  resolveAuxxHref: ResolveAuxxHref | undefined,
  decorations: DiffDecorations | undefined
): ReactNode {
  // Panel bodies are flat block content; reuse BlockRenderer with a synthetic
  // sub-doc so heading-id maps stay scoped. We intentionally don't pass a
  // headingIds map — TOC headings are top-level only.
  const subDoc: DocJSON = { type: 'doc', content: panel.content }
  return panel.content.map((block: BlockJSON, i) => (
    <BlockRenderer
      key={i}
      node={block}
      idx={i}
      doc={subDoc}
      resolveAuxxHref={resolveAuxxHref}
      decorations={decorations}
    />
  ))
}

function ServerTabsBlock({
  node,
  resolveAuxxHref,
  decorations,
}: {
  node: TabsJSON
  resolveAuxxHref?: ResolveAuxxHref
  decorations?: DiffDecorations
}) {
  if (!Array.isArray(node.content) || node.content.length === 0) return null
  const panels = node.content.map((panel) => ({
    id: panel.attrs.id,
    label: panel.attrs.label,
    iconId: panel.attrs.iconId,
    body: renderPanelBody(panel, resolveAuxxHref, decorations),
  }))
  return <TabsBlock panels={panels} />
}

function ServerAccordionBlock({
  node,
  resolveAuxxHref,
  decorations,
}: {
  node: AccordionJSON
  resolveAuxxHref?: ResolveAuxxHref
  decorations?: DiffDecorations
}) {
  if (!Array.isArray(node.content) || node.content.length === 0) return null
  const items = node.content.map((panel) => ({
    id: panel.attrs.id,
    label: panel.attrs.label,
    body: renderPanelBody(panel, resolveAuxxHref, decorations),
  }))
  return <AccordionBlock items={items} allowMultiple={node.attrs.allowMultiple !== false} />
}
