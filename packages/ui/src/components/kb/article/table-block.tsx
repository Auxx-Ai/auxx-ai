// packages/ui/src/components/kb/article/table-block.tsx

import type { ReactNode } from 'react'
import { BlockRenderer } from './block-renderer'
import styles from './kb-article-renderer.module.css'
import type { BlockJSON, DocJSON, ResolveAuxxHref, TableCellJSON, TableJSON } from './types'

interface TableBlockProps {
  node: TableJSON
  resolveAuxxHref?: ResolveAuxxHref
}

/**
 * Server component. Renders a `TableJSON` node as a real `<table>` with
 * `<thead>` (when the first row is all `tableHeader`) and `<tbody>`. Cell
 * content recurses through `BlockRenderer`.
 */
export function TableBlock({ node, resolveAuxxHref }: TableBlockProps): ReactNode {
  if (!Array.isArray(node.content) || node.content.length === 0) return null

  const [firstRow, ...restRows] = node.content
  const firstRowIsHeader =
    firstRow.content.length > 0 && firstRow.content.every((c) => c.type === 'tableHeader')

  const renderCell = (cell: TableCellJSON, scope: 'col' | 'row' | undefined, key: number) => {
    const Tag = cell.type === 'tableHeader' ? 'th' : 'td'
    const subDoc: DocJSON = { type: 'doc', content: cell.content }
    return (
      <Tag
        key={key}
        colSpan={cell.attrs?.colspan && cell.attrs.colspan !== 1 ? cell.attrs.colspan : undefined}
        rowSpan={cell.attrs?.rowspan && cell.attrs.rowspan !== 1 ? cell.attrs.rowspan : undefined}
        scope={Tag === 'th' ? scope : undefined}>
        {cell.content.map((block: BlockJSON, i) => (
          <BlockRenderer
            // biome-ignore lint/suspicious/noArrayIndexKey: cell content order is stable per render
            key={i}
            node={block}
            idx={i}
            doc={subDoc}
            resolveAuxxHref={resolveAuxxHref}
          />
        ))}
      </Tag>
    )
  }

  const bodyRows = firstRowIsHeader ? restRows : node.content

  return (
    <div className={styles.tableScrollWrap}>
      <table className={styles.publicTable}>
        {firstRowIsHeader ? (
          <thead>
            <tr>{firstRow.content.map((cell, i) => renderCell(cell, 'col', i))}</tr>
          </thead>
        ) : null}
        <tbody>
          {bodyRows.map((row, ri) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: row order is stable per render
            <tr key={ri}>{row.content.map((cell, i) => renderCell(cell, 'row', i))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
