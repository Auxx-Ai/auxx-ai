export const titleize = (str: string | null): string | null => {
  if (!str) return null
  return str
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function removeExcessiveWhitespace(str: string) {
  return (
    str
      // First remove all zero-width spaces, soft hyphens, and other invisible characters
      // Handle each special character separately to avoid combining character issues
      .replace(/\u200B|\u200C|\u200D|\u200E|\u200F|\uFEFF|\u3164|\u00AD|\u034F/g, ' ')
      // Normalize all types of line breaks to \n
      .replace(/\r\n|\r/g, '\n')
      // Then collapse multiple newlines (3 or more) into double newlines
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      // Clean up spaces around newlines (but preserve double newlines)
      .replace(/[^\S\n]*\n[^\S\n]*/g, '\n')
      // Replace multiple spaces (but not newlines) with single space
      .replace(/[^\S\n]+/g, ' ')
      // Clean up any trailing/leading whitespace
      .trim()
  )
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural
}

/**
 * Friendly-ify a machine field key into a human label.
 * `totalPrice` → `Total Price`, `total_price` → `Total Price`,
 * `line-items` → `Line Items`, `customerID` → `Customer ID`, `tags[]` → `Tags`.
 *
 * Splits camelCase / PascalCase boundaries, treats `_ - . /` and whitespace as
 * separators, collapses runs, and title-cases — preserving existing all-caps
 * acronyms (`ID`, `URL`) rather than lower-casing them to `Id`/`Url`.
 */
export function humanizeFieldName(key: string | null | undefined): string {
  if (!key) return ''
  return key
    .replace(/\[\]$/, '') // drop array marker
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // fooBar → foo Bar
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // URLField → URL Field, customerID → customer ID
    .replace(/[_\-./]+/g, ' ') // separators → space
    .replace(/\s+/g, ' ') // collapse
    .trim()
    .split(' ')
    .map((w) =>
      w.length > 1 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(' ')
}

/**
 * Friendly-ify a dotted machine field PATH into a human label, prepending each
 * ancestor segment. `owner.url` → `Owner Url`, `a.b.c` → `A B C`,
 * `line_items[].sku` → `Line Items Sku`, `url` → `Url`.
 *
 * Each segment runs through {@link humanizeFieldName}. A leading run of a
 * segment that repeats the tail of the accumulated label is dropped, so a child
 * key that re-states its parent doesn't double it: `owner.owner_id` →
 * `Owner Id` (not `Owner Owner Id`), `order.order_line` → `Order Line`.
 */
export function humanizeFieldPath(path: string | null | undefined): string {
  if (!path) return ''
  const words: string[] = []
  for (const seg of path.split('.')) {
    const segWords = humanizeFieldName(seg).split(' ').filter(Boolean)
    if (segWords.length === 0) continue
    // Find the longest overlap where the tail of `words` equals the head of this
    // segment's words (case-insensitive), and skip that repeated prefix.
    let overlap = 0
    for (let k = Math.min(words.length, segWords.length); k > 0; k--) {
      const tail = words.slice(words.length - k)
      if (tail.every((w, i) => w.toLowerCase() === segWords[i].toLowerCase())) {
        overlap = k
        break
      }
    }
    words.push(...segWords.slice(overlap))
  }
  return words.join(' ')
}

/**
 * Interprets common escape sequences in a string.
 * Converts literal escape sequences (e.g., typed "\n") into actual characters.
 *
 * Supports: \n (newline), \t (tab), \r (carriage return), \\ (backslash)
 */
export function interpretEscapeSequences(str: string | null | undefined): string {
  if (!str) return ''
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\\\/g, '\\')
}

/**
 * Generates a unique title by appending an incrementing number if needed.
 * @param baseTitle The base title (e.g., "IF/ELSE" or "AI 1")
 * @param existingTitles Set of existing titles to check against
 * @returns Unique title (e.g., "IF/ELSE 3")
 */
export function incrementTitle(baseTitle: string, existingTitles: Set<string>): string {
  // If base title is unique, use it
  if (!existingTitles.has(baseTitle)) {
    return baseTitle
  }

  // Parse the base title to extract the actual base name and any existing number
  // Pattern: "Name 123" -> base="Name", number=123
  const match = baseTitle.match(/^(.+?)\s+(\d+)$/)
  const baseName = match?.[1] ?? baseTitle

  // Escape special regex characters in base name for safe pattern matching
  const escapedBaseName = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Find all titles that match the base name pattern and extract their numbers
  const existingNumbers: number[] = []

  for (const title of existingTitles) {
    // Check if this title matches our base name pattern
    const titleMatch = title.match(new RegExp(`^${escapedBaseName}\\s+(\\d+)$`))
    if (titleMatch?.[1]) {
      existingNumbers.push(parseInt(titleMatch[1], 10))
    }
    // Also check if the base name itself (without number) exists
    if (title === baseName) {
      existingNumbers.push(0) // Treat unnumbered as 0 to ensure we start from 1
    }
  }

  // Find the next available number (max + 1, or 1 if no numbers found)
  const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1

  return `${baseName} ${nextNumber}`
}
