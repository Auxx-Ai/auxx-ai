// packages/lib/src/kb/markdown/test-helpers.ts
//
// Throwing narrowers for the `ArticleNodeJSON` union that the markdown parser
// returns. Test-only — deliberately not re-exported from `index.ts`.
//
// The union plus `noUncheckedIndexedAccess` means an assertion like
// `nodes[0].attrs.blockType` doesn't compile, and the obvious workaround —
// wrapping it in `if (nodes[0]?.type === 'block') expect(…)` — makes the test
// pass VACUOUSLY the moment the parser regresses, because a failed narrowing
// just skips the assertion. These helpers assert instead: a missing or
// wrongly-typed node fails the test naming what was actually there.

import type {
  AccordionJSON,
  ArticleNodeJSON,
  BlockJSON,
  PanelJSON,
  TableJSON,
  TabsJSON,
} from './types'

/** Element at `index`, or a failure naming what was being indexed. */
export function at<T>(items: readonly T[] | undefined, index: number, what = 'item'): T {
  const value = items?.[index]
  if (value === undefined) {
    throw new Error(`expected a ${what} at index ${index}, found ${items?.length ?? 0} item(s)`)
  }
  return value
}

/** The `block` node at `index`, or a failure naming the node that was there. */
export function blockAt(nodes: readonly ArticleNodeJSON[] | undefined, index = 0): BlockJSON {
  const node = at(nodes, index, 'article node')
  if (node.type !== 'block') throw new Error(`expected a block at index ${index}, got ${node.type}`)
  return node
}

/** The `tabs` container at `index`. */
export function tabsAt(nodes: readonly ArticleNodeJSON[] | undefined, index = 0): TabsJSON {
  const node = at(nodes, index, 'article node')
  if (node.type !== 'tabs') throw new Error(`expected tabs at index ${index}, got ${node.type}`)
  return node
}

/** The `accordion` container at `index`. */
export function accordionAt(
  nodes: readonly ArticleNodeJSON[] | undefined,
  index = 0
): AccordionJSON {
  const node = at(nodes, index, 'article node')
  if (node.type !== 'accordion') {
    throw new Error(`expected an accordion at index ${index}, got ${node.type}`)
  }
  return node
}

/** The `table` container at `index`. */
export function tableAt(nodes: readonly ArticleNodeJSON[] | undefined, index = 0): TableJSON {
  const node = at(nodes, index, 'article node')
  if (node.type !== 'table') throw new Error(`expected a table at index ${index}, got ${node.type}`)
  return node
}

/** Every node narrowed to `block` — fails if any container is present. */
export function blocksOf(nodes: readonly ArticleNodeJSON[] | undefined): BlockJSON[] {
  return (nodes ?? []).map((_, i) => blockAt(nodes, i))
}

/** The panel at `index` of a tabs/accordion container. */
export function panelAt(container: TabsJSON | AccordionJSON, index = 0): PanelJSON {
  return at(container.content, index, 'panel')
}

/** The block at `blockIndex` inside the cell at `[rowIndex][cellIndex]`. */
export function cellBlockAt(
  table: TableJSON,
  rowIndex: number,
  cellIndex: number,
  blockIndex = 0
): BlockJSON {
  const row = at(table.content, rowIndex, 'table row')
  const cell = at(row.content, cellIndex, 'table cell')
  return at(cell.content, blockIndex, 'cell block')
}
