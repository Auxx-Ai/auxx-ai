// apps/web/src/components/dashboard/lib/legend-pages.ts

/**
 * Bin legend item widths into pages that each fit the available width — the pure
 * core of the Twenty-style paginated legend carousel.
 *
 * If every item fits in `containerWidth` at once, returns a single page and the
 * caller hides the paginator (identical to a non-paginated legend). Otherwise the
 * paginator occupies `paginatorWidth`, so items are greedily packed into
 * `containerWidth - paginatorWidth - gap`. An item wider than the available width
 * still gets its own page (never split).
 *
 * Returns arrays of item indices, one array per page. Always at least `[[]]`.
 */
export function binIntoPages(
  itemWidths: number[],
  containerWidth: number,
  paginatorWidth: number,
  gap: number
): number[][] {
  const count = itemWidths.length
  if (count === 0 || containerWidth <= 0) return [[]]

  // Everything fits on one row → no paginator.
  const totalFull = itemWidths.reduce((sum, w) => sum + w, 0) + (count - 1) * gap
  if (totalFull <= containerWidth) {
    return [itemWidths.map((_, i) => i)]
  }

  const available = Math.max(0, containerWidth - paginatorWidth - gap)
  const pages: number[][] = []
  let current: number[] = []
  let used = 0

  for (let i = 0; i < count; i++) {
    const w = itemWidths[i] ?? 0
    const add = current.length === 0 ? w : gap + w
    // Start a new page when the next item would overflow (but never leave a page empty).
    if (current.length > 0 && used + add > available) {
      pages.push(current)
      current = []
      used = 0
    }
    const addFresh = current.length === 0 ? w : gap + w
    current.push(i)
    used += addFresh
  }
  if (current.length > 0) pages.push(current)

  return pages.length > 0 ? pages : [[]]
}
