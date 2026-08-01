// packages/lib/src/kb/learned/diff-markdown.ts
// Line-level diff between an existing memory article and a proposed rewrite.
// Pure and dependency-free so the approval surfaces can render it.

/** One line of a rendered diff. */
export interface MarkdownDiffLine {
  type: 'add' | 'remove' | 'same'
  text: string
}

export interface MarkdownDiff {
  lines: MarkdownDiffLine[]
  addedCount: number
  removedCount: number
}

/**
 * Diff two markdown bodies by line.
 *
 * `upsert_learned_article` replaces the whole article body and asks the model
 * to merge existing content back in, so the one failure that matters is a
 * merge that silently drops a human's correction. A rendered preview of the
 * proposal cannot show that — only a diff can.
 *
 * Line granularity (not the KB's block diff) because the proposal is markdown
 * with freshly minted block ids: `diffBlocks` keys on stable `attrs.id`, so
 * every block of a re-parsed proposal would read as added, and the removals —
 * the whole point — would be indistinguishable from a rewrite.
 *
 * Blank lines are dropped before comparison: markdown spacing is noise here,
 * and keeping it doubles the diff for a one-word change.
 */
export function diffMarkdownLines(before: string, after: string): MarkdownDiff {
  const oldLines = toLines(before)
  const newLines = toLines(after)
  const lcs = longestCommonSubsequence(oldLines, newLines)

  const lines: MarkdownDiffLine[] = []
  let i = 0
  let j = 0

  for (const common of lcs) {
    while (i < oldLines.length && oldLines[i] !== common) {
      lines.push({ type: 'remove', text: oldLines[i] as string })
      i++
    }
    while (j < newLines.length && newLines[j] !== common) {
      lines.push({ type: 'add', text: newLines[j] as string })
      j++
    }
    lines.push({ type: 'same', text: common })
    i++
    j++
  }
  while (i < oldLines.length) {
    lines.push({ type: 'remove', text: oldLines[i] as string })
    i++
  }
  while (j < newLines.length) {
    lines.push({ type: 'add', text: newLines[j] as string })
    j++
  }

  return {
    lines,
    addedCount: lines.filter((l) => l.type === 'add').length,
    removedCount: lines.filter((l) => l.type === 'remove').length,
  }
}

function toLines(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
}

/**
 * Classic LCS over whole lines. O(n·m) — bounded by the tool's 100k-char
 * markdown cap, and memory articles are short by design.
 */
function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = table[i] as number[]
      const next = table[i + 1] as number[]
      row[j] =
        a[i] === b[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number)
    }
  }

  const out: string[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(a[i] as string)
      i++
      j++
      continue
    }
    const down = (table[i + 1] as number[])[j] as number
    const right = (table[i] as number[])[j + 1] as number
    if (down >= right) i++
    else j++
  }
  return out
}
