// packages/lib/src/returns/salvage-node-key.ts

/**
 * {@link SalvageNode.key} is the only handle the salvage card has, and this is
 * how the write paths read it back.
 *
 * The card's four callbacks (`onExpand`, `onChangeQuantity`, `onChangeStatus`,
 * `onSplit`) all hand back a node, and a node is **not** always a row: the tree
 * is materialized lazily, so a node somebody has not touched has no
 * `return_part_line` and no id of its own (plan section 6.6). `salvage-tree.ts`
 * gives those nodes the synthetic key `bom:${parentKey}:${partId}`, which
 * carries exactly the two facts a write needs to create the row - which parent
 * it hangs off and which part it is.
 *
 * 🛑 Pure string work, no database. The parse is what lets one mutation serve
 * both "edit this row" and "create the row this node stands for", instead of
 * the browser having to know which of the two it is looking at.
 */

import { ROOT_SALVAGE_KEY } from './types'

/** The prefix `salvage-tree.ts` gives a node with no row. */
const SYNTHETIC_PREFIX = 'bom:'

/** A node that already has a `return_part_line` row. */
export interface RowSalvageNodeKey {
  kind: 'row'
  rowId: string
}

/**
 * A node the BOM says exists and nobody has touched yet.
 *
 * `parentRowId` is null at the top level of a return line's tree - the returned
 * finished good is not itself a node (plan section 6.1), so the roots hang off
 * {@link ROOT_SALVAGE_KEY} rather than off a row.
 */
export interface BomSalvageNodeKey {
  kind: 'bom'
  parentRowId: string | null
  partId: string
}

/** Either half of the discriminated union {@link parseSalvageNodeKey} returns. */
export type ParsedSalvageNodeKey = RowSalvageNodeKey | BomSalvageNodeKey

/**
 * The synthetic key for an unmaterialized node.
 *
 * Kept beside the parser so the two halves of the format live in one file;
 * `salvage-tree.ts` composes the same string inline when it builds the node.
 */
export function syntheticSalvageNodeKey(parentKey: string, partId: string): string {
  return `${SYNTHETIC_PREFIX}${parentKey}:${partId}`
}

/**
 * Read a node key back into "which row" or "which part under which parent".
 *
 * Returns null for a malformed synthetic key rather than guessing: the write
 * paths turn that into a `BadRequestError` naming the key, which beats
 * materializing a row against a parent nobody asked for.
 *
 * The part id is taken as everything after the SECOND colon rather than by
 * splitting on every colon, so an id that ever contains one cannot silently
 * truncate.
 */
export function parseSalvageNodeKey(key: string): ParsedSalvageNodeKey | null {
  if (!key) return null
  if (!key.startsWith(SYNTHETIC_PREFIX)) return { kind: 'row', rowId: key }

  const rest = key.slice(SYNTHETIC_PREFIX.length)
  const separator = rest.indexOf(':')
  if (separator <= 0) return null

  const parentKey = rest.slice(0, separator)
  const partId = rest.slice(separator + 1)
  if (!partId) return null

  return {
    kind: 'bom',
    parentRowId: parentKey === ROOT_SALVAGE_KEY ? null : parentKey,
    partId,
  }
}
