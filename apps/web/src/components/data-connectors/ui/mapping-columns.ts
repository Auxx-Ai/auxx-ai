// apps/web/src/components/data-connectors/ui/mapping-columns.ts

/**
 * Shared `grid-template-columns` for every row in the mapping editor tree
 * (MappingNode, BranchRow, SourceLeafRow, FormulaRow, add-row). Routing all row
 * types through one template is what keeps the `→` arrow and the target pickers
 * aligned in a fixed column at every nesting depth.
 *
 * Columns: source │ arrow │ target (equal width for every row's selector) │
 * actions (fills the rest).
 *
 * `minmax()` keeps the look identical when there's room (source/target cap at
 * 16/12rem) but lets them shrink toward a floor on smaller containers instead of
 * overflowing. The bounds are container-driven (not content-driven), so every row
 * resolves to the same track widths — the arrow/target columns stay aligned
 * across rows and at every depth. Actions never shrink below their controls
 * (`min-content`) and absorb any extra width.
 */
export const MAPPING_COLS =
  'minmax(8rem, 16rem) 1.25rem minmax(7rem, 12rem) minmax(min-content, 1fr)'
